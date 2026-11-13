import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Download,
  FileArchive,
  FileAudio,
  Image as ImageIcon,
  Loader2,
  Music,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  Upload,
  Webhook,
  X,
} from 'lucide-react';
import type { AudioBitrate, DownloadJob, EnrichedMetadata, LocalTrackEntry } from '../types';
import { apiFetch, getBackendBaseUrl } from '../utils/api';

interface LocalEnrichViewProps {
  bitrate: AudioBitrate;
  embedTags: boolean;
  autoProcessOnUpload: boolean;
  autoDownloadEach: boolean;
  playingLocalId: string | null;
  isPlaying: boolean;
  onTogglePlayEntry: (entry: LocalTrackEntry) => void;
  showToast: (msg: string) => void;
  onOpenIntegrationModal: () => void;
  onStatsChange: (stats: { totalEntries: number; doneCount: number; totalSizeMb: string }) => void;
  onJobsUpdated: (jobs: DownloadJob[]) => void;
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDurationMs(ms: number): string {
  if (!ms || ms <= 0) return '--:--';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function guessTitleArtistFromName(fileName: string): { title: string; artist: string } {
  const base = fileName
    .replace(/\.[a-zA-Z0-9]{2,5}$/, '')
    .replace(/^(?:y2mate\.com|yt1s\.com|snapsave\.io|x2convert\.com)\s*[-–_|]\s*/i, '')
    .replace(/^\d{1,3}\s*[._-]\s*/, '')
    .replace(/_/g, ' ')
    .replace(
      /[\[(](?:official\s*(?:music\s*)?video|official\s*mv|official\s*audio|lyric(?:s)?\s*video|audio|mv|hd|4k|vietsub|320\s*kbps|128\s*kbps)[\])]/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
  const sep = base.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (sep) {
    return { artist: sep[1].trim(), title: sep[2].trim() };
  }
  return { artist: '', title: base || fileName };
}

export function LocalEnrichView({
  bitrate,
  embedTags,
  autoProcessOnUpload,
  autoDownloadEach,
  playingLocalId,
  isPlaying,
  onTogglePlayEntry,
  showToast,
  onOpenIntegrationModal,
  onStatsChange,
  onJobsUpdated,
}: LocalEnrichViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [entries, setEntries] = useState<LocalTrackEntry[]>([]);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isProcessingAll, setIsProcessingAll] = useState<boolean>(false);
  const [isZipping, setIsZipping] = useState<boolean>(false);
  const [editingLyricsId, setEditingLyricsId] = useState<string | null>(null);
  const [editingCoverId, setEditingCoverId] = useState<string | null>(null);

  const autoDownloadRef = useRef(autoDownloadEach);
  autoDownloadRef.current = autoDownloadEach;
  const autoSavedRef = useRef<Set<string>>(new Set());

  const doneJobs = entries
    .map((e) => e.job)
    .filter((j): j is DownloadJob => Boolean(j && j.state === 'done'));

  useEffect(() => {
    const totalBytes = entries.reduce(
      (sum, e) => sum + (e.job?.fileSizeBytes || e.fileSizeBytes || 0),
      0
    );
    onStatsChange({
      totalEntries: entries.length,
      doneCount: doneJobs.length,
      totalSizeMb: (totalBytes / (1024 * 1024)).toFixed(1),
    });
  }, [entries, doneJobs.length, onStatsChange]);

  const triggerSaveJobFile = (job: DownloadJob) => {
    const base = getBackendBaseUrl();
    const a = document.createElement('a');
    a.href = `${base}/api/download/file/${encodeURIComponent(job.jobId)}`;
    a.download = job.fileName || `${job.artist} - ${job.title}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const enrichSingleEntry = async (
    localId: string,
    payload: { fileName?: string; title?: string; artist?: string }
  ): Promise<EnrichedMetadata | null> => {
    setEntries((prev) =>
      prev.map((e) => (e.localId === localId ? { ...e, isEnriching: true } : e))
    );
    try {
      const res = await apiFetch('/api/metadata/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Lỗi tìm metadata');
      const data = (await res.json()) as EnrichedMetadata;
      setEntries((prev) =>
        prev.map((e) =>
          e.localId === localId
            ? {
                ...e,
                title: data.title || e.title,
                artist: data.artist || e.artist,
                album: data.album || e.album,
                coverUrl: data.coverUrl || e.coverUrl,
                durationMs: data.durationMs || e.durationMs,
                syncedLyrics: data.syncedLyrics ?? e.syncedLyrics,
                plainLyrics: data.plainLyrics ?? e.plainLyrics,
                isEnriching: false,
                enrichMatched: data.matched,
              }
            : e
        )
      );
      return data;
    } catch {
      setEntries((prev) =>
        prev.map((e) => (e.localId === localId ? { ...e, isEnriching: false } : e))
      );
      return null;
    }
  };

  const pollJobUntilDone = async (localId: string, jobId: string): Promise<DownloadJob | null> => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 650));
      try {
        const res = await apiFetch(`/api/download/status/${encodeURIComponent(jobId)}`);
        if (!res.ok) continue;
        const job = (await res.json()) as DownloadJob;
        setEntries((prev) =>
          prev.map((e) =>
            e.localId === localId
              ? {
                  ...e,
                  job,
                  coverUrl: job.coverUrl || e.coverUrl,
                  durationMs: job.durationMs || e.durationMs,
                  syncedLyrics: job.syncedLyrics ?? e.syncedLyrics,
                  plainLyrics: job.plainLyrics ?? e.plainLyrics,
                }
              : e
          )
        );
        if (job.state === 'done' || job.state === 'error') {
          if (job.state === 'done' && autoDownloadRef.current && !autoSavedRef.current.has(job.jobId)) {
            autoSavedRef.current.add(job.jobId);
            triggerSaveJobFile(job);
          }
          return job;
        }
      } catch {
        // Retry
      }
    }
    return null;
  };

  const processSingleEntry = async (entry: LocalTrackEntry): Promise<DownloadJob | null> => {
    try {
      const prepRes = await apiFetch('/api/local/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: entry.fileName,
          title: entry.title,
          artist: entry.artist,
          album: entry.album,
          coverUrl: entry.coverUrl,
          bitrate,
          syncedLyrics: entry.syncedLyrics,
          plainLyrics: entry.plainLyrics,
        }),
      });
      const prepData = (await prepRes.json()) as { jobId?: string; job?: DownloadJob; error?: string };
      if (!prepRes.ok || !prepData.jobId || !prepData.job) {
        throw new Error(prepData.error || 'Không thể khởi tạo phiên xử lý');
      }

      setEntries((prev) =>
        prev.map((e) => (e.localId === entry.localId ? { ...e, job: prepData.job } : e))
      );

      const uploadRes = await apiFetch(`/api/local/upload/${encodeURIComponent(prepData.jobId)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-file-name': encodeURIComponent(entry.fileName),
          'x-embed-tags': String(embedTags),
        },
        body: entry.file,
      });

      if (!uploadRes.ok) {
        throw new Error('Lỗi khi gửi file lên máy chủ xử lý');
      }

      const finalJob = await pollJobUntilDone(entry.localId, prepData.jobId);
      if (finalJob) {
        onJobsUpdated([finalJob]);
      }
      return finalJob;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Lỗi xử lý file';
      const failedJob: DownloadJob = {
        jobId: `err_${entry.localId}`,
        trackId: entry.localId,
        title: entry.title,
        artist: entry.artist,
        album: entry.album,
        bitrate,
        state: 'error',
        progress: 0,
        message: errMsg,
        fileName: entry.fileName,
        fileSizeBytes: entry.fileSizeBytes,
        error: errMsg,
      };
      setEntries((prev) =>
        prev.map((e) => (e.localId === entry.localId ? { ...e, job: failedJob } : e))
      );
      return failedJob;
    }
  };

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const validFiles = Array.from(fileList).filter((f) =>
      /\.(mp3|m4a|wav|ogg|flac|mp4|webm|mkv)$/i.test(f.name)
    );
    if (validFiles.length === 0) {
      showToast('Vui lòng chọn file âm thanh (.mp3, .m4a, .wav) hoặc video (.mp4, .webm).');
      return;
    }

    const created: LocalTrackEntry[] = validFiles.map((file) => {
      const guessed = guessTitleArtistFromName(file.name);
      return {
        localId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        file,
        fileName: file.name,
        fileSizeBytes: file.size,
        title: guessed.title,
        artist: guessed.artist,
        album: '',
        coverUrl: '',
        durationMs: 0,
        syncedLyrics: null,
        plainLyrics: null,
        isEnriching: true,
        enrichMatched: false,
      };
    });

    setEntries((prev) => [...prev, ...created]);

    const queue = [...created];
    const workers = Array.from({ length: Math.min(3, queue.length) }).map(async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) break;
        const enriched = await enrichSingleEntry(next.localId, { fileName: next.fileName });
        if (autoProcessOnUpload) {
          const mergedEntry: LocalTrackEntry = enriched
            ? {
                ...next,
                title: enriched.title || next.title,
                artist: enriched.artist || next.artist,
                album: enriched.album || next.album,
                coverUrl: enriched.coverUrl || next.coverUrl,
                durationMs: enriched.durationMs || next.durationMs,
                syncedLyrics: enriched.syncedLyrics ?? next.syncedLyrics,
                plainLyrics: enriched.plainLyrics ?? next.plainLyrics,
              }
            : next;
          await processSingleEntry(mergedEntry);
        }
      }
    });
    await Promise.all(workers);
  };

  const handleProcessAll = async () => {
    const targets = entries.filter((e) => !e.job || e.job.state === 'error');
    if (targets.length === 0 || isProcessingAll) return;

    setIsProcessingAll(true);
    let doneCount = 0;
    try {
      const queue = [...targets];
      const workers = Array.from({ length: Math.min(2, queue.length) }).map(async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) break;
          const result = await processSingleEntry(item);
          if (result?.state === 'done') doneCount++;
        }
      });
      await Promise.all(workers);
      if (doneCount > 0) {
        showToast(`Đã gắn ảnh bìa & lyrics hoàn tất ${doneCount} bài hát.`);
      }
    } finally {
      setIsProcessingAll(false);
    }
  };

  const handleDownloadAllZip = async () => {
    if (doneJobs.length === 0 || isZipping) return;
    setIsZipping(true);
    try {
      const res = await apiFetch('/api/download/zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobIds: doneJobs.map((j) => j.jobId),
          archiveName: 'SpotFlow_Enriched_MP3',
        }),
      });
      if (!res.ok) throw new Error('Không thể nén ZIP');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'SpotFlow_Enriched_MP3.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`Đã tải xuống gói ZIP gồm ${doneJobs.length} bài MP3 đã gắn ảnh bìa & lyrics.`);
    } catch {
      showToast('Không thể tạo file ZIP, vui lòng tải từng bài.');
    } finally {
      setIsZipping(false);
    }
  };

  const editingLyricsEntry = entries.find((e) => e.localId === editingLyricsId) || null;
  const editingCoverEntry = entries.find((e) => e.localId === editingCoverId) || null;
  const pendingCount = entries.filter((e) => !e.job || e.job.state === 'error').length;

  return (
    <div className="flex-1 flex flex-col">
      {/* Dropzone & Batch Controls */}
      <div className="border-b border-white/[0.08] bg-[#111419] px-4 sm:px-6 py-5 space-y-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            handleFilesSelected(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`rounded-lg border border-dashed p-6 sm:p-7 text-center cursor-pointer transition-colors ${
            isDragging
              ? 'border-[#1DB954] bg-[#1DB954]/10'
              : 'border-white/[0.15] bg-[#090B0E] hover:border-white/[0.3] hover:bg-white/[0.02]'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".mp3,.m4a,.wav,.ogg,.flac,.mp4,.webm,.mkv,audio/*,video/*"
            onChange={(e) => {
              handleFilesSelected(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
          />
          <div className="flex flex-col items-center gap-2">
            <div className="h-10 w-10 rounded-md bg-white/[0.06] flex items-center justify-center text-[#1DB954]">
              <Upload className="h-5 w-5" />
            </div>
            <div className="text-sm font-medium text-white">
              Kéo thả hàng loạt file MP3 thô vào đây hoặc bấm để chọn file từ máy tính
            </div>
            <div className="text-xs text-slate-400">
              Đặt tên theo dạng <span className="font-mono text-slate-300">Ca sĩ - Tên bài hát.mp3</span> để nhận diện chính xác Ảnh bìa HD &amp; Lyrics (hỗ trợ cả .m4a, .wav, .mp4).
            </div>
          </div>
        </div>

        {entries.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className="font-mono tabular-nums text-white">{entries.length} file đã nạp</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-[#1DB954]">
                Hoàn tất {doneJobs.length}/{entries.length}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {doneJobs.length > 0 && (
                <button
                  type="button"
                  onClick={handleDownloadAllZip}
                  disabled={isZipping}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-white text-[#090B0E] hover:bg-slate-200 disabled:opacity-60 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isZipping ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Đang nén ZIP...</span>
                    </>
                  ) : (
                    <>
                      <FileArchive className="h-3.5 w-3.5" />
                      <span>Tải bộ MP3 đã gắn tag (.ZIP · {doneJobs.length})</span>
                    </>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={handleProcessAll}
                disabled={pendingCount === 0 || isProcessingAll}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#1DB954] hover:bg-[#1ED760] disabled:opacity-45 disabled:pointer-events-none text-[#090B0E] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isProcessingAll ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Đang gắn ảnh &amp; lyrics...</span>
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>Xử lý &amp; Đồng bộ tất cả ({pendingCount})</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setEntries([])}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-xs text-slate-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Xóa danh sách</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Table or Empty State */}
      {entries.length === 0 ? (
        <div className="px-6 py-16 flex flex-col items-center justify-center text-center max-w-lg mx-auto space-y-4">
          <div className="h-11 w-11 rounded-md bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-slate-400">
            <FileAudio className="h-5 w-5" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-base font-semibold text-white">Sẵn sàng xử lý file MP3 thô</h3>
            <p className="text-sm text-slate-400">
              Kéo thả file MP3 từ máy tính để tự động dò ảnh bìa + lời bài hát (Synced LRC &amp; Plain Text), gắn vào thẻ ID3v2.3 và đồng bộ sang App Nhạc / Cloudflare R2.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenIntegrationModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-[#1DB954]/35 bg-[#1DB954]/10 hover:bg-[#1DB954]/20 text-xs font-medium text-[#1DB954] transition-colors cursor-pointer whitespace-nowrap"
          >
            <Webhook className="h-3.5 w-3.5" />
            <span>Xem API &amp; Lệnh lưu Cloudflare R2 cho App Nhạc</span>
          </button>
        </div>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-white/[0.08] bg-[#111419]/80 text-xs font-medium text-slate-400">
                <th className="py-2.5 pl-4 sm:pl-6 pr-3 w-20">Nghe / Bìa</th>
                <th className="py-2.5 px-3 min-w-[260px]">Tên bài hát &amp; Ca sĩ (sửa trực tiếp nếu cần)</th>
                <th className="py-2.5 px-3 w-44">Lời bài hát (Lyrics)</th>
                <th className="py-2.5 px-3 w-24 text-right hidden sm:table-cell">Thời lượng</th>
                <th className="py-2.5 px-3 w-24 text-right hidden md:table-cell">Dung lượng</th>
                <th className="py-2.5 pl-3 pr-4 sm:pr-6 w-[235px] text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {entries.map((entry) => {
                const job = entry.job;
                const isDone = job?.state === 'done';
                const isError = job?.state === 'error';
                const isActive =
                  job && (job.state === 'queued' || job.state === 'converting');
                const hasLyrics = Boolean(entry.syncedLyrics || entry.plainLyrics);
                const isCurrentPlaying = playingLocalId === entry.localId && isPlaying;

                return (
                  <tr key={entry.localId} className="hover:bg-white/[0.02] transition-colors">
                    {/* Play & Cover */}
                    <td className="py-3 pl-4 sm:pl-6 pr-3 align-middle">
                      <div className="flex items-center gap-2">
                        <div className="relative h-11 w-11 rounded overflow-hidden bg-slate-900 border border-white/[0.1] flex items-center justify-center group shrink-0">
                          {entry.isEnriching ? (
                            <Loader2 className="h-4 w-4 animate-spin text-[#1DB954]" />
                          ) : entry.coverUrl ? (
                            <img
                              src={entry.coverUrl}
                              alt={entry.title}
                              referrerPolicy="no-referrer"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Music className="h-4 w-4 text-slate-500" />
                          )}
                          <button
                            type="button"
                            onClick={() => onTogglePlayEntry(entry)}
                            aria-label={isCurrentPlaying ? `Tạm dừng ${entry.title}` : `Nghe ${entry.title}`}
                            className={`absolute inset-0 flex items-center justify-center bg-black/60 transition-opacity cursor-pointer ${
                              isCurrentPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                            }`}
                          >
                            {isCurrentPlaying ? (
                              <Pause className="h-4 w-4 text-[#1DB954] fill-current" />
                            ) : (
                              <Play className="h-4 w-4 text-white fill-current ml-0.5" />
                            )}
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => setEditingCoverId(entry.localId)}
                          title="Đổi link ảnh bìa"
                          className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
                        >
                          <ImageIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>

                    {/* Editable Title & Artist */}
                    <td className="py-3 px-3 align-middle">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={entry.title}
                            onChange={(e) =>
                              setEntries((prev) =>
                                prev.map((it) =>
                                  it.localId === entry.localId ? { ...it, title: e.target.value } : it
                                )
                              )
                            }
                            placeholder="Tên bài hát..."
                            className="w-full h-8 rounded bg-[#090B0E] border border-white/[0.08] px-2.5 text-sm font-medium text-white focus:outline-none focus:border-[#1DB954]"
                          />
                          <input
                            type="text"
                            value={entry.artist}
                            onChange={(e) =>
                              setEntries((prev) =>
                                prev.map((it) =>
                                  it.localId === entry.localId ? { ...it, artist: e.target.value } : it
                                )
                              )
                            }
                            placeholder="Ca sĩ..."
                            className="w-40 sm:w-44 shrink-0 h-8 rounded bg-[#090B0E] border border-white/[0.08] px-2.5 text-xs text-slate-300 focus:outline-none focus:border-[#1DB954]"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              enrichSingleEntry(entry.localId, {
                                title: entry.title,
                                artist: entry.artist,
                              })
                            }
                            disabled={entry.isEnriching}
                            title="Tìm lại ảnh bìa & lyrics theo tên vừa sửa"
                            className="h-8 px-2.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-xs text-slate-200 transition-colors shrink-0 cursor-pointer inline-flex items-center gap-1 whitespace-nowrap"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${entry.isEnriching ? 'animate-spin' : ''}`} />
                            <span className="hidden sm:inline">Tìm lại</span>
                          </button>
                        </div>
                        <div className="text-xs text-slate-500 font-mono truncate">
                          {entry.fileName}
                          {entry.album ? ` · ${entry.album}` : ''}
                        </div>
                      </div>
                    </td>

                    {/* Lyrics status */}
                    <td className="py-3 px-3 align-middle">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs whitespace-nowrap ${
                            entry.syncedLyrics
                              ? 'text-[#1DB954]'
                              : entry.plainLyrics
                              ? 'text-sky-400'
                              : 'text-slate-500'
                          }`}
                        >
                          {entry.isEnriching
                            ? 'Đang dò...'
                            : entry.syncedLyrics
                            ? 'LRC Synced'
                            : entry.plainLyrics
                            ? 'Plain Lyrics'
                            : 'Chưa có'}
                        </span>
                        <button
                          type="button"
                          onClick={() => setEditingLyricsId(entry.localId)}
                          className="px-2 py-1 rounded bg-white/[0.06] hover:bg-white/[0.12] text-xs text-slate-200 transition-colors cursor-pointer whitespace-nowrap"
                        >
                          {hasLyrics ? 'Xem / Sửa' : 'Thêm tay'}
                        </button>
                      </div>
                    </td>

                    {/* Duration */}
                    <td className="py-3 px-3 align-middle text-right font-mono text-xs text-slate-400 tabular-nums hidden sm:table-cell">
                      {formatDurationMs(entry.durationMs)}
                    </td>

                    {/* Size */}
                    <td className="py-3 px-3 align-middle text-right font-mono text-xs text-slate-400 tabular-nums hidden md:table-cell">
                      {formatBytes(job?.fileSizeBytes || entry.fileSizeBytes)}
                    </td>

                    {/* Actions */}
                    <td className="py-3 pl-3 pr-4 sm:pr-6 align-middle text-right">
                      {!job && (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => processSingleEntry(entry)}
                            disabled={entry.isEnriching}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/[0.08] hover:bg-[#1DB954] text-slate-200 hover:text-[#090B0E] text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>Gắn &amp; Đồng bộ</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setEntries((prev) => prev.filter((e) => e.localId !== entry.localId))
                            }
                            aria-label={`Xóa ${entry.title}`}
                            className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-white/[0.05] transition-colors cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}

                      {isActive && job && (
                        <div className="flex flex-col items-end gap-1 ml-auto max-w-[200px]">
                          <div className="flex items-center justify-between w-full gap-2 text-xs">
                            <span className="text-slate-300 truncate flex items-center gap-1.5">
                              <Loader2 className="h-3 w-3 animate-spin text-[#1DB954] shrink-0" />
                              <span className="truncate">{job.message}</span>
                            </span>
                            <span className="font-mono text-xs text-[#1DB954] tabular-nums">
                              {job.progress}%
                            </span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                            <div
                              className="h-full bg-[#1DB954] transition-all duration-200"
                              style={{ width: `${Math.max(5, job.progress)}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {isDone && job && (
                        <div className="inline-flex items-center gap-2">
                          <span className="text-xs text-[#1DB954] whitespace-nowrap">Đã nhúng ID3</span>
                          <button
                            type="button"
                            onClick={() => triggerSaveJobFile(job)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1DB954] hover:bg-[#1ED760] text-[#090B0E] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span>Lưu MP3</span>
                          </button>
                        </div>
                      )}

                      {isError && job && (
                        <div className="inline-flex items-center gap-2 max-w-[220px]">
                          <span title={job.error || ''} className="inline-flex items-center gap-1 text-xs text-red-400 truncate">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{job.error}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => processSingleEntry(entry)}
                            className="px-2.5 py-1.5 rounded bg-white/[0.08] hover:bg-white/[0.14] text-xs text-white cursor-pointer shrink-0"
                          >
                            Thử lại
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
      )}

      {/* Edit Cover Modal */}
      {editingCoverEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/80" onClick={() => setEditingCoverId(null)} aria-hidden="true" />
          <div className="relative z-10 w-full max-w-md rounded-xl bg-[#111419] border border-white/[0.12] p-5 space-y-4 text-slate-100">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <h3 className="font-display text-sm font-semibold text-white">Chỉnh sửa URL Ảnh bìa</h3>
              <button
                type="button"
                onClick={() => setEditingCoverId(null)}
                className="p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {editingCoverEntry.coverUrl && (
              <div className="flex justify-center">
                <img
                  src={editingCoverEntry.coverUrl}
                  alt={editingCoverEntry.title}
                  referrerPolicy="no-referrer"
                  className="h-44 w-44 rounded-lg object-cover border border-white/[0.1]"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <label className="block text-xs text-slate-400">Link ảnh bìa (JPG/PNG)</label>
              <input
                type="url"
                value={editingCoverEntry.coverUrl}
                onChange={(e) => {
                  const val = e.target.value;
                  setEntries((prev) =>
                    prev.map((it) =>
                      it.localId === editingCoverEntry.localId ? { ...it, coverUrl: val } : it
                    )
                  );
                }}
                placeholder="https://..."
                className="w-full h-9 rounded bg-[#090B0E] border border-white/[0.1] px-3 font-mono text-xs text-white focus:outline-none focus:border-[#1DB954]"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setEditingCoverId(null)}
                className="px-4 py-2 rounded-md bg-[#1DB954] hover:bg-[#1ED760] text-[#090B0E] text-xs font-semibold cursor-pointer"
              >
                Xong
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Lyrics Modal */}
      {editingLyricsEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/80" onClick={() => setEditingLyricsId(null)} aria-hidden="true" />
          <div className="relative z-10 w-full max-w-lg rounded-xl bg-[#111419] border border-white/[0.12] p-5 space-y-4 text-slate-100">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div>
                <h3 className="font-display text-sm font-semibold text-white">
                  {editingLyricsEntry.title} — {editingLyricsEntry.artist || 'Chưa rõ ca sĩ'}
                </h3>
                <span className="text-xs text-slate-400">Hỗ trợ LRC có timestamp ([00:12.34]) hoặc lời thường</span>
              </div>
              <button
                type="button"
                onClick={() => setEditingLyricsId(null)}
                className="p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <textarea
              rows={10}
              value={editingLyricsEntry.syncedLyrics || editingLyricsEntry.plainLyrics || ''}
              onChange={(e) => {
                const val = e.target.value;
                const isLrc = /\[\d{2}:\d{2}/.test(val);
                setEntries((prev) =>
                  prev.map((it) =>
                    it.localId === editingLyricsEntry.localId
                      ? {
                          ...it,
                          syncedLyrics: isLrc ? val : null,
                          plainLyrics: val,
                        }
                      : it
                  )
                );
              }}
              placeholder="Dán lời bài hát hoặc định dạng LRC vào đây..."
              className="w-full rounded bg-[#090B0E] border border-white/[0.1] p-3 font-mono text-xs text-slate-200 focus:outline-none focus:border-[#1DB954]"
            />

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setEditingLyricsId(null)}
                className="px-4 py-2 rounded-md bg-[#1DB954] hover:bg-[#1ED760] text-[#090B0E] text-xs font-semibold cursor-pointer"
              >
                Lưu lời bài hát
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
