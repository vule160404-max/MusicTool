import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Download,
  FileArchive,
  FileAudio,
  History,
  Image as ImageIcon,
  Loader2,
  Music,
  Pause,
  Play,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Upload,
  Webhook,
  X,
} from 'lucide-react';
import type {
  AudioBitrate,
  DownloadJob,
  EnrichedMetadata,
  LocalTrackEntry,
  UploadHistoryItem,
} from '../types';
import { apiFetch, getBackendBaseUrl } from '../utils/api';
import { readLocalAudioHints } from '../utils/localAudioHints';
import {
  findDuplicateHistoryMatch,
  normalizeFileKey,
  normalizeTrackKey,
} from '../utils/trackHistory';

interface SkippedDuplicateInfo {
  file: File;
  fileName: string;
  matchedLabel: string;
  reason: 'history' | 'current';
}

interface LocalEnrichViewProps {
  bitrate: AudioBitrate;
  embedTags: boolean;
  autoProcessOnUpload: boolean;
  autoDownloadEach: boolean;
  skipDuplicates: boolean;
  webhookUrl: string;
  pushConcurrency: 2 | 4 | 6;
  completedJobs: DownloadJob[];
  historyItems: UploadHistoryItem[];
  playingLocalId: string | null;
  isPlaying: boolean;
  onTogglePlayEntry: (entry: LocalTrackEntry) => void;
  showToast: (msg: string) => void;
  onOpenIntegrationModal: () => void;
  onOpenHistoryModal: () => void;
  onStatsChange: (stats: { totalEntries: number; doneCount: number; totalSizeMb: string }) => void;
  onJobsUpdated: (jobs: DownloadJob[]) => void;
  onSyncHistory: () => Promise<void>;
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
  skipDuplicates,
  webhookUrl,
  pushConcurrency,
  completedJobs,
  historyItems,
  playingLocalId,
  isPlaying,
  onTogglePlayEntry,
  showToast,
  onOpenIntegrationModal,
  onOpenHistoryModal,
  onStatsChange,
  onJobsUpdated,
  onSyncHistory,
}: LocalEnrichViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lrcInputRef = useRef<HTMLInputElement | null>(null);
  const [entries, setEntries] = useState<LocalTrackEntry[]>([]);
  const [skippedDuplicates, setSkippedDuplicates] = useState<SkippedDuplicateInfo[]>([]);
  const [showSkippedDetails, setShowSkippedDetails] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isProcessingAll, setIsProcessingAll] = useState<boolean>(false);
  const [isZipping, setIsZipping] = useState<boolean>(false);
  const [isPushingAll, setIsPushingAll] = useState<boolean>(false);
  const [pushProgress, setPushProgress] = useState<{ done: number; total: number } | null>(null);
  const [isSearchingMissingLyrics, setIsSearchingMissingLyrics] = useState<boolean>(false);
  const [pushingJobIds, setPushingJobIds] = useState<Set<string>>(new Set());
  const [editingLyricsId, setEditingLyricsId] = useState<string | null>(null);
  const [modalSearchTitle, setModalSearchTitle] = useState<string>('');
  const [modalSearchArtist, setModalSearchArtist] = useState<string>('');
  const [isModalSearching, setIsModalSearching] = useState<boolean>(false);
  const [modalSearchNote, setModalSearchNote] = useState<string | null>(null);
  const [editingCoverId, setEditingCoverId] = useState<string | null>(null);

  const autoDownloadRef = useRef(autoDownloadEach);
  autoDownloadRef.current = autoDownloadEach;
  const autoSavedRef = useRef<Set<string>>(new Set());

  const doneJobs = entries
    .map((e) => e.job)
    .filter((j): j is DownloadJob => Boolean(j && j.state === 'done'));

  useEffect(() => {
    if (completedJobs.length === 0) return;
    const jobMap = new Map(completedJobs.map((j) => [j.jobId, j]));
    setEntries((prev) => {
      let changed = false;
      const next = prev.map((e) => {
        if (!e.job) return e;
        const latest = jobMap.get(e.job.jobId);
        if (
          latest &&
          (latest.webhookStatus !== e.job.webhookStatus ||
            latest.webhookMessage !== e.job.webhookMessage ||
            latest.pushedAt !== e.job.pushedAt)
        ) {
          changed = true;
          return { ...e, job: latest };
        }
        return e;
      });
      return changed ? next : prev;
    });
  }, [completedJobs]);

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
    payload: {
      fileName?: string;
      title?: string;
      artist?: string;
      album?: string;
      durationSec?: number;
    }
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
    for (let i = 0; i < 160; i++) {
      await new Promise((r) => setTimeout(r, i < 4 ? 180 : 280));
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

  const processSingleEntry = async (
    entry: LocalTrackEntry,
    syncHistoryAfter = true
  ): Promise<DownloadJob | null> => {
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
        if (finalJob.state === 'done' && syncHistoryAfter) {
          onSyncHistory().catch(() => {});
        }
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

  const handleFilesSelected = async (
    fileList: FileList | File[] | null,
    options?: { forceIncludeDuplicates?: boolean }
  ) => {
    if (!fileList) return;
    const allFiles = Array.isArray(fileList) ? fileList : Array.from(fileList);
    if (allFiles.length === 0) return;

    const forceInclude = Boolean(options?.forceIncludeDuplicates);
    const validFiles = allFiles.filter((f) =>
      /\.(mp3|m4a|wav|ogg|flac|mp4|webm|mkv)$/i.test(f.name)
    );
    const lyricFiles = allFiles.filter((f) => /\.(lrc|txt)$/i.test(f.name));

    const normalizeStem = (name: string) =>
      name
        .replace(/\.[a-zA-Z0-9]{2,5}$/, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

    const lrcMap = new Map<string, { syncedLyrics: string | null; plainLyrics: string }>();
    for (const lf of lyricFiles) {
      try {
        const text = (await lf.text()).trim();
        if (text.length > 10) {
          const isLrc = /\[\d{1,2}:\d{2}/.test(text);
          const plain = isLrc
            ? text
                .split(/\r?\n/)
                .map((l) => l.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, '').trim())
                .filter(Boolean)
                .join('\n')
            : text;
          lrcMap.set(normalizeStem(lf.name), {
            syncedLyrics: isLrc ? text : null,
            plainLyrics: plain || text,
          });
        }
      } catch {
        // Ignore unreadable text file
      }
    }

    if (validFiles.length === 0) {
      if (lrcMap.size > 0) {
        let pairedCount = 0;
        setEntries((prev) =>
          prev.map((e) => {
            const match = lrcMap.get(normalizeStem(e.fileName));
            if (match) {
              pairedCount++;
              return { ...e, syncedLyrics: match.syncedLyrics, plainLyrics: match.plainLyrics };
            }
            return e;
          })
        );
        showToast(
          pairedCount > 0
            ? `Đã ghép lyrics từ file .LRC/.TXT vào ${pairedCount} bài hát.`
            : 'Không tìm thấy bài MP3 nào trùng tên với file .LRC/.TXT vừa thả.'
        );
      } else {
        showToast('Vui lòng chọn file âm thanh (.mp3, .m4a, .wav), video (.mp4, .webm) hoặc kèm file .lrc.');
      }
      return;
    }

    const existingFileKeys = new Set(entries.map((e) => normalizeFileKey(e.fileName)));
    const existingTrackKeys = new Set(
      entries.map((e) => normalizeTrackKey(e.title, e.artist)).filter(Boolean)
    );

    const skippedList: SkippedDuplicateInfo[] = [];
    const acceptedItems: Array<{ entry: LocalTrackEntry; durationSec?: number }> = [];

    for (const file of validFiles) {
      const guessed = guessTitleArtistFromName(file.name);
      const hints = await readLocalAudioHints(file);
      const title = hints.title || guessed.title;
      const artist = hints.artist || guessed.artist;

      if (skipDuplicates && !forceInclude) {
        const fKey = normalizeFileKey(file.name);
        const tKey = normalizeTrackKey(title, artist);
        const histMatch = findDuplicateHistoryMatch(
          { fileName: file.name, title, artist },
          historyItems
        );
        if (histMatch) {
          skippedList.push({
            file,
            fileName: file.name,
            matchedLabel: `${histMatch.title}${histMatch.artist ? ` — ${histMatch.artist}` : ''}`,
            reason: 'history',
          });
          continue;
        }
        if ((fKey && existingFileKeys.has(fKey)) || (tKey && existingTrackKeys.has(tKey))) {
          skippedList.push({
            file,
            fileName: file.name,
            matchedLabel: `${title}${artist ? ` — ${artist}` : ''}`,
            reason: 'current',
          });
          continue;
        }
        if (fKey) existingFileKeys.add(fKey);
        if (tKey) existingTrackKeys.add(tKey);
      }

      const pairedLrc = lrcMap.get(normalizeStem(file.name));
      const embeddedIsLrc = hints.lyrics ? /\[\d{1,2}:\d{2}/.test(hints.lyrics) : false;

      const entry: LocalTrackEntry = {
        localId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        file,
        fileName: file.name,
        fileSizeBytes: file.size,
        title,
        artist,
        album: hints.album || '',
        coverUrl: '',
        durationMs: hints.durationSec ? hints.durationSec * 1000 : 0,
        syncedLyrics: pairedLrc?.syncedLyrics ?? (embeddedIsLrc ? hints.lyrics || null : null),
        plainLyrics: pairedLrc?.plainLyrics ?? (hints.lyrics || null),
        isEnriching: true,
        enrichMatched: false,
      };

      acceptedItems.push({ entry, durationSec: hints.durationSec });
    }

    if (skippedList.length > 0) {
      setSkippedDuplicates(skippedList);
      setShowSkippedDetails(false);
      if (acceptedItems.length === 0) {
        showToast(
          `Tất cả ${skippedList.length} bài đều trùng với lịch sử hoặc danh sách hiện tại nên đã được tự động loại bỏ.`
        );
        return;
      }
      showToast(
        `Đã loại ${skippedList.length} bài trùng — giữ lại ${acceptedItems.length} bài mới để xử lý.`
      );
    } else if (forceInclude) {
      setSkippedDuplicates([]);
    }

    if (acceptedItems.length === 0) return;

    setEntries((prev) => [...prev, ...acceptedItems.map((c) => c.entry)]);

    const queue = [...acceptedItems];
    const workers = Array.from({ length: Math.min(4, queue.length) }).map(async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) break;
        const { entry, durationSec } = next;
        const enriched = await enrichSingleEntry(entry.localId, {
          fileName: entry.fileName,
          title: entry.title,
          artist: entry.artist,
          album: entry.album || undefined,
          durationSec,
        });
        if (autoProcessOnUpload) {
          const mergedEntry: LocalTrackEntry = enriched
            ? {
                ...entry,
                title: enriched.title || entry.title,
                artist: enriched.artist || entry.artist,
                album: enriched.album || entry.album,
                coverUrl: enriched.coverUrl || entry.coverUrl,
                durationMs: enriched.durationMs || entry.durationMs,
                syncedLyrics: enriched.syncedLyrics ?? entry.syncedLyrics,
                plainLyrics: enriched.plainLyrics ?? entry.plainLyrics,
              }
            : entry;
          await processSingleEntry(mergedEntry, false);
        }
      }
    });
    await Promise.all(workers);
    if (autoProcessOnUpload) {
      onSyncHistory().catch(() => {});
    }
  };

  const handleProcessAll = async () => {
    const targets = entries.filter((e) => !e.job || e.job.state === 'error');
    if (targets.length === 0 || isProcessingAll) return;

    setIsProcessingAll(true);
    let doneCount = 0;
    try {
      const queue = [...targets];
      const workers = Array.from({ length: Math.min(4, queue.length) }).map(async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) break;
          const result = await processSingleEntry(item, false);
          if (result?.state === 'done') doneCount++;
        }
      });
      await Promise.all(workers);
      if (doneCount > 0) {
        onSyncHistory().catch(() => {});
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

  const handlePushJobs = async (targetJobs: DownloadJob[], singleMode = false) => {
    const validTargets = targetJobs.filter((j) => j.state === 'done');
    if (validTargets.length === 0) return;

    if (!webhookUrl.trim()) {
      showToast('Chưa có Webhook URL. Hãy nhập và lưu URL trong "Liên kết App Nhạc & R2".');
      onOpenIntegrationModal();
      return;
    }

    const targetIds = validTargets.map((j) => j.jobId);
    if (!singleMode) {
      setIsPushingAll(true);
      setPushProgress({ done: 0, total: validTargets.length });
    }
    setPushingJobIds((prev) => {
      const next = new Set(prev);
      targetIds.forEach((id) => next.add(id));
      return next;
    });

    let pushedCount = 0;
    let failedCount = 0;
    let completedCount = 0;
    let firstFail = '';

    try {
      const concurrency = Math.min(pushConcurrency || 4, validTargets.length);
      const queue = [...validTargets];

      const workers = Array.from({ length: concurrency }).map(async () => {
        while (queue.length > 0) {
          const job = queue.shift();
          if (!job) break;
          try {
            const res = await apiFetch('/api/local/push', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jobIds: [job.jobId],
                webhookUrl: webhookUrl.trim(),
              }),
            });
            const data = (await res.json()) as {
              pushedCount?: number;
              failedCount?: number;
              results?: Array<{ jobId: string; title: string; success: boolean; status: number; message: string }>;
              jobs?: Record<string, DownloadJob>;
              error?: string;
            };

            if (!res.ok) {
              failedCount++;
              if (!firstFail) firstFail = data.error || 'Lỗi đẩy bài hát';
            } else {
              if (data.jobs) {
                const updatedMap = data.jobs;
                setEntries((prev) =>
                  prev.map((e) => (e.job && updatedMap[e.job.jobId] ? { ...e, job: updatedMap[e.job.jobId] } : e))
                );
                onJobsUpdated(Object.values(updatedMap));
              }
              const ok = (data.pushedCount || 0) > 0;
              if (ok) {
                pushedCount++;
              } else {
                failedCount++;
                const msg = data.results?.[0]?.message || data.error || '';
                if (!firstFail && msg) firstFail = msg;
              }
            }
          } catch (err) {
            failedCount++;
            if (!firstFail && err instanceof Error) firstFail = err.message;
          } finally {
            completedCount++;
            if (!singleMode) {
              setPushProgress({ done: completedCount, total: validTargets.length });
            }
            setPushingJobIds((prev) => {
              const next = new Set(prev);
              next.delete(job.jobId);
              return next;
            });
          }
        }
      });

      await Promise.all(workers);

      if (pushedCount > 0) {
        onSyncHistory().catch(() => {});
      }

      if (failedCount === 0) {
        showToast(`Đã đẩy ${pushedCount} bài hát (kèm ảnh bìa & lyrics) sang App Nhạc thành công!`);
      } else if (pushedCount > 0) {
        showToast(
          `Đã đẩy ${pushedCount}/${validTargets.length} bài thành công, ${failedCount} bài lỗi (${firstFail || 'Kiểm tra Webhook'}).`
        );
      } else {
        showToast(`Đẩy sang App thất bại: ${firstFail || 'Kiểm tra lại Webhook URL của App.'}`);
      }
    } finally {
      if (!singleMode) {
        setIsPushingAll(false);
        setPushProgress(null);
      }
      setPushingJobIds((prev) => {
        const next = new Set(prev);
        targetIds.forEach((id) => next.delete(id));
        return next;
      });
    }
  };

  const handleSearchMissingLyrics = async () => {
    const missing = entries.filter((e) => !e.syncedLyrics && !e.plainLyrics && !e.isEnriching);
    if (missing.length === 0 || isSearchingMissingLyrics) return;

    setIsSearchingMissingLyrics(true);
    let foundCount = 0;
    try {
      const queue = [...missing];
      const workers = Array.from({ length: Math.min(3, queue.length) }).map(async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) break;
          setEntries((prev) =>
            prev.map((e) => (e.localId === item.localId ? { ...e, isEnriching: true } : e))
          );
          try {
            const res = await apiFetch('/api/lyrics/search', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                title: item.title,
                artist: item.artist,
                album: item.album || undefined,
                durationSec: item.durationMs > 0 ? Math.round(item.durationMs / 1000) : undefined,
              }),
            });
            const data = (await res.json()) as {
              found?: boolean;
              syncedLyrics?: string | null;
              plainLyrics?: string | null;
            };
            if (res.ok && data.found) {
              foundCount++;
              setEntries((prev) =>
                prev.map((e) =>
                  e.localId === item.localId
                    ? {
                        ...e,
                        syncedLyrics: data.syncedLyrics ?? e.syncedLyrics,
                        plainLyrics: data.plainLyrics ?? e.plainLyrics,
                        isEnriching: false,
                      }
                    : e
                )
              );
            } else {
              setEntries((prev) =>
                prev.map((e) => (e.localId === item.localId ? { ...e, isEnriching: false } : e))
              );
            }
          } catch {
            setEntries((prev) =>
              prev.map((e) => (e.localId === item.localId ? { ...e, isEnriching: false } : e))
            );
          }
        }
      });
      await Promise.all(workers);
      showToast(
        foundCount > 0
          ? `Đã tự động tìm thêm được lyrics cho ${foundCount}/${missing.length} bài hát.`
          : 'Không tìm thấy thêm lyrics mới — bạn có thể rút gọn tên bài hát hoặc bấm Tìm lại ở từng dòng.'
      );
    } finally {
      setIsSearchingMissingLyrics(false);
    }
  };

  const openLyricsModalFor = (entry: LocalTrackEntry) => {
    setEditingLyricsId(entry.localId);
    setModalSearchTitle(entry.title);
    setModalSearchArtist(entry.artist);
    setModalSearchNote(null);
  };

  const handleModalAutoSearchLyrics = async (entry: LocalTrackEntry) => {
    if (!modalSearchTitle.trim() || isModalSearching) return;
    setIsModalSearching(true);
    setModalSearchNote(null);
    try {
      const res = await apiFetch('/api/lyrics/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: modalSearchTitle.trim(),
          artist: modalSearchArtist.trim(),
          album: entry.album || undefined,
          durationSec: entry.durationMs > 0 ? Math.round(entry.durationMs / 1000) : undefined,
        }),
      });
      const data = (await res.json()) as {
        found?: boolean;
        syncedLyrics?: string | null;
        plainLyrics?: string | null;
        source?: string | null;
        error?: string;
      };
      if (res.ok && data.found) {
        setEntries((prev) =>
          prev.map((it) =>
            it.localId === entry.localId
              ? {
                  ...it,
                  syncedLyrics: data.syncedLyrics ?? null,
                  plainLyrics: data.plainLyrics ?? null,
                }
              : it
          )
        );
        const srcLabel =
          data.source === 'netease' || data.source === 'netease-plain'
            ? 'NetEase'
            : data.source === 'lyrics.ovh'
            ? 'Lyrics.ovh'
            : 'LRCLIB';
        setModalSearchNote(
          data.syncedLyrics
            ? `Đã tìm thấy LRC Synced từ ${srcLabel}!`
            : `Đã tìm thấy lời bài hát từ ${srcLabel}!`
        );
      } else {
        setModalSearchNote(
          data.error || 'Chưa khớp bài này — thử bỏ phần (feat./OST) hoặc kiểm tra lại tên ca sĩ.'
        );
      }
    } catch {
      setModalSearchNote('Không thể kết nối máy chủ tìm lyrics.');
    } finally {
      setIsModalSearching(false);
    }
  };

  const editingLyricsEntry = entries.find((e) => e.localId === editingLyricsId) || null;
  const editingCoverEntry = entries.find((e) => e.localId === editingCoverId) || null;
  const pendingCount = entries.filter((e) => !e.job || e.job.state === 'error').length;
  const missingLyricsCount = entries.filter((e) => !e.syncedLyrics && !e.plainLyrics && !e.isEnriching).length;

  return (
    <div className="flex-1 flex flex-col min-w-0 w-full">
      {/* Dropzone & Batch Controls */}
      <div className="border-b border-white/[0.08] bg-[#111419] px-4 lg:px-5 py-4 space-y-3.5">
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
          className={`rounded-lg border border-dashed p-4 sm:p-5 text-center cursor-pointer transition-colors ${
            isDragging
              ? 'border-[#1DB954] bg-[#1DB954]/10'
              : 'border-white/[0.15] bg-[#090B0E] hover:border-white/[0.3] hover:bg-white/[0.02]'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".mp3,.m4a,.wav,.ogg,.flac,.mp4,.webm,.mkv,.lrc,.txt,audio/*,video/*"
            onChange={(e) => {
              handleFilesSelected(e.target.files);
              e.target.value = '';
            }}
            className="hidden"
          />
          <div className="flex flex-col items-center gap-1.5">
            <div className="h-9 w-9 rounded-md bg-white/[0.06] flex items-center justify-center text-[#1DB954]">
              <Upload className="h-4 w-4" />
            </div>
            <div className="text-sm font-medium text-white">
              Kéo thả hàng loạt file MP3 thô vào đây hoặc bấm để chọn file từ máy tính
            </div>
            <div className="text-xs text-slate-400">
              Tự đọc thẻ ID3 gốc, dò đa nguồn (LRCLIB · NetEase · Lyrics.ovh), hỗ trợ thả kèm file{' '}
              <span className="font-mono text-slate-300">.lrc</span> và{' '}
              {skipDuplicates ? (
                <span className="text-[#1DB954]">tự loại bài trùng từ lịch sử ({historyItems.length} bài đã lưu)</span>
              ) : (
                <span>đang tắt bộ lọc trùng lịch sử</span>
              )}
              .
            </div>
          </div>
        </div>

        {skippedDuplicates.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
                <span>
                  Đã tự động loại <strong>{skippedDuplicates.length} bài trùng</strong> với lịch sử đã upload / danh sách hiện tại.
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowSkippedDetails((v) => !v)}
                  className="px-2 py-1 rounded bg-white/[0.08] hover:bg-white/[0.14] text-xs text-amber-100 cursor-pointer"
                >
                  {showSkippedDetails ? 'Ẩn danh sách' : 'Xem bài đã loại'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleFilesSelected(
                      skippedDuplicates.map((s) => s.file),
                      { forceIncludeDuplicates: true }
                    )
                  }
                  className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-[#090B0E] font-semibold text-xs cursor-pointer"
                >
                  Vẫn nạp {skippedDuplicates.length} bài này
                </button>
                <button
                  type="button"
                  onClick={onOpenHistoryModal}
                  className="px-2 py-1 rounded border border-white/[0.15] hover:bg-white/[0.08] text-xs text-white cursor-pointer inline-flex items-center gap-1"
                >
                  <History className="h-3 w-3" />
                  <span>Lịch sử</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSkippedDuplicates([])}
                  aria-label="Đóng thông báo bài trùng"
                  className="p-1 text-amber-300 hover:text-white cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {showSkippedDetails && (
              <div className="max-h-32 overflow-y-auto border-t border-amber-500/20 pt-2 space-y-1 font-mono text-[11px] text-amber-100/90">
                {skippedDuplicates.map((s, idx) => (
                  <div key={`${s.fileName}_${idx}`} className="truncate">
                    • {s.fileName}{' '}
                    <span className="text-amber-300/75">
                      ({s.reason === 'history' ? `trùng lịch sử: ${s.matchedLabel}` : 'đã có trong bảng'})
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {entries.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-0.5">
            <div className="flex items-center gap-2.5 text-xs text-slate-400">
              <span className="font-mono tabular-nums text-white">{entries.length} file đã nạp</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-[#1DB954]">
                Hoàn tất {doneJobs.length}/{entries.length}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {missingLyricsCount > 0 && (
                <button
                  type="button"
                  onClick={handleSearchMissingLyrics}
                  disabled={isSearchingMissingLyrics}
                  title="Tự động dò lại lời bài hát cho các bài đang thiếu lyrics"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/[0.14] bg-white/[0.05] hover:bg-white/[0.1] disabled:opacity-60 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isSearchingMissingLyrics ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1DB954]" />
                      <span>Đang dò lyrics...</span>
                    </>
                  ) : (
                    <>
                      <Search className="h-3.5 w-3.5 text-[#1DB954]" />
                      <span>Tìm lyrics thiếu ({missingLyricsCount})</span>
                    </>
                  )}
                </button>
              )}

              {doneJobs.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => handlePushJobs(doneJobs, false)}
                    disabled={isPushingAll}
                    title={`Đẩy song song ${pushConcurrency || 4} luồng (có thể đổi trong Liên kết App Nhạc)`}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 ${
                      pendingCount === 0
                        ? 'bg-[#1DB954] hover:bg-[#1ED760] text-[#090B0E]'
                        : 'border border-[#1DB954]/45 bg-[#1DB954]/15 hover:bg-[#1DB954]/25 text-[#6ee79c]'
                    }`}
                  >
                    {isPushingAll ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>
                          {pushProgress
                            ? `Đang đẩy ${pushProgress.done}/${pushProgress.total}...`
                            : 'Đang đẩy...'}
                        </span>
                      </>
                    ) : (
                      <>
                        <Send className="h-3.5 w-3.5" />
                        <span>Đẩy sang App ({doneJobs.length})</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadAllZip}
                    disabled={isZipping}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white text-[#090B0E] hover:bg-slate-200 disabled:opacity-60 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {isZipping ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Đang nén ZIP...</span>
                      </>
                    ) : (
                      <>
                        <FileArchive className="h-3.5 w-3.5" />
                        <span>Tải ZIP ({doneJobs.length})</span>
                      </>
                    )}
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={handleProcessAll}
                disabled={pendingCount === 0 || isProcessingAll}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1DB954] hover:bg-[#1ED760] disabled:opacity-45 disabled:pointer-events-none text-[#090B0E] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isProcessingAll ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Đang gắn ảnh &amp; lyrics...</span>
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>Xử lý &amp; Gắn thẻ ({pendingCount})</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setEntries([])}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-xs text-slate-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
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
          <table className="w-full min-w-[680px] table-fixed border-collapse text-left">
            <thead>
              <tr className="border-b border-white/[0.08] bg-[#111419]/80 text-xs font-medium text-slate-400">
                <th className="py-2.5 pl-4 pr-2 w-[74px]">Bìa</th>
                <th className="py-2.5 px-2.5">Tên bài hát &amp; Ca sĩ (sửa trực tiếp nếu cần)</th>
                <th className="py-2.5 px-2.5 w-[142px]">Lời bài hát</th>
                <th className="py-2.5 px-2.5 w-[84px] text-right hidden md:table-cell">Thông số</th>
                <th className="py-2.5 pl-2 pr-4 w-[216px] text-right">Thao tác</th>
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
                    <td className="py-2.5 pl-4 pr-2 align-middle">
                      <div className="flex items-center gap-1">
                        <div className="relative h-10 w-10 rounded overflow-hidden bg-slate-900 border border-white/[0.1] flex items-center justify-center group shrink-0">
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
                          className="p-1 rounded text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
                        >
                          <ImageIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>

                    {/* Editable Title & Artist */}
                    <td className="py-2.5 px-2.5 align-middle min-w-0">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
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
                            className="min-w-0 flex-1 h-8 rounded bg-[#090B0E] border border-white/[0.08] px-2.5 text-sm font-medium text-white focus:outline-none focus:border-[#1DB954]"
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
                            className="w-24 sm:w-28 xl:w-36 shrink-0 h-8 rounded bg-[#090B0E] border border-white/[0.08] px-2 text-xs text-slate-300 focus:outline-none focus:border-[#1DB954]"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              enrichSingleEntry(entry.localId, {
                                title: entry.title,
                                artist: entry.artist,
                                album: entry.album || undefined,
                                durationSec:
                                  entry.durationMs > 0 ? Math.round(entry.durationMs / 1000) : undefined,
                              })
                            }
                            disabled={entry.isEnriching}
                            title="Tìm lại ảnh bìa & lyrics theo tên vừa sửa"
                            className="h-8 px-2 xl:px-2.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-xs text-slate-200 transition-colors shrink-0 cursor-pointer inline-flex items-center gap-1 whitespace-nowrap"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${entry.isEnriching ? 'animate-spin' : ''}`} />
                            <span className="hidden xl:inline">Tìm lại</span>
                          </button>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono truncate">
                          <span className="truncate">
                            {entry.fileName}
                            {entry.album ? ` · ${entry.album}` : ''}
                          </span>
                          {!skipDuplicates &&
                            !entry.job &&
                            Boolean(
                              findDuplicateHistoryMatch(
                                { fileName: entry.fileName, title: entry.title, artist: entry.artist },
                                historyItems
                              )
                            ) && (
                              <span className="text-amber-400 shrink-0">· Đã từng up</span>
                            )}
                        </div>
                      </div>
                    </td>

                    {/* Lyrics status */}
                    <td className="py-2.5 px-2.5 align-middle">
                      <div className="flex items-center justify-between gap-1.5">
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
                            ? 'Đang dò'
                            : entry.syncedLyrics
                            ? 'LRC Sync'
                            : entry.plainLyrics
                            ? 'Có lời'
                            : 'Chưa có'}
                        </span>
                        <button
                          type="button"
                          onClick={() => openLyricsModalFor(entry)}
                          className="px-2 py-1 rounded bg-white/[0.06] hover:bg-white/[0.12] text-xs text-slate-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                        >
                          {hasLyrics ? 'Xem / Sửa' : 'Tìm / Thêm'}
                        </button>
                      </div>
                    </td>

                    {/* Combined Duration & Size */}
                    <td className="py-2.5 px-2.5 align-middle text-right font-mono text-xs tabular-nums hidden md:table-cell">
                      <div className="text-slate-300 leading-tight">{formatDurationMs(entry.durationMs)}</div>
                      <div className="text-[11px] text-slate-500 leading-tight">
                        {formatBytes(job?.fileSizeBytes || entry.fileSizeBytes)}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 pl-2 pr-4 align-middle text-right">
                      {!job && (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => processSingleEntry(entry)}
                            disabled={entry.isEnriching}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white/[0.08] hover:bg-[#1DB954] text-slate-200 hover:text-[#090B0E] text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>Gắn thẻ</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setEntries((prev) => prev.filter((e) => e.localId !== entry.localId))
                            }
                            aria-label={`Xóa ${entry.title}`}
                            className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-white/[0.05] transition-colors cursor-pointer shrink-0"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}

                      {isActive && job && (
                        <div className="flex flex-col items-end gap-1 ml-auto max-w-[195px]">
                          <div className="flex items-center justify-between w-full gap-2 text-xs">
                            <span className="text-slate-300 truncate flex items-center gap-1">
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
                              style={{ width: `${Math.max(5, job.progress)}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {isDone && job && (
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {job.webhookStatus === 'pushed' ? (
                            <span
                              title={job.webhookMessage || 'Đã đẩy sang App Nhạc'}
                              className="text-xs text-[#1DB954] whitespace-nowrap"
                            >
                              Đã đẩy
                            </span>
                          ) : job.webhookStatus === 'error' ? (
                            <span
                              title={job.webhookMessage || 'Lỗi đẩy sang App'}
                              className="text-xs text-red-400 whitespace-nowrap"
                            >
                              Lỗi đẩy
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400 whitespace-nowrap">Đã gắn</span>
                          )}

                          <button
                            type="button"
                            onClick={() => handlePushJobs([job], true)}
                            disabled={pushingJobIds.has(job.jobId)}
                            title={
                              job.webhookStatus === 'error' && job.webhookMessage
                                ? job.webhookMessage
                                : 'Đẩy bài hát này sang App Nhạc & R2'
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#1DB954] hover:bg-[#1ED760] disabled:opacity-60 text-[#090B0E] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            {pushingJobIds.has(job.jobId) ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Send className="h-3.5 w-3.5" />
                            )}
                            <span>{job.webhookStatus === 'pushed' || job.webhookStatus === 'error' ? 'Đẩy lại' : 'Đẩy App'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => triggerSaveJobFile(job)}
                            title="Tải file MP3 đã gắn thẻ về máy"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-white/[0.08] hover:bg-white/[0.14] text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span>Lưu</span>
                          </button>
                        </div>
                      )}

                      {isError && job && (
                        <div className="inline-flex items-center gap-1.5 max-w-[205px]">
                          <span title={job.error || ''} className="inline-flex items-center gap-1 text-xs text-red-400 truncate">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{job.error}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => processSingleEntry(entry)}
                            className="px-2 py-1 rounded bg-white/[0.08] hover:bg-white/[0.14] text-xs text-white cursor-pointer shrink-0 whitespace-nowrap"
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
              <div className="min-w-0 pr-3">
                <h3 className="font-display text-sm font-semibold text-white truncate">
                  {editingLyricsEntry.title} — {editingLyricsEntry.artist || 'Chưa rõ ca sĩ'}
                </h3>
                <span className="text-xs text-slate-400">Hỗ trợ tìm tự động đa nguồn, nạp file .LRC/.TXT hoặc dán trực tiếp</span>
              </div>
              <button
                type="button"
                onClick={() => setEditingLyricsId(null)}
                className="p-1 text-slate-400 hover:text-white cursor-pointer shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Quick In-Modal Lyrics Search */}
            <div className="rounded-lg bg-[#090B0E] border border-white/[0.08] p-3 space-y-2">
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                <input
                  type="text"
                  value={modalSearchTitle}
                  onChange={(e) => setModalSearchTitle(e.target.value)}
                  placeholder="Tên bài hát (ngắn gọn)..."
                  className="flex-1 min-w-[140px] h-8 rounded bg-[#141920] border border-white/[0.1] px-2.5 text-xs text-white focus:outline-none focus:border-[#1DB954]"
                />
                <input
                  type="text"
                  value={modalSearchArtist}
                  onChange={(e) => setModalSearchArtist(e.target.value)}
                  placeholder="Ca sĩ..."
                  className="w-32 sm:w-36 shrink-0 h-8 rounded bg-[#141920] border border-white/[0.1] px-2.5 text-xs text-slate-200 focus:outline-none focus:border-[#1DB954]"
                />
                <button
                  type="button"
                  onClick={() => handleModalAutoSearchLyrics(editingLyricsEntry)}
                  disabled={isModalSearching || !modalSearchTitle.trim()}
                  className="h-8 px-3 rounded bg-[#1DB954] hover:bg-[#1ED760] disabled:opacity-50 text-[#090B0E] text-xs font-semibold transition-colors shrink-0 cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  {isModalSearching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="h-3.5 w-3.5" />
                  )}
                  <span>Tìm tự động</span>
                </button>
              </div>
              {modalSearchNote && (
                <div className="text-[11px] text-[#6ee79c]">{modalSearchNote}</div>
              )}
            </div>

            <textarea
              rows={9}
              value={editingLyricsEntry.syncedLyrics || editingLyricsEntry.plainLyrics || ''}
              onChange={(e) => {
                const val = e.target.value;
                const isLrc = /\[\d{1,2}:\d{2}/.test(val);
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

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <input
                  ref={lrcInputRef}
                  type="file"
                  accept=".lrc,.txt,text/plain"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    const text = (await f.text()).trim();
                    if (!text) return;
                    const isLrc = /\[\d{1,2}:\d{2}/.test(text);
                    setEntries((prev) =>
                      prev.map((it) =>
                        it.localId === editingLyricsEntry.localId
                          ? {
                              ...it,
                              syncedLyrics: isLrc ? text : null,
                              plainLyrics: text,
                            }
                          : it
                      )
                    );
                    setModalSearchNote(`Đã nạp lời từ file ${f.name}`);
                  }}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => lrcInputRef.current?.click()}
                  className="px-3 py-2 rounded-md border border-white/[0.1] bg-white/[0.05] hover:bg-white/[0.1] text-xs text-slate-200 transition-colors cursor-pointer inline-flex items-center gap-1.5"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>Nạp file .LRC / .TXT</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                {editingLyricsEntry.job?.state === 'done' && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = entries.find((e) => e.localId === editingLyricsEntry.localId);
                      setEditingLyricsId(null);
                      if (target) processSingleEntry(target);
                    }}
                    className="px-3 py-2 rounded-md border border-[#1DB954]/45 bg-[#1DB954]/15 hover:bg-[#1DB954]/25 text-[#6ee79c] text-xs font-semibold cursor-pointer"
                  >
                    Lưu &amp; Gắn lại MP3
                  </button>
                )}
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
        </div>
      )}
    </div>
  );
}
