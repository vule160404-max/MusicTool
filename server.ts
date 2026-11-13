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
const YTDLP_PATH = '/tmp/yt-dlp_linux';
const YTDLP_RELEASE_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
const FFMPEG_PATH = '/usr/bin/ffmpeg';
const FFPROBE_PATH = '/usr/bin/ffprobe';

export interface SpotifyTrackItem {
  id: string;
  index: number;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  spotifyUrl: string;
  spotifyUri: string;
  coverUrl: string;
  previewUrl: string | null;
  isExplicit: boolean;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
}

export interface SpotifyCollectionResult {
  sourceTitle: string;
  sourceType: string;
  sourceUrl: string;
  coverUrl: string;
  tracks: SpotifyTrackItem[];
}

export interface PresetChart {
  id: string;
  label: string;
  region: string;
  spotifyUrl: string;
  description: string;
}

type JobState = 'queued' | 'searching' | 'downloading' | 'converting' | 'done' | 'error';

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
  sourcePlatform: string | null;
  matchedTitle: string | null;
  filePath: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  coverUrl?: string | null;
  durationMs?: number;
  spotifyUrl?: string | null;
}

interface SearchCandidate {
  id: string;
  title: string;
  url: string;
  duration: number;
  uploader: string;
  platform: 'SoundCloud' | 'Bilibili';
  score: number;
}

interface IntegrationSettings {
  apiKey: string;
  webhookUrl: string;
  autoPushWebhook: boolean;
}

const PRESET_CHARTS: PresetChart[] = [
  {
    id: 'vpop-all-combined',
    label: '🔥 Toàn Tập V-Pop (Tổng hợp)',
    region: 'Việt Nam',
    spotifyUrl: [
      'https://open.spotify.com/playlist/37i9dQZF1DX4g8Gs5nUhpp',
      'https://open.spotify.com/playlist/37i9dQZF1DX0F4i7Q9pshJ',
      'https://open.spotify.com/playlist/37i9dQZEVXbLdGSmz6xilI',
    ].join('\n'),
    description: 'Toàn bộ danh sách V-Pop lớn nhất từ các bảng xếp hạng Spotify (đã loại bỏ trùng lặp).',
  },
  {
    id: '37i9dQZEVXbLdGSmz6xilI',
    label: 'Top 50 - Việt Nam',
    region: 'Việt Nam',
    spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZEVXbLdGSmz6xilI',
    description: 'Bảng xếp hạng 50 ca khúc được nghe nhiều nhất tại Việt Nam hôm nay.',
  },
  {
    id: '37i9dQZF1DX0F4i7Q9pshJ',
    label: 'Hot Hits Vietnam',
    region: 'Việt Nam',
    spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZF1DX0F4i7Q9pshJ',
    description: 'Tuyển tập các bản hit thịnh hành và bùng nổ trên bảng xếp hạng Việt.',
  },
  {
    id: '37i9dQZF1DX4g8Gs5nUhpp',
    label: 'V-Pop Không Thể Thiếu',
    region: 'Việt Nam',
    spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZF1DX4g8Gs5nUhpp',
    description: 'Những ca khúc V-Pop nổi bật và được yêu thích hàng đầu.',
  },
  {
    id: '37i9dQZEVXbMDoHDwVN2tF',
    label: 'Top 50 - Toàn Cầu',
    region: 'Global',
    spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2tF',
    description: '50 bản nhạc thịnh hành nhất toàn thế giới trên Spotify.',
  },
  {
    id: '37i9dQZF1DXcBWIGoYBM5M',
    label: "Today's Top Hits",
    region: 'Global',
    spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
    description: 'Playlist nhạc quốc tế hot nhất được cập nhật liên tục.',
  },
  {
    id: '37i9dQZF1DX9tPFwDMOaN1',
    label: 'K-Pop ON! (온)',
    region: 'Hàn Quốc',
    spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZF1DX9tPFwDMOaN1',
    description: 'Top ca khúc K-Pop mới nhất và thịnh hành nhất.',
  },
  {
    id: '37i9dQZEVXbLRQDuF5jeBp',
    label: 'Top 50 - USA',
    region: 'Hoa Kỳ',
    spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZEVXbLRQDuF5jeBp',
    description: '50 ca khúc dẫn đầu bảng xếp hạng tại thị trường Mỹ.',
  },
];

const jobs = new Map<string, DownloadJob>();
const coverCache = new Map<string, string>();
const integrationSettings: IntegrationSettings = {
  apiKey: `sf_live_${crypto.randomBytes(16).toString('hex')}`,
  webhookUrl: '',
  autoPushWebhook: false,
};

let ytdlpReadyPromise: Promise<string> | null = null;

async function ensureWorkspace(): Promise<void> {
  await fsp.mkdir(WORKSPACE_DIR, { recursive: true });
}

async function ensureYtDlp(): Promise<string> {
  if (fs.existsSync(YTDLP_PATH)) {
    try {
      await fsp.access(YTDLP_PATH, fs.constants.X_OK);
      return YTDLP_PATH;
    } catch {
      await fsp.chmod(YTDLP_PATH, 0o755);
      return YTDLP_PATH;
    }
  }
  if (!ytdlpReadyPromise) {
    ytdlpReadyPromise = (async () => {
      const response = await fetch(YTDLP_RELEASE_URL, {
        headers: { 'User-Agent': 'SpotFlow-MP3/1.0' },
      });
      if (!response.ok) {
        throw new Error(`Không thể tải công cụ giải mã audio (${response.status})`);
      }
      const buf = Buffer.from(await response.arrayBuffer());
      const tmpPath = `${YTDLP_PATH}.tmp`;
      await fsp.writeFile(tmpPath, buf);
      await fsp.chmod(tmpPath, 0o755);
      await fsp.rename(tmpPath, YTDLP_PATH);
      return YTDLP_PATH;
    })().finally(() => {
      ytdlpReadyPromise = null;
    });
  }
  return ytdlpReadyPromise;
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
    .replace(/\((?:feat\.?|ft\.?|with|explicit|explicit ver\.?|ost[^)]*|from [^)]*|radio edit|single version|remaster(?:ed)?[^)]*)\)/gi, ' ')
    .replace(/\[(?:feat\.?|ft\.?|ost[^\]]*|from [^\]]*|explicit[^\]]*)\]/gi, ' ')
    .replace(/\s+-\s+(?:single version|explicit|remastered.*|from .*)$/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || title.trim();
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

function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function parseSpotifyTarget(raw: string): { type: 'playlist' | 'album' | 'artist' | 'track'; id: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const uriMatch = trimmed.match(/^spotify:(playlist|album|artist|track):([a-zA-Z0-9]+)$/);
  if (uriMatch) {
    return {
      type: uriMatch[1] as 'playlist' | 'album' | 'artist' | 'track',
      id: uriMatch[2],
    };
  }

  const urlMatch = trimmed.match(
    /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(playlist|album|artist|track)\/([a-zA-Z0-9]+)/i
  );
  if (urlMatch) {
    return {
      type: urlMatch[1].toLowerCase() as 'playlist' | 'album' | 'artist' | 'track',
      id: urlMatch[2],
    };
  }

  return null;
}

async function resolveShortSpotifyUrl(url: string): Promise<string> {
  if (!/spotify\.link|spoti\.fi/i.test(url)) return url;
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    return res.url || url;
  } catch {
    return url;
  }
}

async function fetchTrackCoverOEmbed(trackUrl: string): Promise<string> {
  const cached = coverCache.get(trackUrl);
  if (cached) return cached;
  try {
    const res = await fetch(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(trackUrl)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!res.ok) return '';
    const data = (await res.json()) as { thumbnail_url?: string };
    const thumb = data.thumbnail_url || '';
    if (thumb) coverCache.set(trackUrl, thumb);
    return thumb;
  } catch {
    return '';
  }
}

async function fetchLyrics(
  trackName: string,
  artistName: string,
  durationSec?: number
): Promise<{ syncedLyrics: string | null; plainLyrics: string | null }> {
  try {
    const cleanArtist = artistName.split(',')[0].trim();
    const queryUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(
      trackName
    )}&artist_name=${encodeURIComponent(cleanArtist)}`;
    const res = await fetch(queryUrl, {
      headers: { 'User-Agent': 'SpotFlow-MP3/1.0 (contact@spotflow.app)' },
    });
    if (!res.ok) return { syncedLyrics: null, plainLyrics: null };
    const items = (await res.json()) as Array<{
      syncedLyrics?: string;
      plainLyrics?: string;
      duration?: number;
    }>;
    if (!Array.isArray(items) || items.length === 0) {
      return { syncedLyrics: null, plainLyrics: null };
    }

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
    return {
      syncedLyrics: best.syncedLyrics || null,
      plainLyrics: best.plainLyrics || null,
    };
  } catch {
    return { syncedLyrics: null, plainLyrics: null };
  }
}

async function fetchSpotifyEmbedEntity(
  type: 'playlist' | 'album' | 'artist' | 'track',
  id: string
): Promise<SpotifyCollectionResult> {
  const embedUrl = `https://open.spotify.com/embed/${type}/${id}`;
  const response = await fetch(embedUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

  if (!response.ok) {
    throw new Error(`Không thể truy cập dữ liệu Spotify (${response.status})`);
  }

  const html = await response.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('Không tìm thấy dữ liệu bài hát từ liên kết Spotify này.');
  }

  const nextData = JSON.parse(match[1]) as {
    props?: {
      pageProps?: {
        state?: {
          data?: {
            entity?: {
              type?: string;
              name?: string;
              title?: string;
              subtitle?: string;
              artists?: Array<{ name?: string }>;
              uri?: string;
              duration?: number;
              isExplicit?: boolean;
              audioPreview?: { url?: string };
              visualIdentity?: { image?: Array<{ url?: string }> };
              coverArt?: { sources?: Array<{ url?: string }> };
              trackList?: Array<{
                uri?: string;
                title?: string;
                subtitle?: string;
                duration?: number;
                isExplicit?: boolean;
                audioPreview?: { url?: string };
              }>;
            };
          };
        };
      };
    };
  };

  const entity = nextData?.props?.pageProps?.state?.data?.entity;
  if (!entity) {
    throw new Error('Liên kết Spotify không hợp lệ hoặc playlist đang ở chế độ riêng tư.');
  }

  const collectionCover =
    entity.visualIdentity?.image?.[0]?.url ||
    entity.coverArt?.sources?.[0]?.url ||
    '';

  const sourceTitle = entity.name || entity.title || 'Danh sách Spotify';
  const canonicalSourceUrl = `https://open.spotify.com/${type}/${id}`;

  if (type === 'track' || entity.type === 'track') {
    const trackId = (entity.uri || `spotify:track:${id}`).split(':').pop() || id;
    const trackUrl = `https://open.spotify.com/track/${trackId}`;
    const trackCover = collectionCover || (await fetchTrackCoverOEmbed(trackUrl));
    const artistNames =
      entity.artists
        ?.map((a) => a.name)
        .filter((n): n is string => Boolean(n))
        .join(', ') ||
      entity.subtitle ||
      'Unknown Artist';
    const singleTrack: SpotifyTrackItem = {
      id: trackId,
      index: 1,
      title: entity.title || entity.name || 'Unknown Track',
      artist: artistNames.replace(/\u00a0/g, ' '),
      album: sourceTitle,
      durationMs: Number(entity.duration) || 0,
      spotifyUrl: trackUrl,
      spotifyUri: entity.uri || `spotify:track:${trackId}`,
      coverUrl: trackCover,
      previewUrl: entity.audioPreview?.url || null,
      isExplicit: Boolean(entity.isExplicit),
    };
    return {
      sourceTitle: `${singleTrack.title} — ${singleTrack.artist}`,
      sourceType: 'track',
      sourceUrl: canonicalSourceUrl,
      coverUrl: trackCover,
      tracks: [singleTrack],
    };
  }

  const rawTracks = entity.trackList || [];
  const tracks: SpotifyTrackItem[] = rawTracks.map((item, idx) => {
    const trackId = (item.uri || '').split(':').pop() || `${id}_${idx + 1}`;
    const trackUrl = `https://open.spotify.com/track/${trackId}`;
    return {
      id: trackId,
      index: idx + 1,
      title: (item.title || 'Unknown Track').replace(/\u00a0/g, ' '),
      artist: (item.subtitle || 'Unknown Artist').replace(/\u00a0/g, ' '),
      album: sourceTitle,
      durationMs: Number(item.duration) || 0,
      spotifyUrl: trackUrl,
      spotifyUri: item.uri || `spotify:track:${trackId}`,
      coverUrl: coverCache.get(trackUrl) || collectionCover,
      previewUrl: item.audioPreview?.url || null,
      isExplicit: Boolean(item.isExplicit),
    };
  });

  return {
    sourceTitle,
    sourceType: type,
    sourceUrl: canonicalSourceUrl,
    coverUrl: collectionCover,
    tracks,
  };
}

function runProcessCapture(
  cmd: string,
  args: string[],
  timeoutMs = 25000
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

function scoreAudioCandidate(
  candTitle: string,
  candDurationSec: number,
  candUploader: string,
  targetTitle: string,
  targetArtist: string,
  targetDurationSec: number
): number {
  const normCand = normalizeForMatch(`${candTitle} ${candUploader}`);
  const normCandTitle = normalizeForMatch(candTitle);
  const normTargetTitle = normalizeForMatch(targetTitle);
  const normTargetArtist = normalizeForMatch(targetArtist);

  if (targetDurationSec > 75 && candDurationSec > 0 && candDurationSec < 45) {
    return -1000;
  }
  if (targetDurationSec > 0 && candDurationSec > Math.max(targetDurationSec * 2.1, 720)) {
    return -900;
  }

  let score = 0;

  if (targetDurationSec > 0 && candDurationSec > 0) {
    const diff = Math.abs(candDurationSec - targetDurationSec);
    if (diff <= 4) score += 60;
    else if (diff <= 12) score += 45;
    else if (diff <= 25) score += 25;
    else if (diff <= 45) score += 8;
    else score -= Math.min(50, Math.round(diff / 3));
  }

  const titleTokens = normTargetTitle.split(' ').filter((w) => w.length >= 2);
  if (titleTokens.length > 0) {
    let hits = 0;
    for (const token of titleTokens) {
      if (normCandTitle.includes(token)) hits++;
    }
    score += Math.round((hits / titleTokens.length) * 50);
    if (normCandTitle.includes(normTargetTitle)) score += 25;
  }

  const primaryArtist = normTargetArtist.split(',')[0].trim();
  const artistTokens = primaryArtist.split(' ').filter((w) => w.length >= 2);
  if (artistTokens.length > 0) {
    let hits = 0;
    for (const token of artistTokens) {
      if (normCand.includes(token)) hits++;
    }
    score += Math.round((hits / artistTokens.length) * 35);
  }

  const bannedWords = [
    'remix',
    'slowed',
    'reverb',
    'sped up',
    'speed up',
    '1 hour',
    '1hour',
    'cover',
    'karaoke',
    'instrumental',
    'nightcore',
    '8d',
    'mashup',
    'demo',
    'lofi',
    'lo fi',
    'circuit',
    'funk',
    'edit',
    'drum',
  ];
  for (const bw of bannedWords) {
    if (normCandTitle.includes(bw) && !normTargetTitle.includes(bw)) {
      score -= 48;
    }
  }

  return score;
}

async function searchBestAudioCandidate(
  ytdlp: string,
  title: string,
  artist: string,
  durationMs: number
): Promise<SearchCandidate | null> {
  const targetDurationSec = Math.round((durationMs || 0) / 1000);
  const primaryArtist = artist.split(',')[0].trim();
  const cleanTitle = cleanTrackTitleForSearch(title);
  const rawQuery = `${primaryArtist} ${cleanTitle}`.trim();
  const asciiQuery = stripDiacritics(rawQuery);
  const asciiCleanTitle = stripDiacritics(cleanTitle);

  const candidates: SearchCandidate[] = [];

  const scQueries = [rawQuery];
  if (asciiQuery.toLowerCase() !== rawQuery.toLowerCase()) {
    scQueries.push(asciiQuery);
  }
  if (asciiCleanTitle && asciiCleanTitle.toLowerCase() !== asciiQuery.toLowerCase()) {
    scQueries.push(asciiCleanTitle);
  }

  for (const q of scQueries) {
    try {
      const res = await runProcessCapture(
        ytdlp,
        ['--flat-playlist', '--dump-single-json', '--no-warnings', `scsearch15:${q}`],
        20000
      );
      if (res.stdout.trim()) {
        const parsed = JSON.parse(res.stdout) as {
          entries?: Array<{
            id?: string;
            title?: string;
            url?: string;
            webpage_url?: string;
            duration?: number;
            uploader?: string;
          }>;
        };
        for (const entry of parsed.entries || []) {
          const entryUrl = entry.webpage_url || entry.url;
          if (!entryUrl || !entry.title) continue;
          const dur = Number(entry.duration) || 0;
          const scRaw = scoreAudioCandidate(
            entry.title,
            dur,
            entry.uploader || '',
            title,
            artist,
            targetDurationSec
          );
          const scClean =
            cleanTitle !== title
              ? scoreAudioCandidate(
                  entry.title,
                  dur,
                  entry.uploader || '',
                  cleanTitle,
                  artist,
                  targetDurationSec
                )
              : scRaw;
          candidates.push({
            id: String(entry.id || entryUrl),
            title: entry.title,
            url: entryUrl,
            duration: dur,
            uploader: entry.uploader || '',
            platform: 'SoundCloud',
            score: Math.max(scRaw, scClean),
          });
        }
      }
    } catch {
      // Continue
    }
    const bestSoFar = candidates.reduce((best, cur) => (cur.score > best ? cur.score : best), -999);
    if (bestSoFar >= 85) break;
  }

  candidates.sort((a, b) => b.score - a.score);
  if (candidates[0] && candidates[0].score >= 35) {
    return candidates[0];
  }

  try {
    const res = await runProcessCapture(
      ytdlp,
      [
        '--print',
        '%(id)s\t%(duration)s\t%(uploader)s\t%(webpage_url)s\t%(title)s',
        '--no-warnings',
        `bilisearch4:${asciiQuery}`,
      ],
      20000
    );
    const lines = res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length < 5) continue;
      const [id, durStr, uploader, webpageUrl, ...titleParts] = parts;
      const entryTitle = titleParts.join('\t');
      const dur = Number(durStr) || 0;
      const sc = scoreAudioCandidate(entryTitle, dur, uploader, cleanTitle, artist, targetDurationSec);
      candidates.push({
        id,
        title: entryTitle,
        url: webpageUrl,
        duration: dur,
        uploader,
        platform: 'Bilibili',
        score: sc,
      });
    }
  } catch {
    // Ignore
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] && candidates[0].score >= 25 ? candidates[0] : null;
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

async function triggerWebhookNotification(job: DownloadJob, reqHost: string, reqProtocol: string) {
  if (!integrationSettings.autoPushWebhook || !integrationSettings.webhookUrl) return;
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
        spotifyUrl: job.spotifyUrl || null,
        syncedLyrics: job.syncedLyrics || null,
        plainLyrics: job.plainLyrics || null,
      },
    };

    await fetch(integrationSettings.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': integrationSettings.apiKey,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Suppress webhook network dispatch failures
  }
}

async function processDownloadJob(
  job: DownloadJob,
  track: SpotifyTrackItem,
  bitrate: number,
  embedTags: boolean,
  reqHost: string,
  reqProtocol: string
): Promise<void> {
  const tempFiles: string[] = [];
  const baseSlug = `${job.jobId}`;
  const rawDownloadPattern = path.join(WORKSPACE_DIR, `${baseSlug}_raw.%(ext)s`);
  const finalBaseName = sanitizeFileName(`${track.artist} - ${track.title}`) || `spotify_${track.id}`;
  const finalMp3Path = path.join(WORKSPACE_DIR, `${baseSlug}_${finalBaseName}.mp3`);

  try {
    await ensureWorkspace();
    job.state = 'searching';
    job.progress = 8;
    job.message = 'Đang dò nguồn audio & lyrics...';
    job.updatedAt = Date.now();

    // Fetch lyrics concurrently
    const targetSec = Math.round((track.durationMs || 0) / 1000);
    const lyricsPromise = fetchLyrics(track.title, track.artist, targetSec);

    const ytdlp = await ensureYtDlp();
    const candidate = await searchBestAudioCandidate(
      ytdlp,
      track.title,
      track.artist,
      track.durationMs
    );

    const fetchedLyrics = await lyricsPromise;
    job.syncedLyrics = fetchedLyrics.syncedLyrics;
    job.plainLyrics = fetchedLyrics.plainLyrics;

    let rawInputPath: string | null = null;

    if (!candidate) {
      throw new Error(
        'Không tìm thấy bản audio đầy đủ (Spotify chỉ có đoạn nghe thử 30s). Đã bỏ qua để tránh đồng bộ nhầm bản 30s.'
      );
    }

    job.sourcePlatform = candidate.platform;
    job.matchedTitle = candidate.title;
    job.state = 'downloading';
    job.progress = 18;
    job.message = `Đang tải bản full từ ${candidate.platform}...`;
    job.updatedAt = Date.now();

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        ytdlp,
        [
          candidate.url,
          '-f',
          'bestaudio/best',
          '--no-playlist',
          '--newline',
          '--no-warnings',
          '-o',
          rawDownloadPattern,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );

      let errOutput = '';
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('Tải audio quá thời gian cho phép'));
      }, 90000);

      proc.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        const pctMatch = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (pctMatch) {
          const pct = Math.min(100, Math.max(0, Number(pctMatch[1])));
          job.progress = Math.round(18 + pct * 0.56);
          job.updatedAt = Date.now();
        }
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        errOutput += chunk.toString('utf8');
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(errOutput.trim() || `Lỗi tải stream (mã ${code})`));
      });
    });

    const files = await fsp.readdir(WORKSPACE_DIR);
    const matchedRaw = files.find((f) => f.startsWith(`${baseSlug}_raw.`));
    if (matchedRaw) {
      rawInputPath = path.join(WORKSPACE_DIR, matchedRaw);
      tempFiles.push(rawInputPath);
    }

    if (!rawInputPath) {
      throw new Error('Không tìm thấy file audio hợp lệ cho bài hát này.');
    }

    job.state = 'converting';
    job.progress = 78;
    job.message = `Đang chuyển đổi MP3 ${bitrate}kbps & gắn thẻ ID3/Lyrics...`;
    job.updatedAt = Date.now();

    const resolvedCoverUrl =
      track.coverUrl && !track.coverUrl.includes('charts-images')
        ? track.coverUrl
        : (await fetchTrackCoverOEmbed(track.spotifyUrl)) || track.coverUrl;
    if (resolvedCoverUrl) {
      job.coverUrl = resolvedCoverUrl;
    }

    let coverFilePath: string | null = null;
    if (embedTags && resolvedCoverUrl) {
      const coverBuf = await downloadFileBuffer(resolvedCoverUrl);
      if (coverBuf && coverBuf.length > 500) {
        coverFilePath = path.join(WORKSPACE_DIR, `${baseSlug}_cover.jpg`);
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

    ffmpegArgs.push(
      '-codec:a',
      'libmp3lame',
      '-b:a',
      `${bitrate}k`,
      '-ar',
      '44100',
      '-id3v2_version',
      '3'
    );

    if (embedTags) {
      ffmpegArgs.push(
        '-metadata',
        `title=${track.title}`,
        '-metadata',
        `artist=${track.artist}`,
        '-metadata',
        `album=${track.album || 'Spotify Hot Tracks'}`,
        '-metadata',
        `track=${track.index}`,
        '-metadata',
        `comment=${track.spotifyUrl}`
      );
      if (job.plainLyrics || job.syncedLyrics) {
        ffmpegArgs.push(
          '-metadata',
          `lyrics=${job.plainLyrics || job.syncedLyrics}`
        );
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

    const ffRes = await runProcessCapture(FFMPEG_PATH, ffmpegArgs, 60000);
    if (ffRes.code !== 0 || !fs.existsSync(finalMp3Path)) {
      throw new Error('Lỗi chuyển đổi định dạng MP3 bằng FFmpeg.');
    }

    const actualDurationSec = await probeAudioDurationSec(finalMp3Path);
    if (targetSec > 75 && actualDurationSec > 0 && actualDurationSec < 45) {
      await fsp.unlink(finalMp3Path).catch(() => {});
      throw new Error(
        `Nguồn audio chỉ trả về đoạn nghe thử ${Math.round(actualDurationSec)}s (Go+/Preview). Đã hủy để tránh đồng bộ nhầm bản cắt.`
      );
    }

    const stat = await fsp.stat(finalMp3Path);
    job.state = 'done';
    job.progress = 100;
    job.message = `Hoàn tất · MP3 ${bitrate}kbps`;
    job.filePath = finalMp3Path;
    job.fileName = `${finalBaseName}.mp3`;
    job.fileSizeBytes = stat.size;
    job.updatedAt = Date.now();

    // Trigger webhook notification if configured
    triggerWebhookNotification(job, reqHost, reqProtocol).catch(() => {});
  } catch (err) {
    job.state = 'error';
    job.progress = 0;
    job.error = err instanceof Error ? err.message : 'Lỗi không xác định khi tải bài hát.';
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
  setInterval(() => {
    cleanupOldFiles().catch(() => {});
  }, 15 * 60 * 1000);

  ensureYtDlp().catch(() => {});

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, ffmpeg: fs.existsSync(FFMPEG_PATH) });
  });

  app.get('/api/presets', (_req: Request, res: Response) => {
    res.json({ presets: PRESET_CHARTS });
  });

  // Integration settings & API Key management
  app.get('/api/integration/settings', (_req: Request, res: Response) => {
    res.json(integrationSettings);
  });

  app.post('/api/integration/settings', (req: Request, res: Response) => {
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
    res.json(integrationSettings);
  });

  // External API Endpoints for Custom Music Apps (Protected by X-API-Key or Bearer Token)
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
      spotifyUrl: j.spotifyUrl || null,
      fileName: j.fileName,
      fileSizeBytes: j.fileSizeBytes,
      downloadUrl: `${proto}://${host}/api/download/file/${j.jobId}`,
      coverUrl: j.coverUrl || null,
      syncedLyrics: j.syncedLyrics || null,
      plainLyrics: j.plainLyrics || null,
      downloadedAt: new Date(j.updatedAt).toISOString(),
    }));

    res.json({
      total: items.length,
      tracks: items,
    });
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

  app.post('/api/spotify/extract', async (req: Request, res: Response) => {
    try {
      const body = req.body as { urls?: string[] | string };
      const rawInputs = Array.isArray(body.urls)
        ? body.urls
        : typeof body.urls === 'string'
        ? body.urls.split(/[\n,\s]+/).filter(Boolean)
        : [];

      if (rawInputs.length === 0) {
        res.status(400).json({ error: 'Vui lòng nhập ít nhất một liên kết Spotify.' });
        return;
      }

      const uniqueInputs = Array.from(new Set(rawInputs.map((s) => s.trim()).filter(Boolean))).slice(0, 60);
      const allTracks: SpotifyTrackItem[] = [];
      const seenTrackIds = new Set<string>();
      let primaryTitle = '';
      let primaryType = 'batch';
      let primaryUrl = '';
      let primaryCover = '';
      const errors: string[] = [];

      for (const raw of uniqueInputs) {
        const resolved = await resolveShortSpotifyUrl(raw);
        const parsed = parseSpotifyTarget(resolved);
        if (!parsed) {
          errors.push(`Link không hợp lệ: ${raw}`);
          continue;
        }
        try {
          const collection = await fetchSpotifyEmbedEntity(parsed.type, parsed.id);
          if (!primaryTitle) {
            primaryTitle = collection.sourceTitle;
            primaryType = collection.sourceType;
            primaryUrl = collection.sourceUrl;
            primaryCover = collection.coverUrl;
          }
          for (const t of collection.tracks) {
            if (!seenTrackIds.has(t.id)) {
              seenTrackIds.add(t.id);
              allTracks.push({
                ...t,
                index: allTracks.length + 1,
              });
            }
          }
        } catch (err) {
          errors.push(err instanceof Error ? err.message : `Lỗi đọc ${raw}`);
        }
      }

      if (allTracks.length === 0) {
        res.status(422).json({
          error: errors[0] || 'Không thể trích xuất bài hát nào từ các liên kết đã cung cấp.',
        });
        return;
      }

      const finalTitle =
        uniqueInputs.length > 1 && primaryType === 'track'
          ? `Danh sách ghép (${allTracks.length} bài hát)`
          : primaryTitle;

      res.json({
        sourceTitle: finalTitle,
        sourceType: uniqueInputs.length > 1 ? 'batch' : primaryType,
        sourceUrl: primaryUrl,
        coverUrl: primaryCover,
        tracks: allTracks,
        warnings: errors,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Lỗi máy chủ khi lấy danh sách Spotify.',
      });
    }
  });

  app.post('/api/spotify/covers', async (req: Request, res: Response) => {
    const body = req.body as { trackUrls?: string[] };
    const urls = Array.isArray(body.trackUrls) ? body.trackUrls.slice(0, 25) : [];
    const entries = await Promise.all(
      urls.map(async (u) => {
        const cover = await fetchTrackCoverOEmbed(u);
        return [u, cover] as const;
      })
    );
    const covers: Record<string, string> = {};
    for (const [u, c] of entries) {
      if (c) covers[u] = c;
    }
    res.json({ covers });
  });

  app.post('/api/download/start', (req: Request, res: Response) => {
    const body = req.body as {
      track?: SpotifyTrackItem;
      bitrate?: number;
      embedTags?: boolean;
    };

    if (!body.track || !body.track.title) {
      res.status(400).json({ error: 'Thiếu thông tin bài hát cần tải.' });
      return;
    }

    const bitrate = [192, 256, 320].includes(Number(body.bitrate)) ? Number(body.bitrate) : 320;
    const embedTags = body.embedTags !== false;
    const jobId = crypto.randomBytes(8).toString('hex');
    const reqHost = req.get('host') || 'localhost:3000';
    const reqProtocol = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();

    const job: DownloadJob = {
      jobId,
      trackId: body.track.id,
      title: body.track.title,
      artist: body.track.artist,
      album: body.track.album,
      bitrate,
      state: 'queued',
      progress: 2,
      message: 'Đang xếp hàng xử lý...',
      sourcePlatform: null,
      matchedTitle: null,
      filePath: null,
      fileName: null,
      fileSizeBytes: null,
      error: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      syncedLyrics: null,
      plainLyrics: null,
      coverUrl: body.track.coverUrl || null,
      durationMs: body.track.durationMs || 0,
      spotifyUrl: body.track.spotifyUrl || null,
    };

    jobs.set(jobId, job);

    processDownloadJob(job, body.track, bitrate, embedTags, reqHost, reqProtocol).catch(() => {});

    res.json({ jobId, job });
  });

  app.post('/api/download/statuses', (req: Request, res: Response) => {
    const body = req.body as { jobIds?: string[] };
    const ids = Array.isArray(body.jobIds) ? body.jobIds : [];
    const result: Record<string, DownloadJob> = {};
    for (const id of ids) {
      const job = jobs.get(id);
      if (job) {
        result[id] = {
          ...job,
          filePath: null,
        };
      }
    }
    res.json({ jobs: result });
  });

  app.get('/api/download/status/:jobId', (req: Request, res: Response) => {
    const jobId = String(req.params.jobId);
    const job = jobs.get(jobId);
    if (!job) {
      res.status(404).json({ error: 'Không tìm thấy tiến trình tải.' });
      return;
    }
    res.json({
      ...job,
      filePath: null,
    });
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

    const safeArchive = sanitizeFileName(body.archiveName || 'Spotify_Hot_MP3') || 'Spotify_Hot_MP3';
    const asciiArchive = stripDiacritics(safeArchive).replace(/[^\x20-\x7E]/g, '') || 'Spotify_Hot_MP3';

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
