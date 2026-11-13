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

export interface PresetChart {
  id: string;
  label: string;
  region: string;
  spotifyUrl: string;
  description: string;
}

export type JobState = 'queued' | 'searching' | 'downloading' | 'converting' | 'done' | 'error';

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
  sourcePlatform: string | null;
  matchedTitle: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  error: string | null;
  createdAt?: number;
  updatedAt?: number;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
}

export type AudioBitrate = 320 | 256 | 192;

export interface IntegrationConfig {
  apiKey: string;
  webhookUrl: string;
  autoPushWebhook: boolean;
}
