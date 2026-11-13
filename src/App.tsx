import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, History, Menu, Server, Webhook } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { LocalEnrichView } from './components/LocalEnrichView';
import { AudioPlayerDock } from './components/AudioPlayerDock';
import { IntegrationModal } from './components/IntegrationModal';
import { BackendConnectionModal } from './components/BackendConnectionModal';
import { HistoryModal } from './components/HistoryModal';
import { apiFetch, checkBackendStatus, getBackendBaseUrl } from './utils/api';
import {
  loadLocalUploadHistory,
  mergeUploadHistories,
  saveLocalUploadHistory,
} from './utils/trackHistory';
import type {
  AudioBitrate,
  DownloadJob,
  IntegrationConfig,
  LocalTrackEntry,
  UploadHistoryItem,
} from './types';

export default function App() {
  const [bitrate, setBitrate] = useState<AudioBitrate>(320);
  const [embedTags, setEmbedTags] = useState<boolean>(true);
  const [autoProcessOnUpload, setAutoProcessOnUpload] = useState<boolean>(false);
  const [autoDownloadEach, setAutoDownloadEach] = useState<boolean>(false);
  const [skipDuplicates, setSkipDuplicates] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('spotflow_skip_duplicates');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });

  const [completedJobs, setCompletedJobs] = useState<DownloadJob[]>([]);
  const [historyItems, setHistoryItems] = useState<UploadHistoryItem[]>(() =>
    loadLocalUploadHistory()
  );
  const [integrationConfig, setIntegrationConfig] = useState<IntegrationConfig>({
    apiKey: '',
    webhookUrl: '',
    autoPushWebhook: false,
    pushConcurrency: 4,
  });
  const [stats, setStats] = useState<{ totalEntries: number; doneCount: number; totalSizeMb: string }>({
    totalEntries: 0,
    doneCount: 0,
    totalSizeMb: '0.0',
  });

  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);
  const [isIntegrationModalOpen, setIsIntegrationModalOpen] = useState<boolean>(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState<boolean>(false);
  const [isBackendModalOpen, setIsBackendModalOpen] = useState<boolean>(false);
  const [isBackendOnline, setIsBackendOnline] = useState<boolean | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // Audio preview state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [playingEntry, setPlayingEntry] = useState<{
    localId: string;
    title: string;
    artist: string;
    sourceLabel: string;
  } | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState<number>(0);
  const [audioDuration, setAudioDuration] = useState<number>(0);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((cur) => (cur === msg ? null : cur));
    }, 3000);
  }, []);

  const loadIntegrationSettings = useCallback(async () => {
    try {
      const res = await apiFetch('/api/integration/settings');
      if (!res.ok) return;
      const data = (await res.json()) as IntegrationConfig;
      setIntegrationConfig(data);
    } catch {
      // Ignore
    }
  }, []);

  const syncUploadHistory = useCallback(async () => {
    try {
      const localItems = loadLocalUploadHistory();
      const res = await apiFetch('/api/history');
      if (!res.ok) return;
      const data = (await res.json()) as { items?: UploadHistoryItem[] };
      const serverItems = Array.isArray(data.items) ? data.items : [];
      const merged = mergeUploadHistories(serverItems, localItems);
      setHistoryItems(merged);
      saveLocalUploadHistory(merged);

      // Push any browser-cached items missing on server (e.g. after server restart)
      if (localItems.length > serverItems.length) {
        const serverKeys = new Set(serverItems.map((i) => i.trackKey || i.fileKey));
        const missingOnServer = localItems.filter(
          (i) => !serverKeys.has(i.trackKey || i.fileKey)
        );
        if (missingOnServer.length > 0) {
          await apiFetch('/api/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: missingOnServer }),
          });
        }
      }
    } catch {
      // Keep localStorage items if server unreachable
    }
  }, []);

  const recordHistoryItems = useCallback(
    async (
      items: Array<{
        title: string;
        artist: string;
        album?: string;
        fileName: string;
        fileSizeBytes?: number | null;
        pushedToApp?: boolean;
      }>
    ) => {
      if (items.length === 0) return;
      try {
        const res = await apiFetch('/api/history', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items }),
        });
        if (res.ok) {
          const data = (await res.json()) as { items?: UploadHistoryItem[] };
          const serverItems = Array.isArray(data.items) ? data.items : [];
          const merged = mergeUploadHistories(serverItems, loadLocalUploadHistory());
          setHistoryItems(merged);
          saveLocalUploadHistory(merged);
        }
      } catch {
        // Ignore transient failure
      }
    },
    []
  );

  const handleDeleteHistoryItem = useCallback(
    async (id: string) => {
      const nextLocal = historyItems.filter((i) => i.id !== id);
      setHistoryItems(nextLocal);
      saveLocalUploadHistory(nextLocal);
      try {
        await apiFetch(`/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
      } catch {
        // Ignore
      }
      showToast('Đã xóa bài hát khỏi lịch sử.');
    },
    [historyItems, showToast]
  );

  const handleClearAllHistory = useCallback(async () => {
    setHistoryItems([]);
    saveLocalUploadHistory([]);
    try {
      await apiFetch('/api/history', { method: 'DELETE' });
    } catch {
      // Ignore
    }
    showToast('Đã xóa toàn bộ lịch sử upload.');
  }, [showToast]);

  const handleImportHistoryNames = useCallback(
    async (lines: string[]) => {
      const items = lines.map((line) => {
        const cleanLine = line.trim();
        const isFile = /\.(mp3|m4a|wav|ogg|flac|mp4|webm)$/i.test(cleanLine);
        const sep = cleanLine.replace(/\.[a-zA-Z0-9]{2,5}$/, '').match(/^(.+?)\s+[-–—]\s+(.+)$/);
        return {
          title: sep ? sep[2].trim() : cleanLine.replace(/\.[a-zA-Z0-9]{2,5}$/, ''),
          artist: sep ? sep[1].trim() : '',
          fileName: isFile ? cleanLine : `${cleanLine}.mp3`,
          pushedToApp: true,
        };
      });
      await recordHistoryItems(items);
      showToast(`Đã thêm ${items.length} bài hát vào lịch sử để lọc trùng.`);
    },
    [recordHistoryItems, showToast]
  );

  const refreshBackendStatus = useCallback(async () => {
    const status = await checkBackendStatus();
    setIsBackendOnline(status.ok);
    if (status.ok) {
      loadIntegrationSettings();
      syncUploadHistory();
    }
  }, [loadIntegrationSettings, syncUploadHistory]);

  const handleJobsUpdated = useCallback((newJobs: DownloadJob[]) => {
    setCompletedJobs((prev) => {
      const map = new Map(prev.map((j) => [j.jobId, j]));
      for (const j of newJobs) {
        if (j.state === 'done') map.set(j.jobId, j);
      }
      return Array.from(map.values());
    });
  }, []);

  useEffect(() => {
    refreshBackendStatus();
  }, [refreshBackendStatus]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  const handleTogglePlayEntry = (entry: LocalTrackEntry) => {
    const audio = audioRef.current;
    if (!audio) return;

    if (playingEntry?.localId === entry.localId) {
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
      } else {
        audio.play().then(() => setIsPlaying(true)).catch(() => {});
      }
      return;
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    let srcUrl = '';
    let sourceLabel = 'File gốc trên máy';

    if (entry.job?.state === 'done' && entry.job.jobId) {
      const base = getBackendBaseUrl();
      srcUrl = `${base}/api/download/file/${encodeURIComponent(entry.job.jobId)}?preview=1`;
      sourceLabel = 'MP3 đã gắn Ảnh & Lyrics';
    } else {
      srcUrl = URL.createObjectURL(entry.file);
      objectUrlRef.current = srcUrl;
    }

    audio.src = srcUrl;
    audio.currentTime = 0;
    setPlayingEntry({
      localId: entry.localId,
      title: entry.title,
      artist: entry.artist,
      sourceLabel,
    });
    audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
  };

  const handleClosePlayer = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPlayingEntry(null);
    setIsPlaying(false);
    setAudioCurrentTime(0);
    setAudioDuration(0);
  };

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[#090B0E] text-slate-100 flex">
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
        bitrate={bitrate}
        onChangeBitrate={setBitrate}
        embedTags={embedTags}
        onToggleEmbedTags={() => setEmbedTags((v) => !v)}
        autoProcessOnUpload={autoProcessOnUpload}
        onToggleAutoProcessOnUpload={() => setAutoProcessOnUpload((v) => !v)}
        autoDownloadEach={autoDownloadEach}
        onToggleAutoDownloadEach={() => setAutoDownloadEach((v) => !v)}
        skipDuplicates={skipDuplicates}
        onToggleSkipDuplicates={() => {
          setSkipDuplicates((v) => {
            const next = !v;
            try {
              localStorage.setItem('spotflow_skip_duplicates', String(next));
            } catch {
              // Ignore
            }
            return next;
          });
        }}
        totalEntries={stats.totalEntries}
        doneCount={stats.doneCount}
        totalSizeMb={stats.totalSizeMb}
        historyCount={historyItems.length}
        onOpenHistoryModal={() => setIsHistoryModalOpen(true)}
        onOpenIntegrationModal={() => setIsIntegrationModalOpen(true)}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 w-full">
        {isBackendOnline === false && (
          <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 sm:px-6 py-2 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
              <span>
                <strong>Chưa kết nối Máy chủ Backend Node.js</strong> (Vercel chỉ chạy web tĩnh và không chạy được FFmpeg).
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsBackendModalOpen(true)}
              className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-[#090B0E] font-semibold text-xs transition-colors cursor-pointer"
            >
              Cấu hình Backend / Xem cách sửa
            </button>
          </div>
        )}

        <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-white/[0.08] bg-[#090B0E]/95 backdrop-blur-md px-4 sm:px-6 py-3.5">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(true)}
              aria-label="Mở menu cấu hình"
              className="lg:hidden p-2 -ml-1 rounded-md text-slate-300 hover:bg-white/[0.06] hover:text-white transition-colors"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="min-w-0">
              <h1 className="font-display text-base sm:text-lg font-semibold text-white truncate">
                Xử lý File MP3 Thô · Tự Tìm Ảnh Bìa &amp; Lyrics
              </h1>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>Nhúng thẻ ID3v2.3</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-[#1DB954]">
                  Đã hoàn tất {stats.doneCount}/{stats.totalEntries} bài
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsHistoryModalOpen(true)}
              title="Xem lịch sử bài hát đã upload & lọc trùng"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-xs font-medium text-slate-200 transition-colors whitespace-nowrap cursor-pointer"
            >
              <History className="h-3.5 w-3.5 text-[#1DB954]" />
              <span>Lịch sử ({historyItems.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setIsBackendModalOpen(true)}
              title="Cấu hình kết nối máy chủ Backend"
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md border text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                isBackendOnline === false
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                  : 'border-white/[0.1] bg-white/[0.04] text-slate-300 hover:text-white hover:bg-white/[0.08]'
              }`}
            >
              <Server className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">
                {isBackendOnline === false ? 'Máy chủ: Chưa kết nối' : 'Máy chủ: Node.js'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setIsIntegrationModalOpen(true)}
              title="Liên kết với app nhạc của bạn & Cloudflare R2"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-[#1DB954] hover:bg-[#1ED760] text-xs sm:text-sm font-semibold text-[#090B0E] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Webhook className="h-4 w-4" />
              <span>Liên kết App Nhạc &amp; R2</span>
            </button>
          </div>
        </header>

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

        <main className="flex-1 flex flex-col min-w-0 w-full">
          <LocalEnrichView
            bitrate={bitrate}
            embedTags={embedTags}
            autoProcessOnUpload={autoProcessOnUpload}
            autoDownloadEach={autoDownloadEach}
            skipDuplicates={skipDuplicates}
            webhookUrl={integrationConfig.webhookUrl}
            pushConcurrency={integrationConfig.pushConcurrency || 4}
            r2Enabled={Boolean(integrationConfig.r2?.enabled)}
            completedJobs={completedJobs}
            historyItems={historyItems}
            playingLocalId={playingEntry?.localId || null}
            isPlaying={isPlaying}
            onTogglePlayEntry={handleTogglePlayEntry}
            showToast={showToast}
            onOpenIntegrationModal={() => setIsIntegrationModalOpen(true)}
            onOpenHistoryModal={() => setIsHistoryModalOpen(true)}
            onStatsChange={setStats}
            onJobsUpdated={handleJobsUpdated}
            onSyncHistory={syncUploadHistory}
          />
        </main>

        {playingEntry && (
          <AudioPlayerDock
            title={playingEntry.title}
            artist={playingEntry.artist}
            sourceLabel={playingEntry.sourceLabel}
            isPlaying={isPlaying}
            currentTime={audioCurrentTime}
            duration={audioDuration}
            onTogglePlayPause={() => {
              const audio = audioRef.current;
              if (!audio) return;
              if (isPlaying) {
                audio.pause();
                setIsPlaying(false);
              } else {
                audio.play().then(() => setIsPlaying(true)).catch(() => {});
              }
            }}
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
          completedJobs={completedJobs}
          showToast={showToast}
          onSettingsSaved={setIntegrationConfig}
          onJobsUpdated={handleJobsUpdated}
          onSyncHistory={syncUploadHistory}
        />

        <HistoryModal
          isOpen={isHistoryModalOpen}
          onClose={() => setIsHistoryModalOpen(false)}
          items={historyItems}
          onDeleteItem={handleDeleteHistoryItem}
          onClearAll={handleClearAllHistory}
          onImportNames={handleImportHistoryNames}
          showToast={showToast}
        />

        <BackendConnectionModal
          isOpen={isBackendModalOpen}
          onClose={() => setIsBackendModalOpen(false)}
          onConnectionSuccess={() => {
            refreshBackendStatus();
          }}
          showToast={showToast}
        />
      </div>
    </div>
  );
}
