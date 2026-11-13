import { Disc3, Flame, Globe2, SlidersHorizontal, X } from 'lucide-react';
import type { AudioBitrate, PresetChart } from '../types';

interface SidebarProps {
  presets: PresetChart[];
  activePresetId: string | null;
  onSelectPreset: (preset: PresetChart) => void;
  bitrate: AudioBitrate;
  onChangeBitrate: (bitrate: AudioBitrate) => void;
  embedTags: boolean;
  onToggleEmbedTags: () => void;
  autoDownloadEach: boolean;
  onToggleAutoDownloadEach: () => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  presets,
  activePresetId,
  onSelectPreset,
  bitrate,
  onChangeBitrate,
  embedTags,
  onToggleEmbedTags,
  autoDownloadEach,
  onToggleAutoDownloadEach,
  isOpenMobile,
  onCloseMobile,
}: SidebarProps) {
  const vpopPresets = presets.filter((p) => p.region === 'Việt Nam');
  const globalPresets = presets.filter((p) => p.region !== 'Việt Nam');

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

      {/* Hot Charts Section */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {/* V-Pop & Vietnam Section */}
        <div>
          <div className="flex items-center gap-2 px-2.5 pb-2 text-xs font-medium text-[#1DB954]">
            <Flame className="h-3.5 w-3.5" />
            <span>🇻🇳 Danh Sách V-Pop &amp; Việt Nam</span>
          </div>
          <nav className="space-y-0.5" aria-label="Danh sách V-Pop">
            {vpopPresets.map((preset) => {
              const isActive = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    onSelectPreset(preset);
                    onCloseMobile();
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-2.5 rounded-md text-left text-sm transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#1DB954]/15 text-white font-medium border-l-2 border-[#1DB954]'
                      : 'text-slate-300 hover:bg-white/[0.04] hover:text-white'
                  }`}
                >
                  <span className="truncate">{preset.label}</span>
                  <span
                    className={`text-[10px] uppercase font-mono tracking-wider shrink-0 px-1.5 py-0.5 rounded ${
                      isActive ? 'bg-[#1DB954] text-[#090B0E] font-bold' : 'text-slate-400 bg-white/[0.06]'
                    }`}
                  >
                    V-Pop
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Global & International Section */}
        <div>
          <div className="flex items-center gap-2 px-2.5 pb-2 text-xs font-medium text-slate-400">
            <Globe2 className="h-3.5 w-3.5 text-sky-400" />
            <span>🌍 Bảng Xếp Hạng Quốc Tế</span>
          </div>
          <nav className="space-y-0.5" aria-label="Bảng xếp hạng quốc tế">
            {globalPresets.map((preset) => {
              const isActive = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    onSelectPreset(preset);
                    onCloseMobile();
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-2.5 rounded-md text-left text-sm transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-sky-500/15 text-white font-medium border-l-2 border-sky-400'
                      : 'text-slate-300 hover:bg-white/[0.04] hover:text-white'
                  }`}
                >
                  <span className="truncate">{preset.label}</span>
                  <span
                    className={`text-xs shrink-0 ${
                      isActive ? 'text-sky-400' : 'text-slate-500'
                    }`}
                  >
                    {preset.region}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="border-t border-white/[0.07] pt-5 px-2.5 space-y-4">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Chất lượng &amp; Tự động tải</span>
          </div>

          {/* Bitrate Selector */}
          <div className="space-y-1.5">
            <label className="block text-xs text-slate-400">
              Độ nén MP3 đầu ra
            </label>
            <div className="grid grid-cols-3 gap-1 p-1 rounded-md bg-[#090B0E] border border-white/[0.07]">
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
              {bitrate === 320
                ? 'Chuẩn studio 320 kbps CBR cao nhất'
                : bitrate === 256
                ? 'Cân bằng dung lượng & chất lượng'
                : 'Tệp nhẹ, tải nhanh trên di động'}
            </p>
          </div>

          {/* Embed ID3 Tags Toggle */}
          <div className="flex items-start justify-between gap-3 pt-1">
            <div>
              <div className="text-xs font-medium text-slate-200">
                Gắn thẻ ID3, Ảnh bìa &amp; Lyrics
              </div>
              <div className="text-xs text-slate-500">
                Nhúng tên ca sĩ, album, cover và lời bài hát
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

          {/* Auto Download Each Toggle */}
          <div className="flex items-start justify-between gap-3 pt-1">
            <div>
              <div className="text-xs font-medium text-slate-200">
                Tự động lưu MP3 về máy
              </div>
              <div className="text-xs text-slate-500">
                Tải file xuống trình duyệt ngay khi xong từng bài
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
      </div>

      {/* Quiet Footer Info */}
      <div className="px-5 py-3.5 border-t border-white/[0.07] text-xs text-slate-500 flex items-center gap-2">
        <Disc3 className="h-3.5 w-3.5 shrink-0 text-[#1DB954]" />
        <span className="truncate">Kho nhạc V-Pop &amp; Spotify toàn tập</span>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-[264px] shrink-0 h-screen sticky top-0">
        {sidebarBody}
      </aside>

      {/* Mobile Drawer */}
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
