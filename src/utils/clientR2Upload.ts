import { ID3Writer } from 'browser-id3-writer';
import type { DownloadJob, LocalTrackEntry } from '../types';
import { apiFetch, getBackendBaseUrl } from './api';

export class DirectR2UnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DirectR2UnavailableError';
  }
}

function stripId3v2AndId3v1(raw: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(raw);
  let start = 0;

  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const size =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
      (bytes[9] & 0x7f);
    const hasFooter = (bytes[5] & 0x10) !== 0 ? 10 : 0;
    start = Math.min(bytes.length, 10 + size + hasFooter);
  }

  let end = bytes.length;
  if (
    end - start >= 128 &&
    bytes[end - 128] === 0x54 &&
    bytes[end - 127] === 0x41 &&
    bytes[end - 126] === 0x47
  ) {
    end -= 128;
  }

  if (start === 0 && end === bytes.length) return raw;
  return bytes.slice(start, end).buffer;
}

const coverMemoryCache = new Map<string, { data: ArrayBuffer; mime: string; ext: 'jpg' | 'png' | 'webp' }>();

async function fetchCoverBytesViaProxy(
  coverUrl: string
): Promise<{ data: ArrayBuffer; mime: string; ext: 'jpg' | 'png' | 'webp' } | null> {
  if (!coverUrl) return null;
  const cached = coverMemoryCache.get(coverUrl);
  if (cached) return cached;

  try {
    const base = getBackendBaseUrl();
    const proxyUrl = `${base}/api/cover-proxy?url=${encodeURIComponent(coverUrl)}`;
    const res = await fetch(proxyUrl);
    if (!res.ok) return null;
    const data = await res.arrayBuffer();
    if (data.byteLength < 300) return null;

    const view = new Uint8Array(data, 0, Math.min(12, data.byteLength));
    let mime = 'image/jpeg';
    let ext: 'jpg' | 'png' | 'webp' = 'jpg';
    if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4e && view[3] === 0x47) {
      mime = 'image/png';
      ext = 'png';
    } else if (view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46) {
      mime = 'image/webp';
      ext = 'webp';
    }

    const result = { data, mime, ext };
    if (coverMemoryCache.size > 200) {
      const firstKey = coverMemoryCache.keys().next().value;
      if (firstKey) coverMemoryCache.delete(firstKey);
    }
    coverMemoryCache.set(coverUrl, result);
    return result;
  } catch {
    return null;
  }
}

export function isDirectR2Mp3Candidate(file: File): boolean {
  return file.name.toLowerCase().endsWith('.mp3');
}

export async function processEntryDirectToR2(
  entry: LocalTrackEntry,
  options: {
    embedTags: boolean;
    autoPush: boolean;
    webhookUrl: string;
  }
): Promise<DownloadJob> {
  const title = entry.title.trim() || entry.fileName.replace(/\.[^.]+$/, '');
  const artist = entry.artist.trim();
  const album = entry.album.trim();

  const [rawAudioBuf, coverAsset] = await Promise.all([
    entry.file.arrayBuffer(),
    entry.coverUrl ? fetchCoverBytesViaProxy(entry.coverUrl) : Promise.resolve(null),
  ]);

  let finalMp3Buf: ArrayBuffer = rawAudioBuf;
  if (options.embedTags) {
    const cleanBuf = stripId3v2AndId3v1(rawAudioBuf);
    const writer = new ID3Writer(cleanBuf);
    writer.setFrame('TIT2', title);
    if (artist) {
      writer.setFrame('TPE1', [artist]);
    }
    if (album) {
      writer.setFrame('TALB', album);
    }
    const lyricsText = (entry.syncedLyrics || entry.plainLyrics || '').trim();
    if (lyricsText) {
      writer.setFrame('USLT', {
        description: 'Lyrics',
        language: 'eng',
        lyrics: lyricsText,
      });
    }
    if (coverAsset && coverAsset.data.byteLength > 300) {
      writer.setFrame('APIC', {
        type: 3,
        data: coverAsset.data,
        description: 'Cover',
      });
    }
    finalMp3Buf = writer.addTag();
  }

  const preRes = await apiFetch('/api/r2/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      artist,
      needCoverUpload: Boolean(coverAsset),
      coverExt: coverAsset?.ext || 'jpg',
      coverContentType: coverAsset?.mime || 'image/jpeg',
    }),
  });

  if (!preRes.ok) {
    const errData = (await preRes.json().catch(() => ({}))) as { error?: string };
    throw new DirectR2UnavailableError(errData.error || 'R2 presign không khả dụng.');
  }

  const presign = (await preRes.json()) as {
    jobId: string;
    corsOk: boolean;
    audioKey: string;
    audioUploadUrl: string;
    audioPublicUrl: string;
    coverKey: string | null;
    coverUploadUrl: string | null;
    coverPublicUrl: string | null;
  };

  try {
    const audioPutPromise = fetch(presign.audioUploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'audio/mpeg' },
      body: finalMp3Buf,
    });

    const coverPutPromise =
      presign.coverUploadUrl && coverAsset
        ? fetch(presign.coverUploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': coverAsset.mime },
            body: coverAsset.data,
          })
        : Promise.resolve(null);

    const [audioPutRes, coverPutRes] = await Promise.all([audioPutPromise, coverPutPromise]);
    if (!audioPutRes.ok) {
      throw new DirectR2UnavailableError(`R2 PUT trả về HTTP ${audioPutRes.status}`);
    }
    if (coverPutRes && !coverPutRes.ok) {
      throw new DirectR2UnavailableError(`R2 PUT cover trả về HTTP ${coverPutRes.status}`);
    }
  } catch (err) {
    if (err instanceof DirectR2UnavailableError) throw err;
    // Network/CORS rejection when uploading straight from browser to R2
    throw new DirectR2UnavailableError(
      err instanceof Error ? err.message : 'Trình duyệt bị chặn CORS khi đẩy thẳng lên R2.'
    );
  }

  const completeRes = await apiFetch('/api/r2/complete-direct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId: presign.jobId,
      title,
      artist,
      album,
      fileName: entry.fileName,
      sourceFileName: entry.fileName,
      fileSizeBytes: finalMp3Buf.byteLength,
      durationMs: entry.durationMs || 0,
      coverUrl: entry.coverUrl || null,
      r2AudioKey: presign.audioKey,
      r2AudioUrl: presign.audioPublicUrl,
      r2CoverKey: presign.coverKey,
      r2CoverUrl: presign.coverPublicUrl,
      syncedLyrics: entry.syncedLyrics ?? null,
      plainLyrics: entry.plainLyrics ?? null,
      autoPush: options.autoPush,
      webhookUrl: options.webhookUrl,
    }),
  });

  if (!completeRes.ok) {
    const errData = (await completeRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(errData.error || 'Không thể ghi nhận bài hát sau khi tải lên R2.');
  }

  const completeJson = (await completeRes.json()) as { job: DownloadJob };
  return completeJson.job;
}
