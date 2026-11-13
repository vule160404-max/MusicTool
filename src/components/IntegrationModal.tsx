import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  HardDrive,
  Key,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  Webhook,
  X,
} from 'lucide-react';
import type { DownloadJob, IntegrationConfig } from '../types';
import { apiFetch, getBackendBaseUrl } from '../utils/api';

interface IntegrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  completedJobs: DownloadJob[];
  showToast: (msg: string) => void;
  onSettingsSaved?: (config: IntegrationConfig) => void;
  onJobsUpdated?: (jobs: DownloadJob[]) => void;
  onSyncHistory?: () => Promise<void>;
}

export function IntegrationModal({
  isOpen,
  onClose,
  completedJobs,
  showToast,
  onSettingsSaved,
  onJobsUpdated,
  onSyncHistory,
}: IntegrationModalProps) {
  const [config, setConfig] = useState<IntegrationConfig>({
    apiKey: '',
    webhookUrl: '',
    autoPushWebhook: false,
    pushConcurrency: 4,
    r2: {
      enabled: false,
      accountId: '',
      accessKeyId: '',
      hasSecretKey: false,
      secretKeyPreview: '',
      bucketName: '',
      publicBaseUrl: '',
    },
  });
  const [r2SecretInput, setR2SecretInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [isTestingR2, setIsTestingR2] = useState<boolean>(false);
  const [isPushingAll, setIsPushingAll] = useState<boolean>(false);
  const [pushProgress, setPushProgress] = useState<{ done: number; total: number } | null>(null);
  const [pushingJobIds, setPushingJobIds] = useState<Set<string>>(new Set());
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [r2TestResult, setR2TestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);
  const [copiedEndpoint, setCopiedEndpoint] = useState<boolean>(false);
  const [copiedEnrichEndpoint, setCopiedEnrichEndpoint] = useState<boolean>(false);
  const [copiedPrompt, setCopiedPrompt] = useState<boolean>(false);
  const [selectedLyricsJob, setSelectedLyricsJob] = useState<DownloadJob | null>(null);

  const base = getBackendBaseUrl();
  const originBase = base || window.location.origin;
  const apiEndpointUrl = `${originBase}/api/external/tracks`;
  const enrichEndpointUrl = `${originBase}/api/external/enrich`;

  const r2PromptText = `Hãy cập nhật endpoint Webhook POST /api/webhooks/spotflow trên App Nhạc để nhận bài hát do SpotFlow tải thẳng lên Cloudflare R2 (tránh tải/upload lặp lại qua Vercel):

1. Xác thực header X-API-Key: "${config.apiKey || '<API_KEY>'}"

2. Khi nhận body JSON { event: "track_downloaded", storage, track }:
   - Nếu track.storage === "r2" hoặc có sẵn track.r2AudioUrl:
     * KHÔNG cần tải lại file từ downloadUrl hay upload lại lên R2 (vì SpotFlow đã đẩy sẵn file vào tracks/... và covers/... trên R2).
     * Dùng trực tiếp:
       - audioUrl = track.r2AudioUrl || track.audioUrl
       - coverUrl = track.r2CoverUrl || track.coverUrl || null
       - r2AudioKey = track.r2AudioKey (lưu nếu DB quản lý key để xóa file sau này)
       - r2CoverKey = track.r2CoverKey
     * Ghi thẳng 1 bản ghi bài hát mới (title, artist, album, durationMs, audioUrl, coverUrl, syncedLyrics, plainLyrics) vào Database của App Nhạc và trả về HTTP 200 { "ok": true }.
   - Nếu có lỗi lưu Database hoặc thiếu audioUrl: PHẢI trả về mã lỗi HTTP 4xx/5xx (hoặc { "ok": false, "error": "..." }) thay vì { "ok": true }.

3. Fallback cho luồng cũ (khi track.storage !== "r2"):
   - Tải MP3 từ track.downloadUrl & ảnh từ track.coverUrl rồi upload lên R2 (tracks/<slug>-<timestamp>.mp3, covers/<slug>-<timestamp>.jpg) trước khi ghi DB.

4. (Tùy chọn) API làm giàu metadata khi upload trực tiếp trên App Nhạc:
   - POST ${enrichEndpointUrl} (Header X-API-Key) với { fileName, title, artist } để lấy coverUrl, syncedLyrics, plainLyrics.`;

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setR2SecretInput('');
      setR2TestResult(null);
      try {
        const res = await apiFetch('/api/integration/settings');
        if (!res.ok) return;
        const data = (await res.json()) as IntegrationConfig;
        if (!cancelled) {
          setConfig(data);
          onSettingsSaved?.(data);
        }
      } catch {
        // Ignore
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, onSettingsSaved]);

  const handleSaveSettings = async (
    regenerate = false,
    overrideConcurrency?: 2 | 4 | 6,
    clearR2Secret = false
  ) => {
    setIsSaving(true);
    const nextConcurrency = overrideConcurrency || config.pushConcurrency || 4;
    const r2State = config.r2 || {
      enabled: false,
      accountId: '',
      accessKeyId: '',
      hasSecretKey: false,
      secretKeyPreview: '',
      bucketName: '',
      publicBaseUrl: '',
    };
    try {
      const res = await apiFetch('/api/integration/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookUrl: config.webhookUrl,
          autoPushWebhook: config.autoPushWebhook,
          pushConcurrency: nextConcurrency,
          regenerateKey: regenerate,
          r2: {
            enabled: r2State.enabled,
            accountId: r2State.accountId,
            accessKeyId: r2State.accessKeyId,
            bucketName: r2State.bucketName,
            publicBaseUrl: r2State.publicBaseUrl,
            ...(clearR2Secret
              ? { clearSecretKey: true }
              : r2SecretInput.trim()
              ? { secretAccessKey: r2SecretInput.trim() }
              : {}),
          },
        }),
      });
      if (!res.ok) throw new Error('Không thể lưu cài đặt.');
      const data = (await res.json()) as IntegrationConfig;
      setConfig(data);
      setR2SecretInput('');
      onSettingsSaved?.(data);
      if (!overrideConcurrency) {
        showToast(
          regenerate
            ? 'Đã tạo mới API Key thành công!'
            : clearR2Secret
            ? 'Đã xóa R2 Secret Key khỏi cấu hình.'
            : 'Đã lưu cấu hình R2 & Liên kết App Nhạc.'
        );
      }
    } catch {
      showToast('Lỗi khi lưu cấu hình.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestR2 = async () => {
    const r2State = config.r2;
    if (!r2State) return;
    setIsTestingR2(true);
    setR2TestResult(null);
    try {
      const res = await apiFetch('/api/integration/r2-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: r2State.accountId,
          accessKeyId: r2State.accessKeyId,
          ...(r2SecretInput.trim() ? { secretAccessKey: r2SecretInput.trim() } : {}),
          bucketName: r2State.bucketName,
          publicBaseUrl: r2State.publicBaseUrl,
        }),
      });
      const data = (await res.json()) as { success?: boolean; message?: string };
      setR2TestResult({
        success: Boolean(data.success),
        message: data.message || (res.ok ? 'Kết nối R2 thành công!' : 'Lỗi kết nối R2.'),
      });
    } catch (err) {
      setR2TestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Không thể kiểm tra kết nối R2.',
      });
    } finally {
      setIsTestingR2(false);
    }
  };

  const handleTestWebhook = async () => {
    if (!config.webhookUrl.trim()) {
      showToast('Vui lòng nhập Webhook URL trước khi kiểm tra.');
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch('/api/external/webhook-test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.apiKey,
        },
        body: JSON.stringify({ webhookUrl: config.webhookUrl }),
      });
      const data = (await res.json()) as { success?: boolean; message?: string; error?: string };
      setTestResult({
        success: Boolean(data.success),
        message: data.message || data.error || 'Phản hồi từ webhook',
      });
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Lỗi kết nối webhook',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handlePushFromModal = async (targetJobs: DownloadJob[], singleMode = false) => {
    const targetUrl = config.webhookUrl.trim();
    if (!targetUrl) {
      showToast('Vui lòng nhập Webhook URL ở mục 2 trước khi đẩy bài hát.');
      return;
    }
    if (targetJobs.length === 0) return;

    const targetIds = targetJobs.map((j) => j.jobId);
    if (!singleMode) {
      setIsPushingAll(true);
      setPushProgress({ done: 0, total: targetJobs.length });
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
      const concurrency = Math.min(config.pushConcurrency || 4, targetJobs.length);
      const queue = [...targetJobs];

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
                webhookUrl: targetUrl,
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
              if (data.jobs && onJobsUpdated) {
                onJobsUpdated(Object.values(data.jobs));
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
              setPushProgress({ done: completedCount, total: targetJobs.length });
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
        onSyncHistory?.().catch(() => {});
      }

      if (failedCount === 0) {
        showToast(`Đã đẩy ${pushedCount} bài hát sang App Nhạc thành công!`);
      } else if (pushedCount > 0) {
        showToast(
          `Đã đẩy ${pushedCount}/${targetJobs.length} bài thành công, ${failedCount} bài lỗi (${firstFail || 'Kiểm tra Webhook'}).`
        );
      } else {
        showToast(`Đẩy sang App thất bại: ${firstFail || 'Kiểm tra lại Webhook URL.'}`);
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

  const copyToClipboard = async (
    text: string,
    type: 'key' | 'endpoint' | 'enrich' | 'prompt'
  ) => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'key') {
        setCopiedKey(true);
        setTimeout(() => setCopiedKey(false), 1500);
      } else if (type === 'endpoint') {
        setCopiedEndpoint(true);
        setTimeout(() => setCopiedEndpoint(false), 1500);
      } else if (type === 'enrich') {
        setCopiedEnrichEndpoint(true);
        setTimeout(() => setCopiedEnrichEndpoint(false), 1500);
      } else {
        setCopiedPrompt(true);
        setTimeout(() => setCopiedPrompt(false), 1800);
      }
      showToast('Đã sao chép vào bộ nhớ tạm.');
    } catch {
      showToast('Không thể sao chép.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-[#111419] border border-white/[0.12] shadow-2xl text-slate-100 p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1DB954]/15 text-[#1DB954]">
              <Webhook className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold text-white">
                Liên kết App Nhạc &amp; Đồng bộ API
              </h2>
              <p className="text-xs text-slate-400">
                Tự động đẩy bài hát, ảnh bìa và lời bài hát (lyrics) sang ứng dụng nhạc của bạn
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cửa sổ"
            className="rounded-lg p-2 text-slate-400 hover:bg-white/[0.08] hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {isLoading ? (
          <div className="py-16 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#1DB954]" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Step 1: Cloudflare R2 Direct Upload */}
            <div className="space-y-3.5 rounded-lg bg-[#090B0E] p-4 border border-white/[0.08]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#1DB954] flex items-center gap-1.5">
                    <HardDrive className="h-3.5 w-3.5" />
                    <span>1. Tải thẳng lên Cloudflare R2 (Khuyên dùng)</span>
                  </span>
                  <p className="text-xs text-slate-400 mt-1">
                    SpotFlow tải trực tiếp MP3 &amp; ảnh bìa lên R2 (<code className="text-slate-300">tracks/</code> và <code className="text-slate-300">covers/</code>), bỏ bước trung gian qua Vercel.
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(config.r2?.enabled)}
                  aria-label="Bật tải thẳng lên Cloudflare R2"
                  onClick={() =>
                    setConfig((prev) => ({
                      ...prev,
                      r2: {
                        enabled: !prev.r2?.enabled,
                        accountId: prev.r2?.accountId || '',
                        accessKeyId: prev.r2?.accessKeyId || '',
                        hasSecretKey: Boolean(prev.r2?.hasSecretKey),
                        secretKeyPreview: prev.r2?.secretKeyPreview || '',
                        bucketName: prev.r2?.bucketName || '',
                        publicBaseUrl: prev.r2?.publicBaseUrl || '',
                      },
                    }))
                  }
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] ${
                    config.r2?.enabled ? 'bg-[#1DB954]' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      config.r2?.enabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="r2-account-id" className="block text-xs text-slate-400">
                    Cloudflare Account ID
                  </label>
                  <input
                    id="r2-account-id"
                    type="text"
                    value={config.r2?.accountId || ''}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        r2: { ...(prev.r2 || { enabled: true, accountId: '', accessKeyId: '', hasSecretKey: false, secretKeyPreview: '', bucketName: '', publicBaseUrl: '' }), accountId: e.target.value },
                      }))
                    }
                    placeholder="32 ký tự hex Account ID"
                    className="w-full h-9 rounded bg-[#141920] border border-white/[0.1] px-3 font-mono text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-[#1DB954]"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="r2-bucket-name" className="block text-xs text-slate-400">
                    Tên Bucket R2
                  </label>
                  <input
                    id="r2-bucket-name"
                    type="text"
                    value={config.r2?.bucketName || ''}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        r2: { ...(prev.r2 || { enabled: true, accountId: '', accessKeyId: '', hasSecretKey: false, secretKeyPreview: '', bucketName: '', publicBaseUrl: '' }), bucketName: e.target.value },
                      }))
                    }
                    placeholder="vd: soundly-music"
                    className="w-full h-9 rounded bg-[#141920] border border-white/[0.1] px-3 font-mono text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-[#1DB954]"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="r2-access-key" className="block text-xs text-slate-400">
                    R2 Access Key ID
                  </label>
                  <input
                    id="r2-access-key"
                    type="text"
                    value={config.r2?.accessKeyId || ''}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        r2: { ...(prev.r2 || { enabled: true, accountId: '', accessKeyId: '', hasSecretKey: false, secretKeyPreview: '', bucketName: '', publicBaseUrl: '' }), accessKeyId: e.target.value },
                      }))
                    }
                    placeholder="Access Key ID của R2 API Token"
                    className="w-full h-9 rounded bg-[#141920] border border-white/[0.1] px-3 font-mono text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-[#1DB954]"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="r2-secret-key" className="block text-xs text-slate-400">
                      R2 Secret Access Key
                    </label>
                    {config.r2?.hasSecretKey && (
                      <button
                        type="button"
                        onClick={() => handleSaveSettings(false, undefined, true)}
                        disabled={isSaving}
                        className="text-[11px] text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
                      >
                        Xóa khóa đã lưu
                      </button>
                    )}
                  </div>
                  <input
                    id="r2-secret-key"
                    type="password"
                    value={r2SecretInput}
                    onChange={(e) => setR2SecretInput(e.target.value)}
                    placeholder={
                      config.r2?.hasSecretKey
                        ? `Đã lưu (${config.r2.secretKeyPreview}) — nhập mới để đổi`
                        : 'Secret Access Key (chỉ lưu tại server)'
                    }
                    className="w-full h-9 rounded bg-[#141920] border border-white/[0.1] px-3 font-mono text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#1DB954]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="r2-public-url" className="block text-xs text-slate-400">
                  Public Domain URL của Bucket R2 (link phát nhạc công khai)
                </label>
                <input
                  id="r2-public-url"
                  type="url"
                  value={config.r2?.publicBaseUrl || ''}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      r2: { ...(prev.r2 || { enabled: true, accountId: '', accessKeyId: '', hasSecretKey: false, secretKeyPreview: '', bucketName: '', publicBaseUrl: '' }), publicBaseUrl: e.target.value },
                    }))
                  }
                  placeholder="https://pub-xxxxxxxx.r2.dev hoặc https://cdn.appnhaccuaban.com"
                  className="w-full h-9 rounded bg-[#141920] border border-white/[0.1] px-3 font-mono text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-[#1DB954]"
                />
              </div>

              {r2TestResult && (
                <div
                  className={`text-xs p-2.5 rounded border ${
                    r2TestResult.success
                      ? 'bg-[#1DB954]/10 border-[#1DB954]/30 text-[#6ee79c]'
                      : 'bg-red-500/10 border-red-500/30 text-red-400'
                  }`}
                >
                  {r2TestResult.message}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <span className="text-[11px] text-slate-500">
                  Quy chuẩn key: <span className="font-mono text-slate-300">tracks/&lt;slug&gt;-&lt;id&gt;.mp3</span> ·{' '}
                  <span className="font-mono text-slate-300">covers/&lt;slug&gt;-&lt;id&gt;.jpg</span>
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleTestR2}
                    disabled={isTestingR2}
                    className="h-8 px-3 rounded bg-white/[0.08] hover:bg-white/[0.14] disabled:opacity-45 text-xs font-medium text-white transition-colors cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {isTestingR2 ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1DB954]" />
                    ) : (
                      <HardDrive className="h-3.5 w-3.5 text-[#1DB954]" />
                    )}
                    <span>Kiểm tra kết nối R2</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveSettings(false)}
                    disabled={isSaving}
                    className="h-8 px-3.5 rounded bg-[#1DB954] hover:bg-[#1ED760] disabled:opacity-50 text-[#090B0E] text-xs font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <span>Lưu cấu hình R2</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Step 2: Webhook URL & Auto Push */}
            <div className="space-y-3 rounded-lg bg-[#090B0E] p-4 border border-white/[0.08]">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#1DB954] flex items-center gap-1.5">
                <Send className="h-3.5 w-3.5" />
                <span>2. Webhook Ghi Bài Hát Sang App Nhạc</span>
              </span>
              <p className="text-xs text-slate-400">
                Sau khi SpotFlow tải file lên R2 xong (hoặc khi tắt R2), hệ thống gọi HTTP POST tới URL dưới đây để App Nhạc lưu metadata &amp; lyrics vào Database.
              </p>

              <div className="space-y-2">
                <label htmlFor="webhook-url-input" className="block text-xs text-slate-400">Webhook Receiver URL của bạn</label>
                <div className="flex items-center gap-2">
                  <input
                    id="webhook-url-input"
                    type="url"
                    value={config.webhookUrl}
                    onChange={(e) => setConfig({ ...config, webhookUrl: e.target.value })}
                    placeholder="https://app-nhac-cua-ban.com/api/webhooks/spotflow"
                    className="w-full h-9 rounded bg-[#141920] border border-white/[0.1] px-3 font-mono text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-[#1DB954]"
                  />
                  <button
                    type="button"
                    onClick={handleTestWebhook}
                    disabled={isTesting || !config.webhookUrl.trim()}
                    className="h-9 px-3 rounded bg-white/[0.08] hover:bg-white/[0.14] disabled:opacity-40 text-xs font-medium text-white transition-colors shrink-0 cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[#1DB954]" /> : <Send className="h-3.5 w-3.5" />}
                    <span>Kiểm tra</span>
                  </button>
                </div>
                {testResult && (
                  <div
                    className={`text-xs p-2.5 rounded border ${
                      testResult.success
                        ? 'bg-[#1DB954]/10 border-[#1DB954]/30 text-[#6ee79c]'
                        : 'bg-red-500/10 border-red-500/30 text-red-400'
                    }`}
                  >
                    {testResult.message}
                    {testResult.success && ' — Bấm "Lưu cài đặt liên kết" để lưu URL này.'}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-1">
                <div>
                  <div className="text-xs font-medium text-slate-200">Tự động đẩy khi xử lý xong</div>
                  <div className="text-xs text-slate-500">Tự động tải lên R2 và gọi webhook ngay khi gắn thẻ xong</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={config.autoPushWebhook}
                  onClick={() => setConfig({ ...config, autoPushWebhook: !config.autoPushWebhook })}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] ${
                    config.autoPushWebhook ? 'bg-[#1DB954]' : 'bg-slate-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      config.autoPushWebhook ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="space-y-2 pt-1 border-t border-white/[0.06]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium text-slate-200">Tốc độ đẩy song song lên R2 &amp; App</div>
                    <div className="text-xs text-slate-500">
                      Chạy nhiều luồng cùng lúc giúp đẩy 40–50 bài nhanh hơn 4–6 lần
                    </div>
                  </div>
                  <div className="inline-flex rounded-md bg-[#141920] p-0.5 border border-white/[0.08]">
                    {([2, 4, 6] as const).map((val) => {
                      const active = (config.pushConcurrency || 4) === val;
                      return (
                        <button
                          key={val}
                          type="button"
                          onClick={() => {
                            setConfig((prev) => ({ ...prev, pushConcurrency: val }));
                            handleSaveSettings(false, val);
                          }}
                          className={`px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                            active
                              ? 'bg-[#1DB954] text-[#090B0E] font-semibold'
                              : 'text-slate-300 hover:text-white'
                          }`}
                        >
                          {val} luồng{val === 4 ? ' (Khuyên dùng)' : val === 6 ? ' (Tối đa)' : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => handleSaveSettings(false)}
                  disabled={isSaving}
                  className="px-4 py-2 rounded-md bg-[#1DB954] hover:bg-[#1ED760] text-[#090B0E] text-xs font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>Lưu cài đặt liên kết</span>
                </button>
              </div>
            </div>

            {/* Step 3: API Endpoint, Key & Prompt */}
            <div className="space-y-3 rounded-lg bg-[#090B0E] p-4 border border-white/[0.08]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#1DB954] flex items-center gap-1.5">
                  <Key className="h-3.5 w-3.5" />
                  <span>3. API Endpoint, Khóa Bảo Mật &amp; Prompt cập nhật App Nhạc</span>
                </span>
                <button
                  type="button"
                  onClick={() => handleSaveSettings(true)}
                  disabled={isSaving}
                  className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>Tạo khóa mới</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs text-slate-400">REST API Endpoint danh sách bài</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={apiEndpointUrl}
                      className="w-full h-9 rounded bg-[#141920] border border-white/[0.1] px-3 font-mono text-xs text-slate-200 select-all"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(apiEndpointUrl, 'endpoint')}
                      className="h-9 px-3 rounded bg-white/[0.08] hover:bg-white/[0.14] text-xs font-medium text-white transition-colors shrink-0 cursor-pointer inline-flex items-center gap-1.5"
                    >
                      {copiedEndpoint ? <Check className="h-3.5 w-3.5 text-[#1DB954]" /> : <Copy className="h-3.5 w-3.5" />}
                      <span>{copiedEndpoint ? 'Đã chép' : 'Chép'}</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs text-slate-400">API Tìm Ảnh Bìa &amp; Lyrics (<code className="text-[#1DB954]">POST</code>)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={enrichEndpointUrl}
                      className="w-full h-9 rounded bg-[#141920] border border-white/[0.1] px-3 font-mono text-xs text-slate-200 select-all"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(enrichEndpointUrl, 'enrich')}
                      className="h-9 px-3 rounded bg-white/[0.08] hover:bg-white/[0.14] text-xs font-medium text-white transition-colors shrink-0 cursor-pointer inline-flex items-center gap-1.5"
                    >
                      {copiedEnrichEndpoint ? <Check className="h-3.5 w-3.5 text-[#1DB954]" /> : <Copy className="h-3.5 w-3.5" />}
                      <span>{copiedEnrichEndpoint ? 'Đã chép' : 'Chép'}</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs text-slate-400">API Key bảo mật (Header <code className="text-[#1DB954]">X-API-Key</code>)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    readOnly
                    value={config.apiKey}
                    className="w-full h-9 rounded bg-[#141920] border border-white/[0.1] px-3 font-mono text-xs text-slate-200 select-all"
                  />
                  <button
                    type="button"
                    onClick={() => copyToClipboard(config.apiKey, 'key')}
                    className="h-9 px-3 rounded bg-white/[0.08] hover:bg-white/[0.14] text-xs font-medium text-white transition-colors shrink-0 cursor-pointer inline-flex items-center gap-1.5"
                  >
                    {copiedKey ? <Check className="h-3.5 w-3.5 text-[#1DB954]" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedKey ? 'Đã chép' : 'Sao chép'}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-200">
                    Prompt cập nhật Webhook bên App Nhạc (nhận link R2 trực tiếp, tránh trùng &amp; tải lại)
                  </span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(r2PromptText, 'prompt')}
                    className="px-3 py-1.5 rounded bg-[#1DB954] hover:bg-[#1ED760] text-[#090B0E] text-xs font-semibold transition-colors shrink-0 cursor-pointer inline-flex items-center gap-1.5"
                  >
                    {copiedPrompt ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedPrompt ? 'Đã chép Prompt' : 'Sao chép Prompt'}</span>
                  </button>
                </div>
                <pre className="max-h-36 overflow-y-auto rounded bg-[#141920] border border-white/[0.08] p-3 font-mono text-[11px] text-slate-300 whitespace-pre-wrap">
                  {r2PromptText}
                </pre>
              </div>
            </div>

            {/* Step 4: Processed Tracks & Manual Push */}
            <div className="space-y-3 rounded-lg bg-[#090B0E] p-4 border border-white/[0.08]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#1DB954] flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>4. Bài hát đã xử lý &amp; Đẩy sang App ({completedJobs.length})</span>
                </span>
                {completedJobs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handlePushFromModal(completedJobs, false)}
                    disabled={isPushingAll || !config.webhookUrl.trim()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#1DB954] hover:bg-[#1ED760] disabled:opacity-45 text-[#090B0E] text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
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
                        <span>{config.r2?.enabled ? 'Đẩy tất cả lên R2 & App' : 'Đẩy tất cả sang App'}</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {completedJobs.length === 0 ? (
                <p className="text-xs text-slate-400 py-2">
                  Chưa có bài hát nào được xử lý xong trong phiên này. Hãy kéo thả file MP3 và bấm &quot;Xử lý &amp; Gắn thẻ&quot; để chuẩn bị bài hát đẩy sang R2 &amp; App.
                </p>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {completedJobs.map((j) => {
                    const isPushing = pushingJobIds.has(j.jobId);
                    return (
                      <div
                        key={j.jobId}
                        className="flex items-center justify-between gap-3 p-2.5 rounded bg-[#141920] border border-white/[0.06] text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-white truncate">{j.title}</div>
                          <div className="text-slate-400 truncate flex items-center gap-2">
                            <span className="truncate">{j.artist}</span>
                            {j.webhookStatus === 'pushed' && (
                              <span
                                title={j.webhookMessage || ''}
                                className="text-[#1DB954] shrink-0"
                              >
                                · {j.r2AudioUrl || j.storageProvider === 'r2' ? 'Đã lên R2 & App' : 'Đã đẩy sang App'}
                              </span>
                            )}
                            {j.webhookStatus === 'error' && (
                              <span
                                title={j.webhookMessage || ''}
                                className="text-red-400 truncate"
                              >
                                · {j.webhookMessage || 'Lỗi đẩy'}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span
                            className={`text-[11px] font-mono whitespace-nowrap ${
                              j.plainLyrics || j.syncedLyrics ? 'text-[#1DB954]' : 'text-slate-500'
                            }`}
                          >
                            {j.plainLyrics || j.syncedLyrics ? 'Có Lyrics' : 'Chưa có lyrics'}
                          </span>
                          <button
                            type="button"
                            onClick={() => setSelectedLyricsJob(j)}
                            className="px-2.5 py-1 rounded bg-white/[0.08] hover:bg-white/[0.14] text-white transition-colors cursor-pointer whitespace-nowrap"
                          >
                            Xem Lyrics
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePushFromModal([j], true)}
                            disabled={isPushing || !config.webhookUrl.trim()}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#1DB954]/20 hover:bg-[#1DB954]/30 disabled:opacity-45 text-[#6ee79c] font-medium transition-colors cursor-pointer whitespace-nowrap"
                          >
                            {isPushing ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Send className="h-3 w-3" />
                            )}
                            <span>{j.webhookStatus === 'pushed' || j.webhookStatus === 'error' ? 'Đẩy lại' : 'Đẩy App'}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Lyrics Preview Sub-modal */}
      {selectedLyricsJob && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-black/80"
            onClick={() => setSelectedLyricsJob(null)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-full max-w-lg rounded-xl bg-[#141920] border border-white/[0.15] p-5 space-y-4 shadow-xl text-slate-100">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div>
                <h3 className="font-display text-sm font-semibold text-white">
                  {selectedLyricsJob.title} — {selectedLyricsJob.artist}
                </h3>
                <span className="text-[11px] text-slate-400">Lời bài hát (tự động đồng bộ từ LRCLIB)</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLyricsJob(null)}
                className="p-1.5 rounded text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto font-mono text-xs whitespace-pre-wrap bg-[#090B0E] p-3 rounded border border-white/[0.08] text-slate-300">
              {selectedLyricsJob.syncedLyrics || selectedLyricsJob.plainLyrics || 'Không tìm thấy lời bài hát cho ca khúc này.'}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  const text = selectedLyricsJob.syncedLyrics || selectedLyricsJob.plainLyrics || '';
                  navigator.clipboard.writeText(text);
                  showToast('Đã sao chép lời bài hát vào bộ nhớ tạm.');
                }}
                className="px-3 py-1.5 rounded bg-white/[0.08] hover:bg-white/[0.14] text-xs font-medium text-white transition-colors cursor-pointer"
              >
                Sao chép Lyrics
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
