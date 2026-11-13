import { Disc3, FileAudio, SlidersHorizontal, Webhook, X } from 'lucide-react';
import type { AudioBitrate } from '../types';

interface SidebarProps {
  bitrate: AudioBitrate;
  onChangeBitrate: (bitrate: AudioBitrate) => void;
  embedTags: boolean;
  onToggleEmbedTags: () => void;
  autoProcessOnUpload: boolean;
  onToggleAutoProcessOnUpload: () => void;
  autoDownloadEach: boolean;
  onToggleAutoDownloadEach: () => void;
  totalEntries: number;
  doneCount: number;
  totalSizeMb: string;
  onOpenIntegrationModal: () => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  bitrate,
  onChangeBitrate,
  embedTags,
  onToggleEmbedTags,
  autoProcessOnUpload,
  onToggleAutoProcessOnUpload,
  autoDownloadEach,
  onToggleAutoDownloadEach,
  totalEntries,
  doneCount,
  totalSizeMb,
  onOpenIntegrationModal,
  isOpenMobile,
  onCloseMobile,
}: SidebarProps) {
  const sidebarBody = (
    <div className="flex h-full flex-col bg-[#111419] border-r border-white/[0.08] text-slate-200">
      {/* Brand Zone */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#1DB954] text-[#090B0E]">
            <Disc3 className="h-4 w-4 stroke-[2.2]" />
          </div>
          <span className="font-display text-base font-semibold tracking-tight text-white whitespace-nowrap">
            SpotFlow MP3
          </span>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Đóng thanh bên"
          className="lg:hidden rounded-md p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-white transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Processing Settings */}
      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-6">
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-medium text-[#1DB954]">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Cấu hình xử lý file MP3</span>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs text-slate-400">
              Bitrate khi chuyển từ định dạng khác
            </label>
            <div className="grid grid-cols-3 gap-1 p-1 rounded-md bg-[#090B0E] border border-white/[0.08]">
              {([320, 256, 192] as AudioBitrate[]).map((rate) => {
                const active = bitrate === rate;
                return (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => onChangeBitrate(rate)}
                    className={`py-1.5 px-2 rounded text-xs font-mono tabular-nums transition-colors cursor-pointer whitespace-nowrap ${
                      active
                        ? 'bg-[#1DB954] text-[#090B0E] font-semibold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {rate}k
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-500">
              File .mp3 sẵn có được giữ nguyên stream âm thanh gốc (stream-copy), chỉ ghi thêm thẻ ID3 siêu nhanh.
            </p>
          </div>

          {/* Embed Tags Toggle */}
          <div className="flex items-start justify-between gap-3 pt-2 border-t border-white/[0.06]">
            <div>
              <div className="text-xs font-medium text-slate-200">
                Nhúng ID3, Ảnh bìa &amp; Lyrics
              </div>
              <div className="text-xs text-slate-500">
                Gắn tên bài, ca sĩ, album, cover và lời vào file MP3
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={embedTags}
              onClick={onToggleEmbedTags}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] ${
                embedTags ? 'bg-[#1DB954]' : 'bg-slate-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  embedTags ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Auto Process on Upload Toggle */}
          <div className="flex items-start justify-between gap-3 pt-2">
            <div>
              <div className="text-xs font-medium text-slate-200">
                Tự xử lý ngay khi nạp file
              </div>
              <div className="text-xs text-slate-500">
                Tự tìm ảnh, lyrics và gắn tag ngay sau khi kéo thả file
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoProcessOnUpload}
              onClick={onToggleAutoProcessOnUpload}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] ${
                autoProcessOnUpload ? 'bg-[#1DB954]' : 'bg-slate-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  autoProcessOnUpload ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Auto Download Each Toggle */}
          <div className="flex items-start justify-between gap-3 pt-2">
            <div>
              <div className="text-xs font-medium text-slate-200">
                Tự động lưu MP3 về máy
              </div>
              <div className="text-xs text-slate-500">
                Tải file xuống trình duyệt ngay sau khi gắn xong tag
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoDownloadEach}
              onClick={onToggleAutoDownloadEach}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954] ${
                autoDownloadEach ? 'bg-[#1DB954]' : 'bg-slate-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  autoDownloadEach ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Session Summary */}
        <div className="border-t border-white/[0.07] pt-5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
            <FileAudio className="h-3.5 w-3.5" />
            <span>Thống kê phiên xử lý</span>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between text-slate-400">
              <span>File đã nạp</span>
              <span className="font-mono tabular-nums text-white">{totalEntries}</span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>Đã gắn ảnh &amp; lyrics</span>
              <span className="font-mono tabular-nums text-[#1DB954]">{doneCount}</span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>Tổng dung lượng</span>
              <span className="font-mono tabular-nums text-slate-200">{totalSizeMb} MB</span>
            </div>
          </div>
        </div>

        {/* R2 Integration Shortcut */}
        <div className="border-t border-white/[0.07] pt-5 space-y-2.5">
          <div className="text-xs font-medium text-slate-300">Đồng bộ App Nhạc &amp; R2</div>
          <p className="text-xs text-slate-500">
            App nhạc của bạn có thể gọi API trực tiếp để lấy ảnh bìa + lyrics trước khi lưu lên Cloudflare R2.
          </p>
          <button
            type="button"
            onClick={() => {
              onOpenIntegrationModal();
              onCloseMobile();
            }}
            className="w-full py-2 px-3 rounded-md border border-[#1DB954]/35 bg-[#1DB954]/10 hover:bg-[#1DB954]/20 text-xs font-medium text-[#1DB954] transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Webhook className="h-3.5 w-3.5" />
            <span>API &amp; Lệnh lưu R2</span>
          </button>
        </div>
      </div>

      {/* Quiet Footer Info */}
      <div className="px-5 py-3.5 border-t border-white/[0.07] text-xs text-slate-500 flex items-center gap-2">
        <Disc3 className="h-3.5 w-3.5 shrink-0 text-[#1DB954]" />
        <span className="truncate">Studio gắn Ảnh Bìa &amp; Lyrics MP3</span>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-[236px] shrink-0 h-screen sticky top-0">
        {sidebarBody}
      </aside>

      {isOpenMobile && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-[280px] max-w-[85vw] h-full">
            {sidebarBody}
          </aside>
        </div>
      )}
    </>
  );
}
