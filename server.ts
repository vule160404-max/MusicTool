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
const jobs = new Map<string, DownloadJob>();
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
      /\((?:feat\.?|ft\.?|with|explicit|explicit ver\.?|ost[^)]*|from [^)]*|radio edit|single version|remaster(?:ed)?[^)]*)\)/gi,
      ' '
    )
    .replace(/\[(?:feat\.?|ft\.?|ost[^\]]*|from [^\]]*|explicit[^\]]*)\]/gi, ' ')
    .replace(/\s+-\s+(?:single version|explicit|remastered.*|from .*)$/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || title.trim();
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
    .replace(/^(?:y2mate\.com|yt1s\.com|snapsave\.io|x2convert\.com|mp3juices?)\s*[-–_|]\s*/i, '')
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

async function fetchLyrics(
  trackName: string,
  artistName: string,
  durationSec?: number
): Promise<{ syncedLyrics: string | null; plainLyrics: string | null }> {
  const pickBest = (
    items: Array<{ syncedLyrics?: string; plainLyrics?: string; duration?: number }>
  ): { syncedLyrics: string | null; plainLyrics: string | null } | null => {
    if (!Array.isArray(items) || items.length === 0) return null;
    let best = items[0];
    if (durationSec && durationSec > 0) {
      let minDiff = 999;
      for (const item of items) {
        if (typeof item.duration === 'number') {
          const diff = Math.abs(item.duration - durationSec);
          if (diff < minDiff) {
            minDiff = diff;
            best = item;
          }
        }
      }
    }
    if (!best.syncedLyrics && !best.plainLyrics) return null;
    return {
      syncedLyrics: best.syncedLyrics || null,
      plainLyrics: best.plainLyrics || null,
    };
  };

  try {
    const cleanTitle = cleanTrackTitleForSearch(trackName);
    const cleanArtist = artistName.split(',')[0].trim();

    if (cleanArtist) {
      const queryUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(
        cleanTitle
      )}&artist_name=${encodeURIComponent(cleanArtist)}`;
      const res = await fetch(queryUrl, {
        headers: { 'User-Agent': 'SpotFlow-MP3/1.0 (contact@spotflow.app)' },
      });
      if (res.ok) {
        const items = (await res.json()) as Array<{
          syncedLyrics?: string;
          plainLyrics?: string;
          duration?: number;
        }>;
        const found = pickBest(items);
        if (found) return found;
      }
    }

    const qCombined = `${cleanTitle} ${cleanArtist}`.trim();
    if (qCombined) {
      const fallbackUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(qCombined)}`;
      const res2 = await fetch(fallbackUrl, {
        headers: { 'User-Agent': 'SpotFlow-MP3/1.0 (contact@spotflow.app)' },
      });
      if (res2.ok) {
        const items2 = (await res2.json()) as Array<{
          syncedLyrics?: string;
          plainLyrics?: string;
          duration?: number;
        }>;
        const found2 = pickBest(items2);
        if (found2) return found2;
      }
    }

    return { syncedLyrics: null, plainLyrics: null };
  } catch {
    return { syncedLyrics: null, plainLyrics: null };
  }
}

async function enrichTrackMetadata(input: {
  fileName?: string;
  title?: string;
  artist?: string;
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
  const resolvedAlbum = meta?.album || '';
  const resolvedDurationSec =
    input.durationSec && input.durationSec > 0
      ? input.durationSec
      : meta?.durationMs
      ? Math.round(meta.durationMs / 1000)
      : undefined;

  const lyrics = await fetchLyrics(resolvedTitle, resolvedArtist, resolvedDurationSec);

  return {
    matched: Boolean(meta?.coverUrl || lyrics.syncedLyrics || lyrics.plainLyrics),
    title: resolvedTitle,
    artist: resolvedArtist,
    album: resolvedAlbum,
    durationMs: meta?.durationMs || (input.durationSec ? Math.round(input.durationSec * 1000) : 0),
    coverUrl: meta?.coverUrl || '',
    syncedLyrics: lyrics.syncedLyrics,
    plainLyrics: lyrics.plainLyrics,
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

    if (!job.coverUrl || (!job.syncedLyrics && !job.plainLyrics)) {
      const enriched = await enrichTrackMetadata({
        title: job.title,
        artist: job.artist,
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
  setInterval(() => {
    cleanupOldFiles().catch(() => {});
  }, 15 * 60 * 1000);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, ffmpeg: fs.existsSync(FFMPEG_PATH) });
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
