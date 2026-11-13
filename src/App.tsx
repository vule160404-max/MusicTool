import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  FileArchive,
  FileText,
  Loader2,
  Menu,
  Webhook,
} from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { BatchExtractorBar } from './components/BatchExtractorBar';
import { TrackTable } from './components/TrackTable';
import { AudioPlayerDock } from './components/AudioPlayerDock';
import { IntegrationModal } from './components/IntegrationModal';
import type {
  AudioBitrate,
  DownloadJob,
  PresetChart,
  SpotifyTrackItem,
} from './types';

const MAX_CONCURRENT_DOWNLOADS = 3;

export default function App() {
  const [presets, setPresets] = useState<PresetChart[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [sourceTitle, setSourceTitle] = useState<string>('Top 50 - Việt Nam');
  const [tracks, setTracks] = useState<SpotifyTrackItem[]>([]);
  const [isExtracting, setIsExtracting] = useState<boolean>(true);
  const [extractError, setExtractError] = useState<string | null>(null);

  const [filterQuery, setFilterQuery] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [bitrate, setBitrate] = useState<AudioBitrate>(320);
  const [embedTags, setEmbedTags] = useState<boolean>(true);
  const [autoDownloadEach, setAutoDownloadEach] = useState<boolean>(false);
  const [skipAlreadyDownloaded, setSkipAlreadyDownloaded] = useState<boolean>(true);

  // Track successfully downloaded IDs persistently in localStorage to prevent duplicates
  const [downloadedTrackIds, setDownloadedTrackIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('spotflow_downloaded_track_ids');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return new Set(parsed);
      }
    } catch {
      // Ignore
    }
    return new Set();
  });

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);
  const [isIntegrationModalOpen, setIsIntegrationModalOpen] = useState<boolean>(false);

  // Download queue & jobs keyed by trackId
  const [jobsByTrackId, setJobsByTrackId] = useState<Record<string, DownloadJob>>({});
  const pendingQueueRef = useRef<SpotifyTrackItem[]>([]);
  const activeCountRef = useRef<number>(0);
  const autoSavedJobIdsRef = useRef<Set<string>>(new Set());
  const autoDownloadEachRef = useRef<boolean>(autoDownloadEach);
  autoDownloadEachRef.current = autoDownloadEach;

  // Export & clipboard feedback
  const [copiedBatch, setCopiedBatch] = useState<boolean>(false);
  const [isZipping, setIsZipping] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Audio player state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingTrack, setPlayingTrack] = useState<{
    track: SpotifyTrackItem;
    isFullMp3: boolean;
  } | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState<number>(0);
  const [audioDuration, setAudioDuration] = useState<number>(0);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((cur) => (cur === msg ? null : cur));
    }, 2800);
  }, []);

  const markTrackAsDownloaded = useCallback((trackId: string) => {
    setDownloadedTrackIds((prev) => {
      if (prev.has(trackId)) return prev;
      const next = new Set(prev);
      next.add(trackId);
      try {
        localStorage.setItem('spotflow_downloaded_track_ids', JSON.stringify(Array.from(next)));
      } catch {
        // Ignore
      }
      return next;
    });
  }, []);

  const triggerBrowserSave = useCallback((job: DownloadJob) => {
    const a = document.createElement('a');
    a.href = `/api/download/file/${encodeURIComponent(job.jobId)}`;
    a.download = job.fileName || `${job.artist} - ${job.title}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const hydrateTrackCovers = useCallback(async (loadedTracks: SpotifyTrackItem[]) => {
    const chunkSize = 20;
    for (let i = 0; i < loadedTracks.length; i += chunkSize) {
      const slice = loadedTracks.slice(i, i + chunkSize);
      try {
        const res = await fetch('/api/spotify/covers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackUrls: slice.map((t) => t.spotifyUrl) }),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as { covers?: Record<string, string> };
        const covers = data.covers || {};
        if (Object.keys(covers).length > 0) {
          setTracks((prev) =>
            prev.map((t) => (covers[t.spotifyUrl] ? { ...t, coverUrl: covers[t.spotifyUrl] } : t))
          );
        }
      } catch {
        // Ignore
      }
    }
  }, []);

  const fetchCollection = useCallback(
    async (urls: string | string[], preset?: PresetChart) => {
      setIsExtracting(true);
      setExtractError(null);
      if (preset) {
        setActivePresetId(preset.id);
        setSourceTitle(preset.label);
      } else {
        setActivePresetId(null);
      }

      try {
        const res = await fetch('/api/spotify/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls }),
        });
        const data = (await res.json()) as {
          sourceTitle?: string;
          tracks?: SpotifyTrackItem[];
          error?: string;
        };
        if (!res.ok || !data.tracks) {
          throw new Error(data.error || 'Không thể tải danh sách bài hát.');
        }
        setSourceTitle(preset?.label || data.sourceTitle || 'Danh sách Spotify');
        setTracks(data.tracks);
        setSelectedIds(new Set(data.tracks.slice(0, 10).map((t) => t.id)));
        hydrateTrackCovers(data.tracks);
      } catch (err) {
        setExtractError(
          err instanceof Error ? err.message : 'Lỗi kết nối khi lấy dữ liệu Spotify.'
        );
        setTracks([]);
        setSelectedIds(new Set());
      } finally {
        setIsExtracting(false);
      }
    },
    [hydrateTrackCovers]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/presets');
        const data = (await res.json()) as { presets?: PresetChart[] };
        const list = data.presets || [];
        if (cancelled) return;
        setPresets(list);
        if (list[0]) {
          await fetchCollection(list[0].spotifyUrl, list[0]);
        } else {
          setIsExtracting(false);
        }
      } catch {
        if (!cancelled) {
          setExtractError('Không thể kết nối máy chủ.');
          setIsExtracting(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchCollection]);

  const pumpDownloadQueue = useCallback(async () => {
    while (
      activeCountRef.current < MAX_CONCURRENT_DOWNLOADS &&
      pendingQueueRef.current.length > 0
    ) {
      const nextTrack = pendingQueueRef.current.shift();
      if (!nextTrack) break;

      activeCountRef.current += 1;
      try {
        const res = await fetch('/api/download/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            track: nextTrack,
            bitrate,
            embedTags,
          }),
        });
        const data = (await res.json()) as { job?: DownloadJob; error?: string };
        if (!res.ok || !data.job) {
          activeCountRef.current = Math.max(0, activeCountRef.current - 1);
          setJobsByTrackId((prev) => ({
            ...prev,
            [nextTrack.id]: {
              jobId: `err_${nextTrack.id}`,
              trackId: nextTrack.id,
              title: nextTrack.title,
              artist: nextTrack.artist,
              album: nextTrack.album,
              bitrate,
              state: 'error',
              progress: 0,
              message: data.error || 'Không thể khởi tạo tiến trình tải',
              sourcePlatform: null,
              matchedTitle: null,
              fileName: null,
              fileSizeBytes: null,
              error: data.error || 'Không thể khởi tạo tiến trình tải',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          }));
          continue;
        }

        const startedJob = data.job;
        setJobsByTrackId((prev) => ({
          ...prev,
          [nextTrack.id]: startedJob,
        }));
      } catch {
        activeCountRef.current = Math.max(0, activeCountRef.current - 1);
      }
    }
  }, [bitrate, embedTags]);

  const enqueueTracks = useCallback(
    (targetTracks: SpotifyTrackItem[], force = false) => {
      const filtered = force
        ? targetTracks
        : skipAlreadyDownloaded
        ? targetTracks.filter((t) => !downloadedTrackIds.has(t.id))
        : targetTracks;

      const skippedCount = targetTracks.length - filtered.length;
      if (skippedCount > 0) {
        showToast(`Đã bỏ qua ${skippedCount} bài đã tải trước đó để tránh trùng lặp.`);
      }

      if (filtered.length === 0) return;

      setJobsByTrackId((prev) => {
        const next = { ...prev };
        for (const t of filtered) {
          const existing = next[t.id];
          if (
            existing &&
            (existing.state === 'queued' ||
              existing.state === 'searching' ||
              existing.state === 'downloading' ||
              existing.state === 'converting' ||
              existing.state === 'done')
          ) {
            continue;
          }
          next[t.id] = {
            jobId: `pending_${t.id}`,
            trackId: t.id,
            title: t.title,
            artist: t.artist,
            album: t.album,
            bitrate,
            state: 'queued',
            progress: 1,
            message: 'Đang chờ trong hàng đợi...',
            sourcePlatform: null,
            matchedTitle: null,
            fileName: null,
            fileSizeBytes: null,
            error: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          const alreadyQueued = pendingQueueRef.current.some((q) => q.id === t.id);
          if (!alreadyQueued) {
            pendingQueueRef.current.push(t);
          }
        }
        return next;
      });

      setTimeout(() => {
        pumpDownloadQueue();
      }, 30);
    },
    [bitrate, downloadedTrackIds, pumpDownloadQueue, showToast, skipAlreadyDownloaded]
  );

  useEffect(() => {
    const activeJobs = Object.values(jobsByTrackId).filter(
      (j) =>
        !j.jobId.startsWith('pending_') &&
        !j.jobId.startsWith('err_') &&
        (j.state === 'queued' ||
          j.state === 'searching' ||
          j.state === 'downloading' ||
          j.state === 'converting')
    );

    if (activeJobs.length === 0) return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/download/statuses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobIds: activeJobs.map((j) => j.jobId) }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { jobs?: Record<string, DownloadJob> };
        const updatedMap = data.jobs || {};

        let finishedCount = 0;
        const newlyDoneJobs: DownloadJob[] = [];

        setJobsByTrackId((prev) => {
          const next = { ...prev };
          for (const updated of Object.values(updatedMap)) {
            const previous = next[updated.trackId];
            next[updated.trackId] = updated;
            const wasActive =
              previous &&
              previous.state !== 'done' &&
              previous.state !== 'error';
            if (wasActive && (updated.state === 'done' || updated.state === 'error')) {
              finishedCount += 1;
              if (updated.state === 'done') {
                newlyDoneJobs.push(updated);
                markTrackAsDownloaded(updated.trackId);
              }
            }
          }
          return next;
        });

        if (finishedCount > 0) {
          activeCountRef.current = Math.max(0, activeCountRef.current - finishedCount);
          pumpDownloadQueue();
        }

        if (autoDownloadEachRef.current) {
          for (const doneJob of newlyDoneJobs) {
            if (!autoSavedJobIdsRef.current.has(doneJob.jobId)) {
              autoSavedJobIdsRef.current.add(doneJob.jobId);
              triggerBrowserSave(doneJob);
            }
          }
        }
      } catch {
        // Ignore
      }
    }, 800);

    return () => clearInterval(timer);
  }, [jobsByTrackId, markTrackAsDownloaded, pumpDownloadQueue, triggerBrowserSave]);

  const filteredTracks = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.spotifyUrl.toLowerCase().includes(q)
    );
  }, [tracks, filterQuery]);

  const selectedTracks = useMemo(
    () => tracks.filter((t) => selectedIds.has(t.id)),
    [tracks, selectedIds]
  );

  const batchSummary = useMemo(() => {
    const allJobs = Object.values(jobsByTrackId);
    const doneJobs = allJobs.filter((j) => j.state === 'done');
    const activeJobs = allJobs.filter(
      (j) =>
        j.state === 'queued' ||
        j.state === 'searching' ||
        j.state === 'downloading' ||
        j.state === 'converting'
    );
    const totalBytes = doneJobs.reduce((acc, j) => acc + (j.fileSizeBytes || 0), 0);
    return {
      totalTracked: allJobs.length,
      doneJobs,
      activeJobs,
      totalMb: (totalBytes / (1024 * 1024)).toFixed(1),
    };
  }, [jobsByTrackId]);

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleSelectAllVisible = () => {
    const allVisibleSelected =
      filteredTracks.length > 0 && filteredTracks.every((t) => selectedIds.has(t.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const t of filteredTracks) next.delete(t.id);
      } else {
        for (const t of filteredTracks) next.add(t.id);
      }
      return next;
    });
  };

  const handleCopyBatchLinks = async () => {
    const target = selectedTracks.length > 0 ? selectedTracks : filteredTracks;
    if (target.length === 0) return;
    const text = target.map((t) => t.spotifyUrl).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedBatch(true);
      showToast(`Đã sao chép ${target.length} link bài hát Spotify vào clipboard.`);
      setTimeout(() => setCopiedBatch(false), 1800);
    } catch {
      showToast('Trình duyệt không cho phép truy cập clipboard tự động.');
    }
  };

  const handleExportTxt = () => {
    const target = selectedTracks.length > 0 ? selectedTracks : filteredTracks;
    if (target.length === 0) return;
    const content = target
      .map((t) => `${String(t.index).padStart(2, '0')}. ${t.artist} - ${t.title} | ${t.spotifyUrl}`)
      .join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sourceTitle.replace(/[^\p{L}\p{N}_-]+/gu, '_')}_links.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Đã xuất file TXT gồm ${target.length} link Spotify.`);
  };

  const handleDownloadBatch = () => {
    const target = selectedTracks.length > 0 ? selectedTracks : filteredTracks.slice(0, 10);
    if (target.length === 0) return;
    enqueueTracks(target, false);
  };

  const handleDownloadZip = async () => {
    if (batchSummary.doneJobs.length === 0 || isZipping) return;
    setIsZipping(true);
    try {
      const res = await fetch('/api/download/zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobIds: batchSummary.doneJobs.map((j) => j.jobId),
          archiveName: sourceTitle,
        }),
      });
      if (!res.ok) throw new Error('Không thể nén file ZIP.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sourceTitle.replace(/[^\p{L}\p{N}_-]+/gu, '_')}_MP3.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`Đã tải xuống gói ZIP gồm ${batchSummary.doneJobs.length} bài MP3.`);
    } catch {
      showToast('Không thể tạo file ZIP, vui lòng thử tải từng bài.');
    } finally {
      setIsZipping(false);
    }
  };

  const handleTogglePlay = (track: SpotifyTrackItem, job?: DownloadJob) => {
    const isSameTrack = playingTrack?.track.id === track.id;
    const audio = audioRef.current;
    if (!audio) return;

    if (isSameTrack) {
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
      } else {
        audio.play().then(() => setIsPlaying(true)).catch(() => {});
      }
      return;
    }

    const isFullMp3 = job?.state === 'done' || downloadedTrackIds.has(track.id);
    const srcUrl =
      isFullMp3 && job?.jobId
        ? `/api/download/file/${encodeURIComponent(job.jobId)}?preview=1`
        : track.previewUrl;

    if (!srcUrl) {
      showToast('File MP3 này cần được tải xuống trước khi phát.');
      return;
    }

    audio.src = srcUrl;
    audio.currentTime = 0;
    setPlayingTrack({ track, isFullMp3 });
    audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
  };

  const handleClosePlayer = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
    }
    setPlayingTrack(null);
    setIsPlaying(false);
    setAudioCurrentTime(0);
    setAudioDuration(0);
  };

  return (
    <div className="min-h-screen bg-[#090B0E] text-slate-100 flex">
      <audio
        ref={audioRef}
        onTimeUpdate={() => {
          if (audioRef.current) setAudioCurrentTime(audioRef.current.currentTime);
        }}
        onLoadedMetadata={() => {
          if (audioRef.current) setAudioDuration(audioRef.current.duration || 0);
        }}
        onEnded={() => setIsPlaying(false)}
      />

      <Sidebar
        presets={presets}
        activePresetId={activePresetId}
        onSelectPreset={(preset) => fetchCollection(preset.spotifyUrl, preset)}
        bitrate={bitrate}
        onChangeBitrate={setBitrate}
        embedTags={embedTags}
        onToggleEmbedTags={() => setEmbedTags((v) => !v)}
        autoDownloadEach={autoDownloadEach}
        onToggleAutoDownloadEach={() => setAutoDownloadEach((v) => !v)}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-white/[0.08] bg-[#090B0E]/95 backdrop-blur-md px-4 sm:px-6 py-3.5">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(true)}
              aria-label="Mở menu bảng xếp hạng"
              className="lg:hidden p-2 -ml-1 rounded-md text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="min-w-0">
              <h1 className="font-display text-base sm:text-lg font-semibold text-white truncate">
                {sourceTitle}
              </h1>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="font-mono tabular-nums">{tracks.length} bài hát</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">MP3 {bitrate} kbps</span>
                <span aria-hidden="true" className="hidden sm:inline">·</span>
                <span className="hidden sm:inline">
                  {embedTags ? 'Có gắn ID3, Ảnh bìa & Lyrics' : 'Không gắn thẻ ID3'}
                </span>
                <span aria-hidden="true" className="hidden md:inline">·</span>
                <span className="hidden md:text-[#1DB954] md:inline font-mono">
                  Đã tải {downloadedTrackIds.size} bài
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsIntegrationModalOpen(true)}
              title="Liên kết với app nhạc của bạn qua API hoặc Webhook"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-[#1DB954]/40 bg-[#1DB954]/10 hover:bg-[#1DB954]/20 text-xs font-medium text-[#1DB954] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Webhook className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Liên kết App Nhạc</span>
            </button>

            <button
              type="button"
              onClick={handleCopyBatchLinks}
              disabled={tracks.length === 0}
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.09] disabled:opacity-40 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedBatch ? (
                <>
                  <Check className="h-3.5 w-3.5 text-[#1DB954]" />
                  <span>Đã chép Link</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>
                    Chép Link ({selectedTracks.length > 0 ? selectedTracks.length : filteredTracks.length})
                  </span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleExportTxt}
              disabled={tracks.length === 0}
              title="Xuất danh sách link Spotify ra file TXT"
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.09] disabled:opacity-40 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Xuất TXT</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadBatch}
              disabled={tracks.length === 0 || isExtracting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#1DB954] hover:bg-[#1ED760] disabled:opacity-45 disabled:pointer-events-none text-[#090B0E] text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {batchSummary.activeJobs.length > 0 ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="font-mono tabular-nums">
                    Đang tải ({batchSummary.activeJobs.length})
                  </span>
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  <span>
                    Tải hàng loạt ({selectedTracks.length > 0 ? selectedTracks.length : Math.min(10, filteredTracks.length)})
                  </span>
                </>
              )}
            </button>
          </div>
        </header>

        <BatchExtractorBar
          onExtractUrls={(raw) => fetchCollection(raw)}
          isLoading={isExtracting}
          filterQuery={filterQuery}
          onFilterChange={setFilterQuery}
          totalTracks={filteredTracks.length}
          selectedCount={selectedIds.size}
          onSelectAll={() => setSelectedIds(new Set(filteredTracks.map((t) => t.id)))}
          onSelectTopN={(n) =>
            setSelectedIds(new Set(filteredTracks.slice(0, n).map((t) => t.id)))
          }
          onClearSelection={() => setSelectedIds(new Set())}
          skipAlreadyDownloaded={skipAlreadyDownloaded}
          onToggleSkipAlreadyDownloaded={() => setSkipAlreadyDownloaded((v) => !v)}
        />

        {batchSummary.totalTracked > 0 && (
          <div className="border-b border-white/[0.08] bg-[#141920] px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 text-xs text-slate-300">
              <span className="font-medium text-white">Tiến trình tải hàng loạt</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="font-mono tabular-nums text-[#1DB954]">
                Hoàn tất {batchSummary.doneJobs.length}/{batchSummary.totalTracked} bài
              </span>
              {Number(batchSummary.totalMb) > 0 && (
                <>
                  <span aria-hidden="true" className="text-slate-600">·</span>
                  <span className="font-mono tabular-nums text-slate-400">
                    {batchSummary.totalMb} MB
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyBatchLinks}
                className="sm:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-white/[0.07] text-xs text-white"
              >
                <Copy className="h-3.5 w-3.5" />
                <span>Chép Link</span>
              </button>

              {batchSummary.doneJobs.length > 0 && (
                <button
                  type="button"
                  onClick={handleDownloadZip}
                  disabled={isZipping}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-white text-[#090B0E] hover:bg-slate-200 disabled:opacity-60 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isZipping ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Đang nén ZIP...</span>
                    </>
                  ) : (
                    <>
                      <FileArchive className="h-3.5 w-3.5" />
                      <span>Tải tất cả về máy (.ZIP · {batchSummary.doneJobs.length} bài)</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        )}

        {toastMsg && (
          <div
            role="status"
            className="mx-4 sm:mx-6 mt-3 px-4 py-2.5 rounded-md bg-[#1DB954]/15 border border-[#1DB954]/30 text-xs text-[#6ee79c] flex items-center justify-between gap-3"
          >
            <span>{toastMsg}</span>
            <button
              type="button"
              onClick={() => setToastMsg(null)}
              className="text-[#6ee79c] hover:text-white text-xs cursor-pointer"
            >
              Đóng
            </button>
          </div>
        )}

        <main className="flex-1">
          <TrackTable
            tracks={filteredTracks}
            isLoading={isExtracting}
            errorMessage={extractError}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onToggleSelectAllVisible={handleToggleSelectAllVisible}
            jobsByTrackId={jobsByTrackId}
            onDownloadSingle={(track) => enqueueTracks([track], true)}
            onSaveFile={triggerBrowserSave}
            playingTrackId={playingTrack?.track.id || null}
            isPlaying={isPlaying}
            onTogglePlay={handleTogglePlay}
            bitrate={bitrate}
            onResetToDefaultChart={() => {
              setFilterQuery('');
              if (presets[0]) {
                fetchCollection(presets[0].spotifyUrl, presets[0]);
              }
            }}
            downloadedTrackIds={downloadedTrackIds}
          />
        </main>

        {playingTrack && (
          <AudioPlayerDock
            track={playingTrack.track}
            isPlaying={isPlaying}
            isFullMp3={playingTrack.isFullMp3}
            currentTime={audioCurrentTime}
            duration={audioDuration}
            onTogglePlayPause={() => handleTogglePlay(playingTrack.track, jobsByTrackId[playingTrack.track.id])}
            onSeek={(t) => {
              if (audioRef.current) {
                audioRef.current.currentTime = t;
                setAudioCurrentTime(t);
              }
            }}
            onClose={handleClosePlayer}
          />
        )}

        <IntegrationModal
          isOpen={isIntegrationModalOpen}
          onClose={() => setIsIntegrationModalOpen(false)}
          completedJobs={batchSummary.doneJobs}
          showToast={showToast}
        />
      </div>
    </div>
  );
}
