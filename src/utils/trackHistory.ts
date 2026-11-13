import type { UploadHistoryItem } from '../types';

const STORAGE_KEY = 'spotflow_upload_history_v1';

export function stripDiacriticsClient(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

export function normalizeTextClient(input: string): string {
  return stripDiacriticsClient(input)
    .toLowerCase()
    .replace(/['’"`.,!?()[\]{}:;+~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanTitleClient(title: string): string {
  return title
    .replace(
      /\((?:feat\.?|ft\.?|with|explicit|explicit ver\.?|ost[^)]*|from [^)]*|radio edit|single version|remaster(?:ed)?[^)]*|official[^)]*|lyric(?:s)?[^)]*|audio|mv|live[^)]*|acoustic[^)]*|remix[^)]*|ver\.?[^)]*)\)/gi,
      ' '
    )
    .replace(
      /\[(?:feat\.?|ft\.?|ost[^\]]*|from [^\]]*|explicit[^\]]*|official[^\]]*|lyric[^\]]*|mv[^\]]*|4k|hd|vietsub[^\]]*|320\s*kbps|128\s*kbps)\]/gi,
      ' '
    )
    .replace(/\s+(?:feat\.?|ft\.?|prod\.?)\s+.+$/i, '')
    .replace(/\s+[-–|]\s+(?:single version|explicit|remastered.*|from .*|official.*|lyric.*)$/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeFileKey(fileName: string): string {
  const withoutExt = fileName.replace(/\.[a-zA-Z0-9]{2,5}$/, '');
  const cleaned = withoutExt
    .replace(/^(?:y2mate\.com|yt1s\.com|snapsave\.io|x2convert\.com|mp3juices?|zmp3|nhaccuatui)\s*[-–_|]\s*/i, '')
    .replace(/^\d{1,3}\s*[._-]\s*/, '')
    .replace(/_/g, ' ');
  return normalizeTextClient(cleanTitleClient(cleaned));
}

export function normalizeTrackKey(title: string, artist: string): string {
  const t = normalizeTextClient(cleanTitleClient(title));
  const a = normalizeTextClient(artist.split(',')[0] || artist);
  if (a && t) return `${a}::${t}`;
  return t || a;
}

export function buildSwappedTrackKey(title: string, artist: string): string {
  const t = normalizeTextClient(cleanTitleClient(title));
  const a = normalizeTextClient(artist.split(',')[0] || artist);
  if (a && t) return `${t}::${a}`;
  return '';
}

export function findDuplicateHistoryMatch(
  candidate: { fileName: string; title?: string; artist?: string },
  history: UploadHistoryItem[]
): UploadHistoryItem | null {
  if (history.length === 0) return null;

  const candFileKey = normalizeFileKey(candidate.fileName || '');
  const candTitle = candidate.title || '';
  const candArtist = candidate.artist || '';
  const candTrackKey = candTitle ? normalizeTrackKey(candTitle, candArtist) : '';
  const candSwappedKey = candTitle && candArtist ? buildSwappedTrackKey(candTitle, candArtist) : '';
  const candTitleOnly = normalizeTextClient(cleanTitleClient(candTitle));

  for (const item of history) {
    // 1. Exact normalized filename match
    if (candFileKey && item.fileKey && candFileKey === item.fileKey) {
      return item;
    }
    // 2. Exact artist::title match
    if (candTrackKey && item.trackKey && candTrackKey === item.trackKey) {
      return item;
    }
    // 3. Swapped title::artist match
    if (candSwappedKey && item.trackKey && candSwappedKey === item.trackKey) {
      return item;
    }
    // 4. Cross-match filename stem with stored trackKey ("artist title")
    if (candFileKey && item.title) {
      const itemFull = normalizeTextClient(
        `${item.artist ? `${item.artist} ` : ''}${cleanTitleClient(item.title)}`
      );
      if (itemFull && itemFull.length >= 6 && candFileKey === itemFull) {
        return item;
      }
    }
    // 5. Same clean title when artist is absent on one side
    if (
      candTitleOnly &&
      candTitleOnly.length >= 5 &&
      (!candArtist || !item.artist) &&
      normalizeTextClient(cleanTitleClient(item.title)) === candTitleOnly
    ) {
      return item;
    }
  }

  return null;
}

export function loadLocalUploadHistory(): UploadHistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as UploadHistoryItem[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalUploadHistory(items: UploadHistoryItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 2000)));
  } catch {
    // Ignore storage quota errors
  }
}

export function mergeUploadHistories(
  primary: UploadHistoryItem[],
  secondary: UploadHistoryItem[]
): UploadHistoryItem[] {
  const byKey = new Map<string, UploadHistoryItem>();
  const addItem = (item: UploadHistoryItem) => {
    const dedupeKey = item.trackKey || item.fileKey || item.id;
    const existing = byKey.get(dedupeKey);
    if (!existing) {
      byKey.set(dedupeKey, item);
      return;
    }
    const newerTime =
      new Date(item.uploadedAt).getTime() >= new Date(existing.uploadedAt).getTime()
        ? item.uploadedAt
        : existing.uploadedAt;
    byKey.set(dedupeKey, {
      ...existing,
      ...item,
      pushedToApp: existing.pushedToApp || item.pushedToApp,
      pushedAt: item.pushedAt || existing.pushedAt || null,
      uploadedAt: newerTime,
    });
  };

  primary.forEach(addItem);
  secondary.forEach(addItem);

  return Array.from(byKey.values())
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
    .slice(0, 2000);
}
