import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
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
}

export function IntegrationModal({
  isOpen,
  onClose,
  completedJobs,
  showToast,
}: IntegrationModalProps) {
  const [config, setConfig] = useState<IntegrationConfig>({
    apiKey: '',
    webhookUrl: '',
    autoPushWebhook: false,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);
  const [copiedEndpoint, setCopiedEndpoint] = useState<boolean>(false);
  const [selectedLyricsJob, setSelectedLyricsJob] = useState<DownloadJob | null>(null);

  const base = getBackendBaseUrl();
  const apiEndpointUrl = `${base || window.location.origin}/api/external/tracks`;

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const res = await apiFetch('/api/integration/settings');
        if (!res.ok) return;
        const data = (await res.json()) as IntegrationConfig;
        if (!cancelled) setConfig(data);
      } catch {
        // Ignore
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const handleSaveSettings = async (regenerate = false) => {
    setIsSaving(true);
    try {
      const res = await apiFetch('/api/integration/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookUrl: config.webhookUrl,
          autoPushWebhook: config.autoPushWebhook,
          regenerateKey: regenerate,
        }),
      });
      if (!res.ok) throw new Error('Không thể lưu cài đặt.');
      const data = (await res.json()) as IntegrationConfig;
      setConfig(data);
      showToast(regenerate ? 'Đã tạo mới API Key thành công!' : 'Đã lưu cấu hình liên kết app nhạc.');
    } catch {
      showToast('Lỗi khi lưu cấu hình.');
    } finally {
      setIsSaving(false);
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

  const copyToClipboard = async (text: string, type: 'key' | 'endpoint') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'key') {
        setCopiedKey(true);
        setTimeout(() => setCopiedKey(false), 1500);
      } else {
        setCopiedEndpoint(true);
        setTimeout(() => setCopiedEndpoint(false), 1500);
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
          <div className="space-y-6">
            {/* Step 1: API Endpoint & Key */}
            <div className="space-y-3 rounded-lg bg-[#090B0E] p-4 border border-white/[0.08]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#1DB954] flex items-center gap-1.5">
                  <Key className="h-3.5 w-3.5" />
                  <span>1. API Endpoint &amp; Khóa Bảo Mật (API Key)</span>
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

              <div className="space-y-2">
                <label className="block text-xs text-slate-400">REST API Endpoint cho app nhạc của bạn</label>
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
                    <span>{copiedEndpoint ? 'Đã chép' : 'Sao chép'}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs text-slate-400">API Key bảo mật (truyền qua Header <code className="text-[#1DB954]">X-API-Key</code>)</label>
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
            </div>

            {/* Step 2: Webhook URL & Auto Push */}
            <div className="space-y-3 rounded-lg bg-[#090B0E] p-4 border border-white/[0.08]">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#1DB954] flex items-center gap-1.5">
                <Send className="h-3.5 w-3.5" />
                <span>2. Webhook Tự Động Đẩy Bài Hát Sang App Nhạc</span>
              </span>
              <p className="text-xs text-slate-400">
                Mỗi khi SpotFlow tải xong bài hát kèm ảnh bìa và lyrics, hệ thống sẽ tự động gọi HTTP POST tới URL của bạn.
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
                    className="h-9 px-3 rounded bg-white/[0.08] hover:bg-white/[0.14] disabled:opacity-40 text-xs font-medium text-white transition-colors shrink-0 cursor-pointer inline-flex items-center gap-1.5"
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
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-1">
                <div>
                  <div className="text-xs font-medium text-slate-200">Tự động đẩy khi tải xong</div>
                  <div className="text-xs text-slate-500">Tự động gọi webhook ngay khi hoàn tất convert MP3</div>
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

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => handleSaveSettings(false)}
                  disabled={isSaving}
                  className="px-4 py-2 rounded-md bg-[#1DB954] hover:bg-[#1ED760] text-[#090B0E] text-xs font-semibold transition-colors cursor-pointer inline-flex items-center gap-1.5"
                >
                  {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>Lưu cài đặt liên kết</span>
                </button>
              </div>
            </div>

            {/* Step 3: Lyrics & Downloaded Tracks Inspector */}
            <div className="space-y-3 rounded-lg bg-[#090B0E] p-4 border border-white/[0.08]">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#1DB954] flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                <span>3. Bài hát đã tải &amp; Lời bài hát (Lyrics) đã nhúng</span>
              </span>

              {completedJobs.length === 0 ? (
                <p className="text-xs text-slate-400 py-2">
                  Chưa có bài hát nào được tải xong trong phiên này. Hãy tải xuống một vài bài hát để kiểm tra lyrics và dữ liệu API.
                </p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {completedJobs.map((j) => (
                    <div
                      key={j.jobId}
                      className="flex items-center justify-between p-2.5 rounded bg-[#141920] border border-white/[0.06] text-xs"
                    >
                      <div className="min-w-0 pr-3">
                        <div className="font-medium text-white truncate">{j.title}</div>
                        <div className="text-slate-400 truncate">{j.artist}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {j.plainLyrics || j.syncedLyrics ? (
                          <span className="px-2 py-0.5 rounded bg-[#1DB954]/15 text-[#1DB954] text-[10px] font-mono">
                            Có Lyrics
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-white/[0.05] text-slate-500 text-[10px] font-mono">
                            Không có lyrics
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedLyricsJob(j)}
                          className="px-2.5 py-1 rounded bg-white/[0.08] hover:bg-white/[0.14] text-white transition-colors cursor-pointer"
                        >
                          Xem Lyrics
                        </button>
                      </div>
                    </div>
                  ))}
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
