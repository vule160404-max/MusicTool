import { useState } from 'react';
import { Link2, Loader2, Search, Sparkles, X } from 'lucide-react';

interface BatchExtractorBarProps {
  onExtractUrls: (rawInput: string) => Promise<void>;
  isLoading: boolean;
  filterQuery: string;
  onFilterChange: (q: string) => void;
  totalTracks: number;
  selectedCount: number;
  onSelectAll: () => void;
  onSelectTopN: (n: number) => void;
  onClearSelection: () => void;
  skipAlreadyDownloaded: boolean;
  onToggleSkipAlreadyDownloaded: () => void;
}

export function BatchExtractorBar({
  onExtractUrls,
  isLoading,
  filterQuery,
  onFilterChange,
  totalTracks,
  selectedCount,
  onSelectAll,
  onSelectTopN,
  onClearSelection,
  skipAlreadyDownloaded,
  onToggleSkipAlreadyDownloaded,
}: BatchExtractorBarProps) {
  const [urlInput, setUrlInput] = useState('');
  const [isMultiLine, setIsMultiLine] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim() || isLoading) return;
    await onExtractUrls(urlInput);
  };

  const handlePasteSample = () => {
    setIsMultiLine(true);
    setUrlInput(
      [
        'https://open.spotify.com/playlist/37i9dQZEVXbLdGSmz6xilI',
        'https://open.spotify.com/track/3vazRRgWcQXqWVmD0PJejS',
      ].join('\n')
    );
  };

  return (
    <section className="border-b border-white/[0.08] bg-[#111419]/60 px-4 sm:px-6 py-4 space-y-3">
      {/* URL / Batch Link Extraction Form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-4">
          <label
            htmlFor="spotify-url-input"
            className="text-xs font-medium text-slate-300 flex items-center gap-1.5"
          >
            <Link2 className="h-3.5 w-3.5 text-[#1DB954]" />
            <span>Nhập link Spotify (Playlist, Album, Artist hoặc dán hàng loạt link bài hát)</span>
          </label>
          <div className="flex items-center gap-3 text-xs">
            <button
              type="button"
              onClick={() => setIsMultiLine((v) => !v)}
              className="text-slate-400 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              {isMultiLine ? 'Thu gọn 1 dòng' : 'Chế độ dán nhiều link'}
            </button>
            <button
              type="button"
              onClick={handlePasteSample}
              className="text-[#1DB954] hover:text-[#1ED760] transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1"
            >
              <Sparkles className="h-3 w-3" />
              <span>Link mẫu</span>
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5 items-stretch">
          <div className="relative flex-1">
            {isMultiLine ? (
              <textarea
                id="spotify-url-input"
                rows={3}
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Dán nhiều link Spotify tại đây (mỗi dòng 1 link playlist, album hoặc track)..."
                className="w-full rounded-md bg-[#090B0E] border border-white/[0.1] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#1DB954] font-mono resize-y"
              />
            ) : (
              <input
                id="spotify-url-input"
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://open.spotify.com/playlist/... hoặc dán nhiều link cách nhau bởi dấu phẩy"
                className="w-full h-10 rounded-md bg-[#090B0E] border border-white/[0.1] px-3.5 pr-9 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#1DB954]"
              />
            )}
            {urlInput && !isMultiLine && (
              <button
                type="button"
                onClick={() => setUrlInput('')}
                aria-label="Xóa ô nhập link"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white p-1"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading || !urlInput.trim()}
            className="h-10 px-5 rounded-md bg-white/[0.08] hover:bg-white/[0.14] disabled:opacity-45 disabled:pointer-events-none text-sm font-medium text-white border border-white/[0.1] transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-[#1DB954]" />
                <span>Đang lấy link...</span>
              </>
            ) : (
              <span>Lấy danh sách</span>
            )}
          </button>
        </div>
      </form>

      {/* Filter + Batch Selection Toolbar + Duplicate Prevention Toggle */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-1">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-64">
            <Search className="h-4 w-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => onFilterChange(e.target.value)}
              placeholder="Lọc nhanh tên bài hát, ca sĩ..."
              className="w-full h-9 rounded-md bg-[#090B0E] border border-white/[0.08] pl-9 pr-8 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-white/25"
            />
            {filterQuery && (
              <button
                type="button"
                onClick={() => onFilterChange('')}
                aria-label="Xóa bộ lọc"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white p-1"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={skipAlreadyDownloaded}
              onChange={onToggleSkipAlreadyDownloaded}
              className="h-4 w-4 rounded border-slate-600 bg-[#090B0E] accent-[#1DB954] cursor-pointer"
            />
            <span>Bỏ qua bài đã tải trước đó (Tránh trùng lặp)</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400 font-mono tabular-nums mr-1">
            Đã chọn {selectedCount}/{totalTracks} bài
          </span>
          <button
            type="button"
            onClick={onSelectAll}
            disabled={totalTracks === 0}
            className="px-2.5 py-1.5 rounded bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap"
          >
            Chọn tất cả
          </button>
          <button
            type="button"
            onClick={() => onSelectTopN(10)}
            disabled={totalTracks === 0}
            className="px-2.5 py-1.5 rounded bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap"
          >
            Top 10
          </button>
          <button
            type="button"
            onClick={() => onSelectTopN(20)}
            disabled={totalTracks === 0}
            className="px-2.5 py-1.5 rounded bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap"
          >
            Top 20
          </button>
          <button
            type="button"
            onClick={onClearSelection}
            disabled={selectedCount === 0}
            className="px-2.5 py-1.5 rounded bg-white/[0.05] hover:bg-white/[0.1] text-slate-400 hover:text-white disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap"
          >
            Bỏ chọn
          </button>
        </div>
      </div>
    </section>
  );
}
