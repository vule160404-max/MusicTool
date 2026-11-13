import { useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Music,
  Pause,
  Play,
  RotateCw,
} from 'lucide-react';
import type { AudioBitrate, DownloadJob, SpotifyTrackItem } from '../types';

interface TrackTableProps {
  tracks: SpotifyTrackItem[];
  isLoading: boolean;
  errorMessage: string | null;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAllVisible: () => void;
  jobsByTrackId: Record<string, DownloadJob>;
  onDownloadSingle: (track: SpotifyTrackItem) => void;
  onSaveFile: (job: DownloadJob) => void;
  playingTrackId: string | null;
  isPlaying: boolean;
  onTogglePlay: (track: SpotifyTrackItem, job?: DownloadJob) => void;
  bitrate: AudioBitrate;
  onResetToDefaultChart: () => void;
  downloadedTrackIds: Set<string>;
  onOpenBackendSettings?: () => void;
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '--:--';
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function CoverThumb({
  coverUrl,
  title,
  canPlay,
  isCurrentPlaying,
  onTogglePlay,
}: {
  coverUrl: string;
  title: string;
  canPlay: boolean;
  isCurrentPlaying: boolean;
  onTogglePlay: () => void;
}) {
  const [broken, setBroken] = useState(false);

  return (
    <div className="relative h-10 w-10 shrink-0 rounded overflow-hidden bg-gradient-to-br from-slate-800 to-slate-900 border border-white/[0.08] group">
      {coverUrl && !broken ? (
        <img
          src={coverUrl}
          alt={title}
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="h-full w-full flex items-center justify-center text-slate-500">
          <Music className="h-4 w-4" />
        </div>
      )}

      {canPlay && (
        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={isCurrentPlaying ? `Tạm dừng ${title}` : `Nghe thử ${title}`}
          className={`absolute inset-0 flex items-center justify-center bg-black/60 transition-opacity cursor-pointer ${
            isCurrentPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
          }`}
        >
          {isCurrentPlaying ? (
            <Pause className="h-4 w-4 text-[#1DB954] fill-current" />
          ) : (
            <Play className="h-4 w-4 text-white fill-current ml-0.5" />
          )}
        </button>
      )}
    </div>
  );
}

export function TrackTable({
  tracks,
  isLoading,
  errorMessage,
  selectedIds,
  onToggleSelect,
  onToggleSelectAllVisible,
  jobsByTrackId,
  onDownloadSingle,
  onSaveFile,
  playingTrackId,
  isPlaying,
  onTogglePlay,
  bitrate,
  onResetToDefaultChart,
  downloadedTrackIds,
  onOpenBackendSettings,
}: TrackTableProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyRowLink = async (track: SpotifyTrackItem) => {
    try {
      await navigator.clipboard.writeText(track.spotifyUrl);
      setCopiedId(track.id);
      setTimeout(() => {
        setCopiedId((cur) => (cur === track.id ? null : cur));
      }, 1500);
    } catch {
      // Ignore
    }
  };

  if (isLoading) {
    return (
      <div className="px-4 sm:px-6 py-4 space-y-2" aria-busy="true" aria-label="Đang tải danh sách bài hát">
        {Array.from({ length: 10 }).map((_, idx) => (
          <div
            key={idx}
            className="h-14 rounded-md bg-white/[0.03] border border-white/[0.04] animate-pulse flex items-center px-4 gap-4"
          >
            <div className="h-4 w-4 rounded bg-white/[0.07]" />
            <div className="h-10 w-10 rounded bg-white/[0.07]" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 w-48 rounded bg-white/[0.07]" />
              <div className="h-3 w-32 rounded bg-white/[0.05]" />
            </div>
            <div className="h-3.5 w-16 rounded bg-white/[0.06]" />
            <div className="h-8 w-24 rounded bg-white/[0.07]" />
          </div>
        ))}
      </div>
    );
  }

  if (errorMessage) {
    const isBackendError =
      errorMessage.toLowerCase().includes('máy chủ') ||
      errorMessage.toLowerCase().includes('backend') ||
      errorMessage.toLowerCase().includes('kết nối') ||
      errorMessage.toLowerCase().includes('vercel');

    return (
      <div className="px-6 py-16 flex flex-col items-center justify-center text-center max-w-lg mx-auto space-y-4">
        <div className="h-11 w-11 rounded-md bg-red-500/10 border border-red-500/25 flex items-center justify-center text-red-400">
          <AlertCircle className="h-5 w-5" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-base font-semibold text-white">
            {isBackendError ? 'Chưa kết nối được Máy chủ Backend' : 'Không thể lấy danh sách từ Spotify'}
          </h3>
          <p className="text-sm text-slate-400">{errorMessage}</p>
          {isBackendError && (
            <p className="text-xs text-amber-300/80 pt-1">
              Khi deploy lên Vercel, Vercel chỉ chạy web tĩnh và không chạy được máy chủ Node.js/FFmpeg.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {isBackendError && onOpenBackendSettings && (
            <button
              type="button"
              onClick={onOpenBackendSettings}
              className="px-4 py-2 rounded-md bg-amber-500 hover:bg-amber-400 text-[#090B0E] text-xs font-semibold transition-colors cursor-pointer"
            >
              Cấu hình Backend / Xem cách sửa
            </button>
          )}
          <button
            type="button"
            onClick={onResetToDefaultChart}
            className="px-4 py-2 rounded-md bg-white/[0.08] hover:bg-white/[0.14] text-white text-xs font-medium transition-colors cursor-pointer"
          >
            Thử tải lại
          </button>
        </div>
      </div>
    );
  }

  if (tracks.length === 0) {
    return (
      <div className="px-6 py-16 flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4">
        <div className="h-11 w-11 rounded-md bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-slate-400">
          <Music className="h-5 w-5" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-base font-semibold text-white">
            Không có bài hát nào khớp bộ lọc
          </h3>
          <p className="text-sm text-slate-400">
            Thử xóa từ khóa tìm kiếm hoặc chọn một bảng xếp hạng hot ở thanh bên trái.
          </p>
        </div>
        <button
          type="button"
          onClick={onResetToDefaultChart}
          className="px-4 py-2 rounded-md bg-white/[0.08] hover:bg-white/[0.14] text-white text-sm font-medium transition-colors cursor-pointer"
        >
          Nạp lại Top 50 - Việt Nam
        </button>
      </div>
    );
  }

  const allVisibleSelected = tracks.every((t) => selectedIds.has(t.id));

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-white/[0.08] bg-[#111419]/80 text-xs font-medium text-slate-400">
            <th className="py-2.5 pl-4 sm:pl-6 pr-2 w-10">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={onToggleSelectAllVisible}
                aria-label="Chọn tất cả bài hát hiển thị"
                className="h-4 w-4 rounded border-slate-600 bg-[#090B0E] accent-[#1DB954] cursor-pointer"
              />
            </th>
            <th className="py-2.5 px-2 w-10 text-right font-mono">#</th>
            <th className="py-2.5 px-3 min-w-[240px]">Bài hát &amp; Ca sĩ</th>
            <th className="py-2.5 px-3 w-24 text-right hidden sm:table-cell">Thời lượng</th>
            <th className="py-2.5 px-3 min-w-[210px] hidden xl:table-cell">Link Spotify</th>
            <th className="py-2.5 pl-3 pr-4 sm:pr-6 w-[235px] text-right">
              Trạng thái &amp; Tải MP3 ({bitrate}k)
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {tracks.map((track) => {
            const isSelected = selectedIds.has(track.id);
            const job = jobsByTrackId[track.id];
            const isDone = job?.state === 'done';
            const isAlreadyDownloaded = downloadedTrackIds.has(track.id);
            const isError = job?.state === 'error';
            const isActive =
              job &&
              (job.state === 'queued' ||
                job.state === 'searching' ||
                job.state === 'downloading' ||
                job.state === 'converting');
            const canPlay = Boolean(isDone || isAlreadyDownloaded || track.previewUrl);
            const isCurrentPlaying = playingTrackId === track.id && isPlaying;

            return (
              <tr
                key={track.id}
                className={`transition-colors ${
                  isSelected ? 'bg-[#1DB954]/[0.05]' : 'hover:bg-white/[0.025]'
                }`}
              >
                <td className="py-2.5 pl-4 sm:pl-6 pr-2 align-middle">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleSelect(track.id)}
                    aria-label={`Chọn ${track.title}`}
                    className="h-4 w-4 rounded border-slate-600 bg-[#090B0E] accent-[#1DB954] cursor-pointer"
                  />
                </td>

                <td className="py-2.5 px-2 text-right align-middle font-mono text-xs text-slate-500 tabular-nums">
                  {String(track.index).padStart(2, '0')}
                </td>

                <td className="py-2.5 px-3 align-middle">
                  <div className="flex items-center gap-3 min-w-0">
                    <CoverThumb
                      coverUrl={track.coverUrl}
                      title={track.title}
                      canPlay={canPlay}
                      isCurrentPlaying={isCurrentPlaying}
                      onTogglePlay={() => onTogglePlay(track, job)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white truncate">
                          {track.title}
                        </span>
                        {isAlreadyDownloaded && !isDone && (
                          <span className="px-1.5 py-0.5 rounded bg-[#1DB954]/20 text-[#1DB954] text-[10px] font-medium shrink-0">
                            ✓ Đã tải
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 truncate mt-0.5">
                        {track.artist}
                      </div>
                    </div>
                  </div>
                </td>

                <td className="py-2.5 px-3 text-right align-middle font-mono text-xs text-slate-400 tabular-nums hidden sm:table-cell">
                  {formatDuration(track.durationMs)}
                </td>

                <td className="py-2.5 px-3 align-middle hidden xl:table-cell">
                  <div className="flex items-center gap-1.5 max-w-[240px]">
                    <span className="font-mono text-xs text-slate-500 truncate">
                      open.spotify.com/track/{track.id}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyRowLink(track)}
                      title="Sao chép link bài hát"
                      aria-label={`Sao chép link ${track.title}`}
                      className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0 cursor-pointer"
                    >
                      {copiedId === track.id ? (
                        <Check className="h-3.5 w-3.5 text-[#1DB954]" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <a
                      href={track.spotifyUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Mở trên Spotify"
                      aria-label={`Mở ${track.title} trên Spotify`}
                      className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </td>

                <td className="py-2.5 pl-3 pr-4 sm:pr-6 align-middle text-right">
                  {!job && (
                    <div className="inline-flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopyRowLink(track)}
                        aria-label={`Sao chép link ${track.title}`}
                        className="xl:hidden p-2 rounded-md border border-white/[0.08] text-slate-400 hover:text-white hover:bg-white/[0.05] transition-colors cursor-pointer"
                      >
                        {copiedId === track.id ? (
                          <Check className="h-3.5 w-3.5 text-[#1DB954]" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDownloadSingle(track)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          isAlreadyDownloaded
                            ? 'bg-[#1DB954]/15 hover:bg-[#1DB954] text-[#6ee79c] hover:text-[#090B0E] border border-[#1DB954]/30'
                            : 'bg-white/[0.06] hover:bg-[#1DB954] text-slate-200 hover:text-[#090B0E] border border-white/[0.08] hover:border-[#1DB954]'
                        }`}
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>{isAlreadyDownloaded ? 'Tải lại' : 'Tải MP3'}</span>
                      </button>
                    </div>
                  )}

                  {isActive && job && (
                    <div className="flex flex-col items-end gap-1 ml-auto max-w-[210px]">
                      <div className="flex items-center justify-between w-full gap-2 text-xs">
                        <span className="text-slate-300 truncate flex items-center gap-1.5">
                          <Loader2 className="h-3 w-3 animate-spin text-[#1DB954] shrink-0" />
                          <span className="truncate">{job.message}</span>
                        </span>
                        <span className="font-mono text-xs text-[#1DB954] tabular-nums shrink-0">
                          {job.progress}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                        <div
                          className="h-full bg-[#1DB954] transition-all duration-200"
                          style={{ width: `${Math.max(4, job.progress)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {isDone && job && (
                    <div className="inline-flex items-center justify-end gap-2.5">
                      <span className="text-xs text-slate-400 font-mono tabular-nums hidden sm:inline whitespace-nowrap">
                        {job.bitrate}k · {formatBytes(job.fileSizeBytes)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onSaveFile(job)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1DB954] hover:bg-[#1ED760] text-[#090B0E] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>Lưu MP3</span>
                      </button>
                    </div>
                  )}

                  {isError && job && (
                    <div className="inline-flex items-center justify-end gap-2 max-w-[230px]">
                      <span
                        title={job.error || 'Lỗi tải'}
                        className="inline-flex items-center gap-1 text-xs text-red-400 truncate"
                      >
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{job.error || 'Lỗi xử lý'}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => onDownloadSingle(track)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white/[0.07] hover:bg-white/[0.14] text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <RotateCw className="h-3 w-3" />
                        <span>Thử lại</span>
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
