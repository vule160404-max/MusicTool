import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

interface ArchiverInstance {
  on(event: 'error', listener: (err: Error) => void): this;
  pipe<T extends NodeJS.WritableStream>(destination: T): T;
  file(source: string, data: { name: string }): this;
  finalize(): Promise<void>;
}

const require = createRequire(import.meta.url);
const { ZipArchive } = require('archiver') as {
  ZipArchive: new (options?: { zlib?: { level?: number } }) => ArchiverInstance;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.DEFAULT_APP_PORT) || 3000;
const WORKSPACE_DIR = '/tmp/spotflow_downloads';
const FFMPEG_PATH = '/usr/bin/ffmpeg';
const FFPROBE_PATH = '/usr/bin/ffprobe';

type JobState = 'queued' | 'converting' | 'done' | 'error';

interface DownloadJob {
  jobId: string;
  trackId: string;
  title: string;
  artist: string;
  album: string;
  bitrate: number;
  state: JobState;
  progress: number;
  message: string;
  filePath: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  coverUrl?: string | null;
  durationMs?: number;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  webhookStatus?: 'idle' | 'pushing' | 'pushed' | 'error';
  webhookMessage?: string | null;
  pushedAt?: string | null;
  sourceFileName?: string | null;
}

interface UploadHistoryItem {
  id: string;
  trackKey: string;
  fileKey: string;
  title: string;
  artist: string;
  album?: string;
  fileName: string;
  fileSizeBytes?: number | null;
  pushedToApp: boolean;
  uploadedAt: string;
  pushedAt?: string | null;
}

interface IntegrationSettings {
  apiKey: string;
  webhookUrl: string;
  autoPushWebhook: boolean;
}

interface ItunesSearchResult {
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
}

const SETTINGS_FILE = path.join(WORKSPACE_DIR, 'integration_settings.json');
const UPLOAD_HISTORY_FILE = path.join(WORKSPACE_DIR, 'upload_history.json');
const jobs = new Map<string, DownloadJob>();
let uploadHistory: UploadHistoryItem[] = [];
const integrationSettings: IntegrationSettings = {
  apiKey: `sf_live_${crypto.randomBytes(16).toString('hex')}`,
  webhookUrl: '',
  autoPushWebhook: false,
};

async function loadIntegrationSettings(): Promise<void> {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return;
    const raw = await fsp.readFile(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<IntegrationSettings>;
    if (typeof parsed.apiKey === 'string' && parsed.apiKey.trim()) {
      integrationSettings.apiKey = parsed.apiKey.trim();
    }
    if (typeof parsed.webhookUrl === 'string') {
      integrationSettings.webhookUrl = parsed.webhookUrl.trim();
    }
    if (typeof parsed.autoPushWebhook === 'boolean') {
      integrationSettings.autoPushWebhook = parsed.autoPushWebhook;
    }
  } catch {
    // Ignore malformed file
  }
}

async function saveIntegrationSettings(): Promise<void> {
  try {
    await ensureWorkspace();
    await fsp.writeFile(SETTINGS_FILE, JSON.stringify(integrationSettings, null, 2), 'utf8');
  } catch {
    // Ignore disk write error
  }
}

async function loadUploadHistory(): Promise<void> {
  try {
    if (!fs.existsSync(UPLOAD_HISTORY_FILE)) return;
    const raw = await fsp.readFile(UPLOAD_HISTORY_FILE, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      uploadHistory = (parsed as UploadHistoryItem[]).slice(0, 2000);
    }
  } catch {
    // Ignore malformed history file
  }
}

async function saveUploadHistory(): Promise<void> {
  try {
    await ensureWorkspace();
    await fsp.writeFile(UPLOAD_HISTORY_FILE, JSON.stringify(uploadHistory.slice(0, 2000), null, 2), 'utf8');
  } catch {
    // Ignore disk write error
  }
}

async function ensureWorkspace(): Promise<void> {
  await fsp.mkdir(WORKSPACE_DIR, { recursive: true });
}

function stripDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function normalizeForMatch(input: string): string {
  return stripDiacritics(input)
    .toLowerCase()
    .replace(/['’"`.,!?()[\]{}:;+~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTrackTitleForSearch(title: string): string {
  const cleaned = title
    .replace(
      /\((?:feat\.?|ft\.?|with|explicit|explicit ver\.?|ost[^)]*|from [^)]*|radio edit|single version|remaster(?:ed)?[^)]*|official[^)]*|lyric(?:s)?[^)]*|audio|mv|live[^)]*|acoustic[^)]*|remix[^)]*|ver\.?[^)]*)\)/gi,
      ' '
    )
    .replace(/\[(?:feat\.?|ft\.?|ost[^\]]*|from [^\]]*|explicit[^\]]*|official[^\]]*|lyric[^\]]*|mv[^\]]*|4k|hd|vietsub[^\]]*)\]/gi, ' ')
    .replace(/\s+(?:feat\.?|ft\.?|prod\.?)\s+.+$/i, '')
    .replace(/\s+[-–|]\s+(?:single version|explicit|remastered.*|from .*|official.*|lyric.*)$/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || title.trim();
}

function splitArtistCandidates(artistRaw: string): string[] {
  const raw = artistRaw.trim();
  if (!raw) return [];
  const list: string[] = [raw];
  const beforeComma = raw.split(',')[0].trim();
  if (beforeComma && !list.includes(beforeComma)) list.push(beforeComma);

  const parts = raw
    .split(/\s*(?:,|&|\/|\+|feat\.?|ft\.?|with|vs\.?|\bx\b)\s*/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);

  for (const p of parts) {
    if (!list.some((x) => x.toLowerCase() === p.toLowerCase())) {
      list.push(p);
    }
  }
  return list.slice(0, 4);
}

function buildTitleCandidates(titleRaw: string): string[] {
  const candidates: string[] = [];
  const pushUnique = (val: string) => {
    const v = val.replace(/\s+/g, ' ').trim();
    if (v && !candidates.some((c) => c.toLowerCase() === v.toLowerCase())) {
      candidates.push(v);
    }
  };

  const cleaned = cleanTrackTitleForSearch(titleRaw);
  pushUnique(cleaned);

  // Also strip any remaining parentheticals or brackets
  const noParens = cleaned.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  pushUnique(noParens);

  // Strip trailing question/exclamation marks for stricter APIs
  pushUnique(noParens.replace(/[?!.]+$/g, '').trim());
  if (titleRaw.trim() !== cleaned) {
    pushUnique(titleRaw.trim());
  }
  return candidates.slice(0, 4);
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function parseTrackFilename(rawName: string): { title: string; artist: string } {
  const withoutExt = rawName.replace(/\.[a-zA-Z0-9]{2,5}$/, '');
  const withoutSitePrefix = withoutExt
    .replace(/^(?:y2mate\.com|yt1s\.com|snapsave\.io|x2convert\.com|mp3juices?|zmp3|nhaccuatui)\s*[-–_|]\s*/i, '')
    .replace(/^\d{1,3}\s*[._-]\s*/, '');

  const cleaned = withoutSitePrefix
    .replace(/_/g, ' ')
    .replace(
      /[\[(](?:official\s*(?:music\s*)?video|official\s*mv|official\s*audio|lyric(?:s)?\s*video|audio|mv|hd|4k|vietsub|320\s*kbps|128\s*kbps|lossless|full)[\])]/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();

  const sepMatch = cleaned.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (sepMatch) {
    return {
      artist: sepMatch[1].trim(),
      title: sepMatch[2].trim(),
    };
  }

  return {
    artist: '',
    title: cleaned || withoutExt.trim() || 'Unknown Track',
  };
}

function buildFileKeyServer(fileName: string): string {
  const withoutExt = fileName.replace(/\.[a-zA-Z0-9]{2,5}$/, '');
  const cleaned = withoutExt
    .replace(/^(?:y2mate\.com|yt1s\.com|snapsave\.io|x2convert\.com|mp3juices?|zmp3|nhaccuatui)\s*[-–_|]\s*/i, '')
    .replace(/^\d{1,3}\s*[._-]\s*/, '')
    .replace(/_/g, ' ');
  return normalizeForMatch(cleanTrackTitleForSearch(cleaned));
}

function buildTrackKeyServer(title: string, artist: string): string {
  const t = normalizeForMatch(cleanTrackTitleForSearch(title));
  const a = normalizeForMatch(artist.split(',')[0] || artist);
  if (a && t) return `${a}::${t}`;
  return t || a;
}

async function upsertUploadHistoryItem(input: {
  title: string;
  artist: string;
  album?: string;
  fileName: string;
  fileSizeBytes?: number | null;
  pushedToApp?: boolean;
  pushedAt?: string | null;
}): Promise<UploadHistoryItem> {
  const title = (input.title || 'Unknown Track').trim();
  const artist = (input.artist || '').trim();
  const fileName = (input.fileName || `${artist ? `${artist} - ` : ''}${title}.mp3`).trim();
  const trackKey = buildTrackKeyServer(title, artist);
  const fileKey = buildFileKeyServer(fileName);
  const nowIso = new Date().toISOString();

  const existingIdx = uploadHistory.findIndex(
    (item) =>
      (trackKey && item.trackKey === trackKey) ||
      (fileKey && item.fileKey === fileKey)
  );

  if (existingIdx >= 0) {
    const existing = uploadHistory[existingIdx];
    const updated: UploadHistoryItem = {
      ...existing,
      title: title || existing.title,
      artist: artist || existing.artist,
      album: input.album || existing.album,
      fileName: fileName || existing.fileName,
      fileSizeBytes: input.fileSizeBytes ?? existing.fileSizeBytes,
      pushedToApp: Boolean(existing.pushedToApp || input.pushedToApp),
      pushedAt: input.pushedAt || existing.pushedAt || null,
      uploadedAt: nowIso,
    };
    uploadHistory.splice(existingIdx, 1);
    uploadHistory.unshift(updated);
    await saveUploadHistory();
    return updated;
  }

  const created: UploadHistoryItem = {
    id: `hist_${crypto.randomBytes(6).toString('hex')}`,
    trackKey,
    fileKey,
    title,
    artist,
    album: input.album || undefined,
    fileName,
    fileSizeBytes: input.fileSizeBytes ?? null,
    pushedToApp: Boolean(input.pushedToApp),
    uploadedAt: nowIso,
    pushedAt: input.pushedAt || null,
  };
  uploadHistory.unshift(created);
  if (uploadHistory.length > 2000) {
    uploadHistory = uploadHistory.slice(0, 2000);
  }
  await saveUploadHistory();
  return created;
}

function runProcessCapture(
  cmd: string,
  args: string[],
  timeoutMs = 30000
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Quá thời gian xử lý (${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}

async function probeAudioDurationSec(filePath: string): Promise<number> {
  try {
    const res = await runProcessCapture(
      FFPROBE_PATH,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        filePath,
      ],
      10000
    );
    const val = parseFloat(res.stdout.trim());
    return Number.isFinite(val) ? val : 0;
  } catch {
    return 0;
  }
}

async function probeAudioEmbeddedTags(filePath: string): Promise<{
  title?: string;
  artist?: string;
  album?: string;
  lyrics?: string;
}> {
  try {
    const res = await runProcessCapture(
      FFPROBE_PATH,
      ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', filePath],
      10000
    );
    if (res.code !== 0 || !res.stdout.trim()) return {};
    const parsed = JSON.parse(res.stdout) as {
      format?: { tags?: Record<string, string> };
    };
    const tags = parsed.format?.tags || {};
    const lowerMap = new Map<string, string>();
    for (const [k, v] of Object.entries(tags)) {
      if (typeof v === 'string' && v.trim()) {
        lowerMap.set(k.toLowerCase(), v.trim());
      }
    }
    const lyrics =
      lowerMap.get('lyrics') ||
      lowerMap.get('lyrics-eng') ||
      lowerMap.get('lyrics-vie') ||
      lowerMap.get('unsyncedlyrics') ||
      Array.from(lowerMap.entries()).find(([k]) => k.startsWith('lyrics'))?.[1];

    return {
      title: lowerMap.get('title'),
      artist: lowerMap.get('artist'),
      album: lowerMap.get('album'),
      lyrics: lyrics && lyrics.length > 20 ? lyrics : undefined,
    };
  } catch {
    return {};
  }
}

async function downloadFileBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function searchTrackCoverAndMeta(
  title: string,
  artist: string
): Promise<{
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  durationMs: number;
} | null> {
  const cleanTitle = cleanTrackTitleForSearch(title);
  const query = `${artist} ${cleanTitle}`.replace(/\s+/g, ' ').trim();
  if (!query) return null;

  const countries = ['vn', 'us'];
  let bestMatch: ItunesSearchResult | null = null;
  let bestScore = -999;

  for (const country of countries) {
    try {
      const url = `https://itunes.apple.com/search?media=music&entity=song&limit=6&country=${country}&term=${encodeURIComponent(
        query
      )}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'SpotFlow-MP3/1.0' } });
      if (!res.ok) continue;
      const data = (await res.json()) as { results?: ItunesSearchResult[] };
      const results = data.results || [];
      if (results.length === 0) continue;

      const normTarget = normalizeForMatch(query);
      const targetTokens = normTarget.split(' ').filter((w) => w.length >= 2);

      for (const item of results) {
        const itemTitle = item.trackName || '';
        const itemArtist = item.artistName || '';
        const normItem = normalizeForMatch(`${itemTitle} ${itemArtist}`);

        let score = 0;
        if (targetTokens.length > 0) {
          let hits = 0;
          for (const tok of targetTokens) {
            if (normItem.includes(tok)) hits++;
          }
          score += Math.round((hits / targetTokens.length) * 80);
        }
        if (normalizeForMatch(itemTitle) === normalizeForMatch(cleanTitle)) {
          score += 30;
        }
        if (artist && normalizeForMatch(itemArtist).includes(normalizeForMatch(artist.split(',')[0]))) {
          score += 20;
        }
        const penaltyWords = ['karaoke', 'instrumental', 'tribute', 'cover', '8-bit'];
        for (const pw of penaltyWords) {
          if (normalizeForMatch(itemTitle).includes(pw) && !normTarget.includes(pw)) {
            score -= 50;
          }
        }

        if (score > bestScore) {
          bestScore = score;
          bestMatch = item;
        }
      }

      if (bestMatch && bestScore >= 70) break;
    } catch {
      // Try next region
    }
  }

  if (!bestMatch || bestScore < 30) return null;

  const rawArtwork = bestMatch.artworkUrl100 || '';
  const highResCover = rawArtwork
    ? rawArtwork.replace(/100x100bb\.(jpg|png)/i, '600x600bb.$1')
    : '';

  return {
    title: bestMatch.trackName || title,
    artist: bestMatch.artistName || artist,
    album: bestMatch.collectionName || '',
    coverUrl: highResCover,
    durationMs: Number(bestMatch.trackTimeMillis) || 0,
  };
}

interface LrclibItem {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string;
  syncedLyrics?: string;
}

function lrcToPlainText(lrc: string): string {
  return lrc
    .split(/\r?\n/)
    .map((line) => line.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, '').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

function tokenOverlapRatio(a: string, b: string): number {
  const toksA = normalizeForMatch(a)
    .split(' ')
    .filter((t) => t.length >= 1);
  const normB = normalizeForMatch(b);
  if (toksA.length === 0 || !normB) return 0;
  let hits = 0;
  for (const tok of toksA) {
    if (normB.includes(tok)) hits++;
  }
  return hits / toksA.length;
}

function scoreLrclibCandidate(
  item: LrclibItem,
  titleCandidates: string[],
  artistCandidates: string[],
  durationSec?: number
): number {
  if (item.instrumental) return -999;
  if (!item.syncedLyrics?.trim() && !item.plainLyrics?.trim()) return -999;

  const itemTitle = item.trackName || '';
  const itemArtist = item.artistName || '';
  const normItemTitle = normalizeForMatch(itemTitle);
  const normItemArtist = normalizeForMatch(itemArtist);
  if (!normItemTitle) return -999;

  // Title score: require meaningful title match so album-only hits are rejected
  let titleScore = 0;
  for (const cand of titleCandidates) {
    const normCand = normalizeForMatch(cand);
    if (!normCand) continue;
    if (normItemTitle === normCand) {
      titleScore = Math.max(titleScore, 60);
    } else if (normItemTitle.includes(normCand) || normCand.includes(normItemTitle)) {
      titleScore = Math.max(titleScore, 42);
    } else {
      const ratio = tokenOverlapRatio(cand, itemTitle);
      if (ratio >= 0.65) {
        titleScore = Math.max(titleScore, Math.round(ratio * 36));
      }
    }
  }
  if (titleScore === 0) return -999;

  // Artist score
  let artistScore = 0;
  if (artistCandidates.length > 0 && normItemArtist) {
    for (const art of artistCandidates) {
      const normArt = normalizeForMatch(art);
      if (!normArt) continue;
      if (normItemArtist === normArt || normItemArtist.includes(normArt) || normArt.includes(normItemArtist)) {
        artistScore = Math.max(artistScore, 40);
      } else {
        const ratio = tokenOverlapRatio(art, itemArtist);
        if (ratio >= 0.5) {
          artistScore = Math.max(artistScore, Math.round(ratio * 30));
        }
      }
    }
    if (artistScore === 0) {
      artistScore = -35;
    }
  }

  // Duration score
  let durationScore = 0;
  if (durationSec && durationSec > 0 && typeof item.duration === 'number' && item.duration > 0) {
    const diff = Math.abs(item.duration - durationSec);
    if (diff <= 4) durationScore = 30;
    else if (diff <= 10) durationScore = 18;
    else if (diff <= 20) durationScore = 6;
    else if (diff > 35) durationScore = -30;
  }

  const syncBonus = item.syncedLyrics?.trim() ? 25 : 5;
  return titleScore + artistScore + durationScore + syncBonus;
}

async function fetchLrclibJson(url: string): Promise<LrclibItem[]> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SpotFlow-MP3/1.0 (contact@spotflow.app)' },
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as LrclibItem | LrclibItem[];
    return Array.isArray(data) ? data : data ? [data] : [];
  } catch {
    return [];
  }
}

async function searchLrclibLyrics(
  titleCandidates: string[],
  artistCandidates: string[],
  albumName?: string,
  durationSec?: number
): Promise<{ syncedLyrics: string | null; plainLyrics: string | null; score: number } | null> {
  const primaryTitle = titleCandidates[0] || '';
  const primaryArtist = artistCandidates[1] || artistCandidates[0] || '';
  if (!primaryTitle) return null;

  let bestItem: LrclibItem | null = null;
  let bestScore = -999;

  const evaluate = (items: LrclibItem[]) => {
    for (const item of items) {
      const s = scoreLrclibCandidate(item, titleCandidates, artistCandidates, durationSec);
      if (s > bestScore) {
        bestScore = s;
        bestItem = item;
      }
    }
  };

  // 1. Exact /api/get when artist & title are available
  if (primaryArtist) {
    const params = new URLSearchParams({
      track_name: primaryTitle,
      artist_name: primaryArtist,
    });
    if (albumName) params.set('album_name', albumName);
    if (durationSec && durationSec > 0) params.set('duration', String(Math.round(durationSec)));
    evaluate(await fetchLrclibJson(`https://lrclib.net/api/get?${params.toString()}`));
    if (bestItem && bestScore >= 90 && (bestItem as LrclibItem).syncedLyrics) {
      return {
        syncedLyrics: (bestItem as LrclibItem).syncedLyrics || null,
        plainLyrics: (bestItem as LrclibItem).plainLyrics || null,
        score: bestScore,
      };
    }
  }

  // 2. Structured search across top title/artist pairs
  const pairs: Array<[string, string]> = [];
  for (const t of titleCandidates.slice(0, 2)) {
    for (const a of artistCandidates.slice(0, 2)) {
      pairs.push([t, a]);
    }
  }
  if (pairs.length === 0) pairs.push([primaryTitle, '']);

  for (const [t, a] of pairs) {
    const url = a
      ? `https://lrclib.net/api/search?track_name=${encodeURIComponent(t)}&artist_name=${encodeURIComponent(a)}`
      : `https://lrclib.net/api/search?track_name=${encodeURIComponent(t)}`;
    evaluate(await fetchLrclibJson(url));
    if (bestItem && bestScore >= 85 && (bestItem as LrclibItem).syncedLyrics) {
      return {
        syncedLyrics: (bestItem as LrclibItem).syncedLyrics || null,
        plainLyrics: (bestItem as LrclibItem).plainLyrics || null,
        score: bestScore,
      };
    }
  }

  // 3. Combined q search (normal + diacritics stripped)
  const qQueries = new Set<string>();
  if (primaryArtist) qQueries.add(`${primaryTitle} ${primaryArtist}`);
  qQueries.add(primaryTitle);
  const asciiTitle = stripDiacritics(primaryTitle);
  const asciiArtist = stripDiacritics(primaryArtist);
  if (asciiTitle !== primaryTitle || asciiArtist !== primaryArtist) {
    qQueries.add(`${asciiTitle} ${asciiArtist}`.trim());
  }

  for (const q of qQueries) {
    evaluate(await fetchLrclibJson(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`));
    if (bestItem && bestScore >= 85 && (bestItem as LrclibItem).syncedLyrics) {
      break;
    }
  }

  const minThreshold = artistCandidates.length > 0 ? 50 : 60;
  if (!bestItem || bestScore < minThreshold) return null;

  const chosen = bestItem as LrclibItem;
  return {
    syncedLyrics: chosen.syncedLyrics?.trim() || null,
    plainLyrics:
      chosen.plainLyrics?.trim() ||
      (chosen.syncedLyrics ? lrcToPlainText(chosen.syncedLyrics) : null),
    score: bestScore,
  };
}

async function searchNeteaseLyrics(
  titleCandidates: string[],
  artistCandidates: string[],
  durationSec?: number
): Promise<{ syncedLyrics: string | null; plainLyrics: string | null } | null> {
  const title = titleCandidates[0] || '';
  const artist = artistCandidates[1] || artistCandidates[0] || '';
  if (!title) return null;

  try {
    const q = `${title} ${artist}`.trim();
    const searchRes = await fetch(
      `https://music.xianqiao.wang/neteaseapiv2/search?keywords=${encodeURIComponent(q)}&limit=5`,
      { signal: AbortSignal.timeout(4500) }
    );
    if (!searchRes.ok) return null;
    const searchData = (await searchRes.json()) as {
      result?: {
        songs?: Array<{
          id?: number;
          name?: string;
          duration?: number;
          artists?: Array<{ name?: string }>;
        }>;
      };
    };

    const songs = searchData.result?.songs || [];
    if (songs.length === 0) return null;

    let bestSongId: number | null = null;
    let bestScore = -999;

    for (const song of songs) {
      if (!song.id || !song.name) continue;
      const songArtists = (song.artists || []).map((a) => a.name || '').join(' ');
      let titleScore = 0;
      for (const cand of titleCandidates) {
        const normC = normalizeForMatch(cand);
        const normS = normalizeForMatch(song.name);
        if (!normC || !normS) continue;
        if (normS === normC) titleScore = Math.max(titleScore, 60);
        else if (normS.includes(normC) || normC.includes(normS)) titleScore = Math.max(titleScore, 42);
        else {
          const r = tokenOverlapRatio(cand, song.name);
          if (r >= 0.65) titleScore = Math.max(titleScore, Math.round(r * 35));
        }
      }
      if (titleScore === 0) continue;

      let artistScore = 0;
      if (artistCandidates.length > 0 && songArtists) {
        for (const a of artistCandidates) {
          const r = tokenOverlapRatio(a, songArtists);
          if (r >= 0.5) artistScore = Math.max(artistScore, Math.round(r * 40));
        }
        if (artistScore === 0) artistScore = -35;
      }

      let durScore = 0;
      if (durationSec && durationSec > 0 && song.duration && song.duration > 0) {
        const diff = Math.abs(song.duration / 1000 - durationSec);
        if (diff <= 5) durScore = 25;
        else if (diff <= 15) durScore = 10;
        else if (diff > 35) durScore = -25;
      }

      const total = titleScore + artistScore + durScore;
      if (total > bestScore) {
        bestScore = total;
        bestSongId = song.id;
      }
    }

    if (!bestSongId || bestScore < 55) return null;

    const lrcRes = await fetch(
      `https://music.xianqiao.wang/neteaseapiv2/lyric?id=${bestSongId}`,
      { signal: AbortSignal.timeout(4500) }
    );
    if (!lrcRes.ok) return null;
    const lrcData = (await lrcRes.json()) as { lrc?: { lyric?: string } };
    const rawLrc = lrcData.lrc?.lyric?.trim();
    if (!rawLrc || rawLrc.length < 30) return null;

    // Filter out instrumental-only notices
    if (/纯音乐.*请欣赏/i.test(rawLrc) && rawLrc.split('\n').length < 4) return null;

    const isSynced = /\[\d{1,2}:\d{2}/.test(rawLrc);
    const cleanedLines = rawLrc
      .split(/\r?\n/)
      .filter((line) => !/^\[\d{2}:\d{2}[.:]\d+\]\s*(?:作词|作曲|编曲|制作人)\s*[:：]/.test(line))
      .join('\n')
      .trim();

    const plain = isSynced ? lrcToPlainText(cleanedLines) : cleanedLines;
    if (!plain || plain.length < 20) return null;

    return {
      syncedLyrics: isSynced ? cleanedLines : null,
      plainLyrics: plain,
    };
  } catch {
    return null;
  }
}

async function searchLyricsOvh(
  titleCandidates: string[],
  artistCandidates: string[]
): Promise<{ syncedLyrics: string | null; plainLyrics: string | null } | null> {
  if (artistCandidates.length === 0 || titleCandidates.length === 0) return null;

  const titlesToTry = titleCandidates.slice(0, 2);
  const artistsToTry = artistCandidates.slice(0, 2);

  for (const artist of artistsToTry) {
    for (const title of titlesToTry) {
      try {
        const res = await fetch(
          `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
          { signal: AbortSignal.timeout(3500) }
        );
        if (!res.ok) continue;
        const data = (await res.json()) as { lyrics?: string };
        const text = data.lyrics
          ?.replace(/^Paroles de la chanson .+?\r?\n/i, '')
          .replace(/\r\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        if (text && text.length > 25) {
          return { syncedLyrics: null, plainLyrics: text };
        }
      } catch {
        // Try next candidate
      }
    }
  }
  return null;
}

async function fetchLyrics(
  trackName: string,
  artistName: string,
  durationSec?: number,
  albumName?: string
): Promise<{ syncedLyrics: string | null; plainLyrics: string | null; source?: string }> {
  const titleCandidates = buildTitleCandidates(trackName);
  const artistCandidates = splitArtistCandidates(artistName);
  if (titleCandidates.length === 0) {
    return { syncedLyrics: null, plainLyrics: null };
  }

  // 1. Primary: LRCLIB with strict scoring & multi-variant query cascade
  const lrcResult = await searchLrclibLyrics(
    titleCandidates,
    artistCandidates,
    albumName,
    durationSec
  );
  if (lrcResult?.syncedLyrics) {
    return {
      syncedLyrics: lrcResult.syncedLyrics,
      plainLyrics: lrcResult.plainLyrics,
      source: 'lrclib',
    };
  }

  // 2. Fallback: NetEase Cloud Music (great coverage + synced LRC for V-Pop / Asian / Indie)
  const neteaseResult = await searchNeteaseLyrics(titleCandidates, artistCandidates, durationSec);
  if (neteaseResult?.syncedLyrics) {
    return { ...neteaseResult, source: 'netease' };
  }

  // If LRCLIB had plainLyrics, prefer it or NetEase plainLyrics
  if (lrcResult?.plainLyrics) {
    return {
      syncedLyrics: null,
      plainLyrics: lrcResult.plainLyrics,
      source: 'lrclib-plain',
    };
  }
  if (neteaseResult?.plainLyrics) {
    return { ...neteaseResult, source: 'netease-plain' };
  }

  // 3. Fallback: lyrics.ovh
  const ovhResult = await searchLyricsOvh(titleCandidates, artistCandidates);
  if (ovhResult) {
    return { ...ovhResult, source: 'lyrics.ovh' };
  }

  return { syncedLyrics: null, plainLyrics: null };
}

async function enrichTrackMetadata(input: {
  fileName?: string;
  title?: string;
  artist?: string;
  album?: string;
  durationSec?: number;
}): Promise<{
  matched: boolean;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  coverUrl: string;
  syncedLyrics: string | null;
  plainLyrics: string | null;
  lyricsSource?: string;
}> {
  const parsed = input.fileName ? parseTrackFilename(input.fileName) : { title: '', artist: '' };
  const initialTitle = (input.title || parsed.title || '').trim();
  const initialArtist = (input.artist || parsed.artist || '').trim();

  let meta = await searchTrackCoverAndMeta(initialTitle, initialArtist);

  if (!meta && initialArtist && initialTitle) {
    meta = await searchTrackCoverAndMeta(initialArtist, initialTitle);
  }

  const resolvedTitle = meta?.title || initialTitle || 'Unknown Track';
  const resolvedArtist = meta?.artist || initialArtist || 'Unknown Artist';
  const resolvedAlbum = meta?.album || input.album || '';
  const resolvedDurationSec =
    input.durationSec && input.durationSec > 0
      ? input.durationSec
      : meta?.durationMs
      ? Math.round(meta.durationMs / 1000)
      : undefined;

  const lyrics = await fetchLyrics(
    resolvedTitle,
    resolvedArtist,
    resolvedDurationSec,
    resolvedAlbum
  );

  // If iTunes adjusted the title/artist (e.g. translated or added OST tag) and lyrics missed, retry with initial raw title/artist!
  let finalLyrics = lyrics;
  if (
    !finalLyrics.syncedLyrics &&
    !finalLyrics.plainLyrics &&
    initialTitle &&
    normalizeForMatch(initialTitle) !== normalizeForMatch(resolvedTitle)
  ) {
    const retryLyrics = await fetchLyrics(initialTitle, initialArtist || resolvedArtist, resolvedDurationSec);
    if (retryLyrics.syncedLyrics || retryLyrics.plainLyrics) {
      finalLyrics = retryLyrics;
    }
  }

  return {
    matched: Boolean(meta?.coverUrl || finalLyrics.syncedLyrics || finalLyrics.plainLyrics),
    title: resolvedTitle,
    artist: resolvedArtist,
    album: resolvedAlbum,
    durationMs: meta?.durationMs || (input.durationSec ? Math.round(input.durationSec * 1000) : 0),
    coverUrl: meta?.coverUrl || '',
    syncedLyrics: finalLyrics.syncedLyrics,
    plainLyrics: finalLyrics.plainLyrics,
    lyricsSource: finalLyrics.source,
  };
}

async function pushJobToWebhook(
  job: DownloadJob,
  reqHost: string,
  reqProtocol: string,
  targetWebhookUrl?: string
): Promise<{ success: boolean; status: number; message: string }> {
  const webhookUrl = (targetWebhookUrl || integrationSettings.webhookUrl || '').trim();
  if (!webhookUrl) {
    return { success: false, status: 400, message: 'Chưa cấu hình Webhook URL.' };
  }

  job.webhookStatus = 'pushing';
  job.webhookMessage = 'Đang đẩy bài hát sang App...';
  job.updatedAt = Date.now();

  try {
    const payload = {
      event: 'track_downloaded',
      timestamp: new Date().toISOString(),
      track: {
        id: job.trackId,
        title: job.title,
        artist: job.artist,
        album: job.album,
        bitrate: job.bitrate,
        fileName: job.fileName,
        fileSizeBytes: job.fileSizeBytes,
        downloadUrl: `${reqProtocol}://${reqHost}/api/download/file/${job.jobId}`,
        coverUrl: job.coverUrl || null,
        durationMs: job.durationMs || 0,
        syncedLyrics: job.syncedLyrics || null,
        plainLyrics: job.plainLyrics || null,
      },
    };

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': integrationSettings.apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45000),
    });

    const respText = await res.text().catch(() => '');
    let parsedMsg = '';
    try {
      const json = JSON.parse(respText) as { message?: string; error?: string };
      parsedMsg = json.message || json.error || '';
    } catch {
      parsedMsg = respText.slice(0, 140);
    }

    if (res.ok) {
      job.webhookStatus = 'pushed';
      job.webhookMessage = parsedMsg || `Đã đẩy sang App (${res.status})`;
      job.pushedAt = new Date().toISOString();
      job.updatedAt = Date.now();
      await upsertUploadHistoryItem({
        title: job.title,
        artist: job.artist,
        album: job.album,
        fileName: job.sourceFileName || job.fileName || `${job.artist} - ${job.title}.mp3`,
        fileSizeBytes: job.fileSizeBytes,
        pushedToApp: true,
        pushedAt: job.pushedAt,
      });
      return { success: true, status: res.status, message: job.webhookMessage };
    }

    job.webhookStatus = 'error';
    job.webhookMessage = parsedMsg
      ? `App báo lỗi ${res.status}: ${parsedMsg}`
      : `App phản hồi mã lỗi ${res.status}`;
    job.updatedAt = Date.now();
    return { success: false, status: res.status, message: job.webhookMessage };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Không thể kết nối tới Webhook URL của App.';
    job.webhookStatus = 'error';
    job.webhookMessage = msg;
    job.updatedAt = Date.now();
    return { success: false, status: 500, message: msg };
  }
}

async function triggerWebhookNotification(job: DownloadJob, reqHost: string, reqProtocol: string) {
  if (!integrationSettings.autoPushWebhook || !integrationSettings.webhookUrl) return;
  await pushJobToWebhook(job, reqHost, reqProtocol);
}

async function processLocalUploadJob(
  job: DownloadJob,
  rawBuffer: Buffer,
  originalExt: string,
  embedTags: boolean,
  reqHost: string,
  reqProtocol: string
): Promise<void> {
  const tempFiles: string[] = [];
  const safeExt = /^[a-z0-9]{2,5}$/i.test(originalExt) ? originalExt.toLowerCase() : 'mp3';
  const rawInputPath = path.join(WORKSPACE_DIR, `${job.jobId}_upload.${safeExt}`);
  const finalBaseName =
    sanitizeFileName(`${job.artist} - ${job.title}`) || sanitizeFileName(job.title) || `track_${job.jobId}`;
  const finalMp3Path = path.join(WORKSPACE_DIR, `${job.jobId}_${finalBaseName}.mp3`);

  try {
    await ensureWorkspace();
    await fsp.writeFile(rawInputPath, rawBuffer);
    tempFiles.push(rawInputPath);

    job.state = 'converting';
    job.progress = 45;
    job.message = 'Đang tải ảnh bìa & nhúng ID3/Lyrics...';
    job.updatedAt = Date.now();

    const probedSec = await probeAudioDurationSec(rawInputPath);
    if (probedSec > 0) {
      job.durationMs = Math.round(probedSec * 1000);
    }

    if (!job.syncedLyrics && !job.plainLyrics) {
      const embedded = await probeAudioEmbeddedTags(rawInputPath);
      if (embedded.lyrics) {
        const isLrc = /\[\d{1,2}:\d{2}/.test(embedded.lyrics);
        if (isLrc) job.syncedLyrics = embedded.lyrics;
        job.plainLyrics = isLrc ? lrcToPlainText(embedded.lyrics) : embedded.lyrics;
      }
      if ((!job.title || job.title === 'Unknown Track') && embedded.title) {
        job.title = embedded.title;
      }
      if ((!job.artist || job.artist === 'Unknown Artist') && embedded.artist) {
        job.artist = embedded.artist;
      }
    }

    if (!job.coverUrl || (!job.syncedLyrics && !job.plainLyrics)) {
      const enriched = await enrichTrackMetadata({
        title: job.title,
        artist: job.artist,
        album: job.album,
        durationSec: probedSec > 0 ? Math.round(probedSec) : undefined,
      });
      if (!job.coverUrl && enriched.coverUrl) job.coverUrl = enriched.coverUrl;
      if (!job.album && enriched.album) job.album = enriched.album;
      if (!job.syncedLyrics && enriched.syncedLyrics) job.syncedLyrics = enriched.syncedLyrics;
      if (!job.plainLyrics && enriched.plainLyrics) job.plainLyrics = enriched.plainLyrics;
    }

    let coverFilePath: string | null = null;
    if (embedTags && job.coverUrl) {
      const coverBuf = await downloadFileBuffer(job.coverUrl);
      if (coverBuf && coverBuf.length > 500) {
        coverFilePath = path.join(WORKSPACE_DIR, `${job.jobId}_cover.jpg`);
        await fsp.writeFile(coverFilePath, coverBuf);
        tempFiles.push(coverFilePath);
      }
    }

    const ffmpegArgs: string[] = ['-y', '-i', rawInputPath];
    if (coverFilePath) {
      ffmpegArgs.push('-i', coverFilePath, '-map', '0:a', '-map', '1:0');
    } else {
      ffmpegArgs.push('-map', '0:a');
    }

    if (safeExt === 'mp3') {
      ffmpegArgs.push('-c:a', 'copy');
    } else {
      ffmpegArgs.push('-codec:a', 'libmp3lame', '-b:a', `${job.bitrate}k`, '-ar', '44100');
    }

    ffmpegArgs.push('-id3v2_version', '3');

    if (embedTags) {
      ffmpegArgs.push(
        '-metadata',
        `title=${job.title}`,
        '-metadata',
        `artist=${job.artist}`,
        '-metadata',
        `album=${job.album || 'SpotFlow Upload'}`
      );
      if (job.plainLyrics || job.syncedLyrics) {
        ffmpegArgs.push('-metadata', `lyrics=${job.plainLyrics || job.syncedLyrics}`);
      }
      if (coverFilePath) {
        ffmpegArgs.push(
          '-c:v',
          'mjpeg',
          '-metadata:s:v',
          'title=Album cover',
          '-metadata:s:v',
          'comment=Cover (front)'
        );
      }
    }

    ffmpegArgs.push(finalMp3Path);

    const ffRes = await runProcessCapture(FFMPEG_PATH, ffmpegArgs, 90000);
    if (ffRes.code !== 0 || !fs.existsSync(finalMp3Path)) {
      throw new Error('Không thể xử lý file âm thanh bằng FFmpeg.');
    }

    const stat = await fsp.stat(finalMp3Path);
    job.filePath = finalMp3Path;
    job.fileName = `${finalBaseName}.mp3`;
    job.fileSizeBytes = stat.size;

    if (integrationSettings.autoPushWebhook && integrationSettings.webhookUrl) {
      job.progress = 92;
      job.message = 'Đang tự động đẩy bài hát sang App Nhạc...';
      job.webhookStatus = 'pushing';
      job.updatedAt = Date.now();
      await pushJobToWebhook(job, reqHost, reqProtocol);
    }

    job.state = 'done';
    job.progress = 100;
    job.message =
      job.webhookStatus === 'pushed'
        ? 'Đã gắn thẻ & đẩy sang App Nhạc'
        : 'Đã gắn ảnh bìa & lyrics hoàn tất';
    job.updatedAt = Date.now();

    await upsertUploadHistoryItem({
      title: job.title,
      artist: job.artist,
      album: job.album,
      fileName: job.sourceFileName || job.fileName || `${finalBaseName}.mp3`,
      fileSizeBytes: job.fileSizeBytes,
      pushedToApp: job.webhookStatus === 'pushed',
      pushedAt: job.pushedAt || null,
    });
  } catch (err) {
    job.state = 'error';
    job.progress = 0;
    job.error = err instanceof Error ? err.message : 'Lỗi xử lý file tải lên.';
    job.message = job.error;
    job.updatedAt = Date.now();
  } finally {
    for (const f of tempFiles) {
      fsp.unlink(f).catch(() => {});
    }
  }
}

async function cleanupOldFiles(): Promise<void> {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [jobId, job] of jobs.entries()) {
    if (job.updatedAt < cutoff) {
      if (job.filePath) {
        fsp.unlink(job.filePath).catch(() => {});
      }
      jobs.delete(jobId);
    }
  }
}

async function startServer() {
  await ensureWorkspace();
  await loadIntegrationSettings();
  await loadUploadHistory();
  setInterval(() => {
    cleanupOldFiles().catch(() => {});
  }, 15 * 60 * 1000);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, ffmpeg: fs.existsSync(FFMPEG_PATH) });
  });

  app.get('/api/history', (_req: Request, res: Response) => {
    res.json({ total: uploadHistory.length, items: uploadHistory });
  });

  app.post('/api/history', async (req: Request, res: Response) => {
    const body = req.body as {
      items?: Array<{
        title?: string;
        artist?: string;
        album?: string;
        fileName?: string;
        fileSizeBytes?: number | null;
        pushedToApp?: boolean;
      }>;
    };
    const list = Array.isArray(body.items) ? body.items : [];
    for (const item of list) {
      if (!item.title && !item.fileName) continue;
      const parsed = item.fileName ? parseTrackFilename(item.fileName) : { title: '', artist: '' };
      await upsertUploadHistoryItem({
        title: (item.title || parsed.title || 'Unknown Track').trim(),
        artist: (item.artist || parsed.artist || '').trim(),
        album: item.album,
        fileName: (item.fileName || `${item.artist ? `${item.artist} - ` : ''}${item.title}.mp3`).trim(),
        fileSizeBytes: item.fileSizeBytes ?? null,
        pushedToApp: Boolean(item.pushedToApp),
      });
    }
    res.json({ total: uploadHistory.length, items: uploadHistory });
  });

  app.delete('/api/history/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    uploadHistory = uploadHistory.filter((item) => item.id !== id);
    await saveUploadHistory();
    res.json({ total: uploadHistory.length, items: uploadHistory });
  });

  app.delete('/api/history', async (_req: Request, res: Response) => {
    uploadHistory = [];
    await saveUploadHistory();
    res.json({ total: 0, items: [] });
  });

  app.get('/api/integration/settings', (_req: Request, res: Response) => {
    res.json(integrationSettings);
  });

  app.post('/api/integration/settings', async (req: Request, res: Response) => {
    const body = req.body as { webhookUrl?: string; autoPushWebhook?: boolean; regenerateKey?: boolean };
    if (typeof body.webhookUrl === 'string') {
      integrationSettings.webhookUrl = body.webhookUrl.trim();
    }
    if (typeof body.autoPushWebhook === 'boolean') {
      integrationSettings.autoPushWebhook = body.autoPushWebhook;
    }
    if (body.regenerateKey) {
      integrationSettings.apiKey = `sf_live_${crypto.randomBytes(16).toString('hex')}`;
    }
    await saveIntegrationSettings();
    res.json(integrationSettings);
  });

  const requireApiKey = (req: Request, res: Response, next: () => void) => {
    const authHeader = req.headers['authorization'];
    const apiKeyHeader = req.headers['x-api-key'] || req.query.api_key;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (
      (apiKeyHeader && String(apiKeyHeader) === integrationSettings.apiKey) ||
      (bearerToken && bearerToken === integrationSettings.apiKey)
    ) {
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized: Invalid or missing API Key (X-API-Key or Bearer token)' });
    }
  };

  app.get('/api/external/tracks', requireApiKey, (req: Request, res: Response) => {
    const host = req.get('host') || 'localhost:3000';
    const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
    const completedJobs = Array.from(jobs.values()).filter(
      (j) => j.state === 'done' && j.filePath && fs.existsSync(j.filePath)
    );

    const items = completedJobs.map((j) => ({
      jobId: j.jobId,
      trackId: j.trackId,
      title: j.title,
      artist: j.artist,
      album: j.album,
      bitrate: j.bitrate,
      durationMs: j.durationMs || 0,
      fileName: j.fileName,
      fileSizeBytes: j.fileSizeBytes,
      downloadUrl: `${proto}://${host}/api/download/file/${j.jobId}`,
      coverUrl: j.coverUrl || null,
      syncedLyrics: j.syncedLyrics || null,
      plainLyrics: j.plainLyrics || null,
      processedAt: new Date(j.updatedAt).toISOString(),
    }));

    res.json({
      total: items.length,
      tracks: items,
    });
  });

  app.post('/api/metadata/enrich', async (req: Request, res: Response) => {
    try {
      const body = req.body as {
        fileName?: string;
        title?: string;
        artist?: string;
        album?: string;
        durationSec?: number;
      };
      const result = await enrichTrackMetadata(body);
      res.json(result);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Lỗi tìm ảnh bìa và lyrics.',
      });
    }
  });

  app.post('/api/lyrics/search', async (req: Request, res: Response) => {
    try {
      const body = req.body as {
        title?: string;
        artist?: string;
        album?: string;
        durationSec?: number;
      };
      const title = (body.title || '').trim();
      if (!title) {
        res.status(400).json({ error: 'Vui lòng nhập tên bài hát để tìm lyrics.' });
        return;
      }
      const lyrics = await fetchLyrics(title, (body.artist || '').trim(), body.durationSec, body.album);
      res.json({
        found: Boolean(lyrics.syncedLyrics || lyrics.plainLyrics),
        syncedLyrics: lyrics.syncedLyrics,
        plainLyrics: lyrics.plainLyrics,
        source: lyrics.source || null,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Lỗi tìm lời bài hát.',
      });
    }
  });

  app.post('/api/external/enrich', requireApiKey, async (req: Request, res: Response) => {
    try {
      const body = req.body as {
        fileName?: string;
        title?: string;
        artist?: string;
        durationSec?: number;
        includeCoverBase64?: boolean;
      };

      if (!body.fileName && !body.title) {
        res.status(400).json({ error: 'Vui lòng cung cấp fileName hoặc title để tìm ảnh bìa và lyrics.' });
        return;
      }

      const result = await enrichTrackMetadata(body);
      let coverBase64: string | null = null;
      if (body.includeCoverBase64 && result.coverUrl) {
        const buf = await downloadFileBuffer(result.coverUrl);
        if (buf) {
          coverBase64 = `data:image/jpeg;base64,${buf.toString('base64')}`;
        }
      }

      res.json({
        matched: result.matched,
        track: {
          title: result.title,
          artist: result.artist,
          album: result.album,
          durationMs: result.durationMs,
          coverUrl: result.coverUrl || null,
          ...(body.includeCoverBase64 ? { coverBase64 } : {}),
          syncedLyrics: result.syncedLyrics,
          plainLyrics: result.plainLyrics,
        },
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Lỗi tìm thông tin bài hát.',
      });
    }
  });

  app.post('/api/external/webhook-test', requireApiKey, async (req: Request, res: Response) => {
    const body = req.body as { webhookUrl?: string };
    const targetUrl = body.webhookUrl || integrationSettings.webhookUrl;
    if (!targetUrl) {
      res.status(400).json({ error: 'Chưa cấu hình Webhook URL.' });
      return;
    }

    try {
      const testPayload = {
        event: 'ping_test',
        timestamp: new Date().toISOString(),
        message: 'Xin chào từ SpotFlow MP3! Kết nối webhook app nhạc thành công.',
      };
      const testRes = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': integrationSettings.apiKey,
        },
        body: JSON.stringify(testPayload),
      });

      res.json({
        success: testRes.ok,
        status: testRes.status,
        statusText: testRes.statusText,
        message: testRes.ok ? 'Webhook test thành công!' : `Webhook phản hồi mã lỗi ${testRes.status}`,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Không thể kết nối tới Webhook URL.',
      });
    }
  });

  app.post('/api/local/prepare', (req: Request, res: Response) => {
    const body = req.body as {
      fileName?: string;
      title?: string;
      artist?: string;
      album?: string;
      coverUrl?: string;
      bitrate?: number;
      syncedLyrics?: string | null;
      plainLyrics?: string | null;
    };

    if (!body.title && !body.fileName) {
      res.status(400).json({ error: 'Thiếu tên bài hát.' });
      return;
    }

    const bitrate = [192, 256, 320].includes(Number(body.bitrate)) ? Number(body.bitrate) : 320;
    const jobId = crypto.randomBytes(8).toString('hex');
    const trackId = `local_${crypto.randomBytes(6).toString('hex')}`;
    const parsed = body.fileName ? parseTrackFilename(body.fileName) : { title: '', artist: '' };

    const job: DownloadJob = {
      jobId,
      trackId,
      title: (body.title || parsed.title || 'Unknown Track').trim(),
      artist: (body.artist || parsed.artist || 'Unknown Artist').trim(),
      album: (body.album || 'Local Upload').trim(),
      bitrate,
      state: 'queued',
      progress: 10,
      message: 'Đang chờ nhận file âm thanh...',
      filePath: null,
      fileName: body.fileName || null,
      sourceFileName: body.fileName || null,
      fileSizeBytes: null,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      syncedLyrics: body.syncedLyrics ?? null,
      plainLyrics: body.plainLyrics ?? null,
      coverUrl: body.coverUrl?.trim() || null,
      durationMs: 0,
      webhookStatus: 'idle',
      webhookMessage: null,
      pushedAt: null,
    };

    jobs.set(jobId, job);
    res.json({ jobId, job });
  });

  // Push completed tracks directly to the configured Music App Webhook
  app.post('/api/local/push', async (req: Request, res: Response) => {
    const body = req.body as { jobIds?: string[]; webhookUrl?: string };
    const targetUrl = (body.webhookUrl || integrationSettings.webhookUrl || '').trim();
    if (!targetUrl) {
      res.status(400).json({ error: 'Chưa cấu hình Webhook URL trong Liên kết App Nhạc.' });
      return;
    }

    const ids = Array.isArray(body.jobIds) ? body.jobIds : [];
    const targetJobs = ids
      .map((id) => jobs.get(id))
      .filter((j): j is DownloadJob => Boolean(j && j.state === 'done' && j.filePath && fs.existsSync(j.filePath)));

    if (targetJobs.length === 0) {
      res.status(400).json({ error: 'Không có bài hát hoàn tất nào hợp lệ để đẩy sang App.' });
      return;
    }

    const reqHost = req.get('host') || 'localhost:3000';
    const reqProtocol = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();

    const results: Array<{ jobId: string; title: string; success: boolean; status: number; message: string }> = [];
    const updatedJobs: Record<string, DownloadJob> = {};

    for (const job of targetJobs) {
      const outcome = await pushJobToWebhook(job, reqHost, reqProtocol, targetUrl);
      results.push({
        jobId: job.jobId,
        title: job.title,
        ...outcome,
      });
      updatedJobs[job.jobId] = { ...job, filePath: null };
    }

    const pushedCount = results.filter((r) => r.success).length;
    const failedCount = results.length - pushedCount;

    res.json({
      total: results.length,
      pushedCount,
      failedCount,
      results,
      jobs: updatedJobs,
    });
  });

  app.post(
    '/api/local/upload/:jobId',
    express.raw({ type: '*/*', limit: '120mb' }),
    (req: Request, res: Response) => {
      const jobId = String(req.params.jobId);
      const job = jobs.get(jobId);
      if (!job) {
        res.status(404).json({ error: 'Không tìm thấy phiên xử lý file.' });
        return;
      }

      const buf = req.body;
      if (!Buffer.isBuffer(buf) || buf.length === 0) {
        res.status(400).json({ error: 'File tải lên bị rỗng hoặc không hợp lệ.' });
        return;
      }

      const rawName = decodeURIComponent(String(req.headers['x-file-name'] || job.fileName || 'audio.mp3'));
      const extMatch = rawName.match(/\.([a-zA-Z0-9]{2,5})$/);
      const ext = extMatch ? extMatch[1].toLowerCase() : 'mp3';
      const embedTags = String(req.headers['x-embed-tags'] || 'true') !== 'false';
      const reqHost = req.get('host') || 'localhost:3000';
      const reqProtocol = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();

      job.state = 'converting';
      job.progress = 30;
      job.message = 'Đã nhận file, đang gắn ảnh bìa & lyrics...';
      job.updatedAt = Date.now();

      processLocalUploadJob(job, buf, ext, embedTags, reqHost, reqProtocol).catch(() => {});
      res.json({ jobId, job });
    }
  );

  app.post('/api/download/statuses', (req: Request, res: Response) => {
    const body = req.body as { jobIds?: string[] };
    const ids = Array.isArray(body.jobIds) ? body.jobIds : [];
    const result: Record<string, DownloadJob> = {};
    for (const id of ids) {
      const job = jobs.get(id);
      if (job) {
        result[id] = { ...job, filePath: null };
      }
    }
    res.json({ jobs: result });
  });

  app.get('/api/download/status/:jobId', (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const job = jobs.get(jobId);
    if (!job) {
      res.status(404).json({ error: 'Không tìm thấy tiến trình xử lý.' });
      return;
    }
    res.json({ ...job, filePath: null });
  });

  app.get('/api/download/file/:jobId', (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const job = jobs.get(jobId);
    if (!job || job.state !== 'done' || !job.filePath || !fs.existsSync(job.filePath)) {
      res.status(404).json({ error: 'File MP3 chưa sẵn sàng hoặc đã hết hạn.' });
      return;
    }

    const isPreview = req.query.preview === '1';
    const fileName = job.fileName || `${job.trackId}.mp3`;
    const asciiFallback = stripDiacritics(fileName).replace(/[^\x20-\x7E]/g, '') || 'track.mp3';
    const encodedUtf8 = encodeURIComponent(fileName);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader(
      'Content-Disposition',
      `${isPreview ? 'inline' : 'attachment'}; filename="${asciiFallback}"; filename*=UTF-8''${encodedUtf8}`
    );
    if (job.fileSizeBytes) {
      res.setHeader('Content-Length', String(job.fileSizeBytes));
    }

    fs.createReadStream(job.filePath).pipe(res);
  });

  app.post('/api/download/zip', (req: Request, res: Response) => {
    const body = req.body as { jobIds?: string[]; archiveName?: string };
    const jobIds = Array.isArray(body.jobIds) ? body.jobIds : [];

    const readyJobs = jobIds
      .map((id) => jobs.get(id))
      .filter((j): j is DownloadJob => Boolean(j && j.state === 'done' && j.filePath && fs.existsSync(j.filePath)));

    if (readyJobs.length === 0) {
      res.status(400).json({ error: 'Chưa có bài hát nào hoàn tất để đóng gói ZIP.' });
      return;
    }

    const safeArchive = sanitizeFileName(body.archiveName || 'SpotFlow_Enriched_MP3') || 'SpotFlow_Enriched_MP3';
    const asciiArchive = stripDiacritics(safeArchive).replace(/[^\x20-\x7E]/g, '') || 'SpotFlow_Enriched_MP3';

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiArchive}.zip"; filename*=UTF-8''${encodeURIComponent(safeArchive)}.zip`
    );

    const archive = new ZipArchive({ zlib: { level: 5 } });
    archive.on('error', () => {
      if (!res.headersSent) res.status(500).end();
    });
    archive.pipe(res);

    const usedNames = new Set<string>();
    for (const job of readyJobs) {
      if (!job.filePath) continue;
      let name = job.fileName || `${job.trackId}.mp3`;
      if (usedNames.has(name)) {
        name = name.replace(/\.mp3$/i, ` (${job.jobId.slice(0, 4)}).mp3`);
      }
      usedNames.add(name);
      archive.file(job.filePath, { name });
    }

    archive.finalize().catch(() => {});
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SpotFlow MP3 server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
