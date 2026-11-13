import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  Loader2,
  Radio,
  Server,
  X,
} from 'lucide-react';
import { checkBackendStatus, getBackendBaseUrl, setBackendBaseUrl } from '../utils/api';

interface BackendConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectionSuccess: () => void;
  showToast: (msg: string) => void;
}

export function BackendConnectionModal({
  isOpen,
  onClose,
  onConnectionSuccess,
  showToast,
}: BackendConnectionModalProps) {
  const [urlInput, setUrlInput] = useState<string>(() => getBackendBaseUrl());
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    ffmpeg?: boolean;
    message?: string;
  } | null>(null);

  if (!isOpen) return null;

  const handleTestAndSave = async () => {
    setIsTesting(true);
    setTestResult(null);

    // Temporarily save to test
    const cleanUrl = urlInput.trim();
    setBackendBaseUrl(cleanUrl);

    const status = await checkBackendStatus();
    setIsTesting(false);

    if (status.ok) {
      setTestResult({
        ok: true,
        ffmpeg: status.ffmpeg,
        message: status.ffmpeg
          ? 'Kết nối máy chủ thành công! Đã phát hiện FFmpeg chuẩn 320kbps.'
          : 'Kết nối máy chủ thành công (Chưa có FFmpeg).',
      });
      showToast('Đã lưu và kết nối thành công tới Backend!');
      onConnectionSuccess();
    } else {
      setTestResult({
        ok: false,
        message: status.error || 'Không thể kết nối tới Backend URL này.',
      });
    }
  };

  const handleResetToDefault = () => {
    setUrlInput('');
    setBackendBaseUrl(null);
    setTestResult(null);
    showToast('Đã đặt lại về URL mặc định (Cùng tên miền).');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-xl bg-[#111419] border border-white/[0.12] shadow-2xl text-slate-100 p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold text-white">
                Cấu Hình Kết Nối Máy Chủ (Backend Node.js &amp; FFmpeg)
              </h2>
              <p className="text-xs text-slate-400">
                Xử lý lỗi &ldquo;Không thể kết nối máy chủ&rdquo; khi triển khai trên Vercel
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="rounded-lg p-2 text-slate-400 hover:bg-white/[0.08] hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Root Cause Explanation */}
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/25 p-4 space-y-2 text-xs text-amber-200">
          <div className="flex items-center gap-2 font-semibold text-amber-400 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Tại sao Vercel lại báo &ldquo;Không thể kết nối máy chủ&rdquo;?</span>
          </div>
          <p className="leading-relaxed text-slate-300">
            <strong>Vercel là dịch vụ lưu trữ Frontend tĩnh (Static Web)</strong>. Khi bạn deploy lên Vercel,
            Vercel chỉ build giao diện HTML/CSS/JS mà <strong>không hề chạy file server.ts</strong>, đồng thời Vercel
            <strong>không có FFmpeg</strong> và không cho phép chạy các tác vụ giải mã audio MP3 320kbps tốn thời gian.
          </p>
        </div>

        {/* Solution 1: Enter remote Backend URL */}
        <div className="space-y-3 rounded-lg bg-[#090B0E] p-4 border border-white/[0.08]">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#1DB954] flex items-center gap-1.5">
            <Radio className="h-3.5 w-3.5" />
            <span>Cách 1: Nhập địa chỉ Backend của bạn (Nếu giữ Frontend ở Vercel)</span>
          </span>
          <p className="text-xs text-slate-400">
            Nếu bạn muốn giữ giao diện web ở Vercel, hãy deploy phần backend lên một host miễn phí (như Render, Railway,
            hoặc Cloud Run) rồi dán URL vào ô dưới đây:
          </p>

          <div className="space-y-2">
            <label htmlFor="backend-url-input" className="block text-xs text-slate-300">
              Backend API Base URL
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="backend-url-input"
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Ví dụ: https://spotflow-backend.onrender.com hoặc https://..."
                className="flex-1 h-9 rounded bg-[#141920] border border-white/[0.1] px-3 font-mono text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-[#1DB954]"
              />
              <button
                type="button"
                onClick={handleTestAndSave}
                disabled={isTesting}
                className="h-9 px-4 rounded bg-[#1DB954] hover:bg-[#1ED760] disabled:opacity-40 text-xs font-semibold text-[#090B0E] transition-colors shrink-0 cursor-pointer inline-flex items-center justify-center gap-1.5"
              >
                {isTesting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Đang kiểm tra...</span>
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>Kiểm tra &amp; Lưu</span>
                  </>
                )}
              </button>
            </div>

            {testResult && (
              <div
                className={`text-xs p-3 rounded border flex items-center gap-2 ${
                  testResult.ok
                    ? 'bg-[#1DB954]/10 border-[#1DB954]/30 text-[#6ee79c]'
                    : 'bg-red-500/10 border-red-500/30 text-red-400'
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}

            <div className="flex justify-between items-center pt-1 text-xs">
              <span className="text-slate-500">Mặc định: Để trống sẽ gọi trực tiếp cùng tên miền.</span>
              {urlInput && (
                <button
                  type="button"
                  onClick={handleResetToDefault}
                  className="text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  Đặt lại mặc định
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Solution 2: Deploy Full-stack on Render / Railway */}
        <div className="space-y-3 rounded-lg bg-[#090B0E] p-4 border border-white/[0.08]">
          <span className="text-xs font-semibold uppercase tracking-wider text-sky-400 flex items-center gap-1.5">
            <HelpCircle className="h-3.5 w-3.5" />
            <span>Cách 2: Triển khai Full-Stack miễn phí trên Render.com (Khuyên dùng nhất)</span>
          </span>
          <p className="text-xs text-slate-300 leading-relaxed">
            Thay vì Vercel, hãy deploy cả app lên <strong>Render.com</strong> (hoàn toàn miễn phí, có sẵn Node.js và
            chạy mượt FFmpeg):
          </p>

          <ol className="list-decimal list-inside space-y-2 text-xs text-slate-400 pl-1">
            <li>
              Đăng nhập <strong className="text-white">Render.com</strong> bằng tài khoản GitHub của bạn.
            </li>
            <li>
              Bấm <strong className="text-white">New +</strong> &rarr; Chọn{' '}
              <strong className="text-white">Web Service</strong> &rarr; Chọn repository GitHub này.
            </li>
            <li>
              Cấu hình các trường:
              <div className="my-1.5 p-2.5 rounded bg-[#141920] border border-white/[0.06] font-mono text-[11px] text-slate-300 space-y-1">
                <div>Environment: <span className="text-sky-300">Node</span></div>
                <div>Build Command: <span className="text-emerald-400">npm install &amp;&amp; npm run build</span></div>
                <div>Start Command: <span className="text-emerald-400">npm start</span></div>
              </div>
            </li>
            <li>
              Bấm <strong className="text-white">Deploy Web Service</strong>. Sau 2 phút, bạn sẽ có một trang web hoàn chỉnh
              tự động tải được cả MP3 320kbps!
            </li>
          </ol>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-md bg-white/[0.08] hover:bg-white/[0.14] text-xs font-medium text-white transition-colors cursor-pointer"
          >
            Đóng cửa sổ
          </button>
        </div>
      </div>
    </div>
  );
}
