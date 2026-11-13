export type AudioBitrate = 320 | 256 | 192;

export type JobState = 'queued' | 'converting' | 'done' | 'error';

export interface DownloadJob {
  jobId: string;
  trackId: string;
  title: string;
  artist: string;
  album: string;
  bitrate: number;
  state: JobState;
  progress: number;
  message: string;
  fileName: string | null;
  fileSizeBytes: number | null;
  error: string | null;
  createdAt?: number;
  updatedAt?: number;
  coverUrl?: string | null;
  durationMs?: number;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  webhookStatus?: 'idle' | 'pushing' | 'pushed' | 'error';
  webhookMessage?: string | null;
  pushedAt?: string | null;
}

export interface IntegrationConfig {
  apiKey: string;
  webhookUrl: string;
  autoPushWebhook: boolean;
  pushConcurrency?: 2 | 4 | 6;
}

export interface EnrichedMetadata {
  matched: boolean;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  coverUrl: string;
  syncedLyrics: string | null;
  plainLyrics: string | null;
}

export interface LocalTrackEntry {
  localId: string;
  file: File;
  fileName: string;
  fileSizeBytes: number;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  durationMs: number;
  syncedLyrics: string | null;
  plainLyrics: string | null;
  isEnriching: boolean;
  enrichMatched: boolean;
  job?: DownloadJob;
}

export interface UploadHistoryItem {
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

