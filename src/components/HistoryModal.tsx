import { useMemo, useState } from 'react';
import {
  Check,
  Download,
  History,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { UploadHistoryItem } from '../types';
import { normalizeTextClient } from '../utils/trackHistory';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: UploadHistoryItem[];
  onDeleteItem: (id: string) => Promise<void>;
  onClearAll: () => Promise<void>;
  onImportNames: (lines: string[]) => Promise<void>;
  showToast: (msg: string) => void;
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function HistoryModal({
  isOpen,
  onClose,
  items,
  onDeleteItem,
  onClearAll,
  onImportNames,
  showToast,
}: HistoryModalProps) {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterMode, setFilterMode] = useState<'all' | 'pushed' | 'processed'>('all');
  const [showImportBox, setShowImportBox] = useState<boolean>(false);
  const [importText, setImportText] = useState<string>('');
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [confirmClearAll, setConfirmClearAll] = useState<boolean>(false);

  const filteredItems = useMemo(() => {
    const normQ = normalizeTextClient(searchQuery);
    return items.filter((item) => {
      if (filterMode === 'pushed' && !item.pushedToApp) return false;
      if (filterMode === 'processed' && item.pushedToApp) return false;
      if (!normQ) return true;
      const haystack = normalizeTextClient(
        `${item.title} ${item.artist} ${item.fileName} ${item.album || ''}`
      );
      return haystack.includes(normQ);
    });
  }, [items, searchQuery, filterMode]);

  if (!isOpen) return null;

  const pushedCount = items.filter((i) => i.pushedToApp).length;

  const handleImportSubmit = async () => {
    const lines = importText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return;

    setIsImporting(true);
    try {
      await onImportNames(lines);
      setImportText('');
      setShowImportBox(false);
    } finally {
      setIsImporting(false);
    }
  };

  const handleExportTxt = () => {
    if (items.length === 0) return;
    const text = items
      .map((i) => `${i.artist ? `${i.artist} - ` : ''}${i.title}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spotflow_lich_su_upload_${items.length}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Đã xuất danh sách ${items.length} bài hát ra file .TXT.`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-2xl max-h-[88vh] flex flex-col rounded-xl bg-[#111419] border border-white/[0.12] shadow-2xl text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1DB954]/15 text-[#1DB954] shrink-0">
              <History className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-base font-semibold text-white truncate">
                Lịch sử Upload &amp; Bộ lọc trùng ({items.length} bài)
              </h2>
              <p className="text-xs text-slate-400 truncate">
                {pushedCount} bài đã đẩy App · Tự động loại bỏ khi bạn kéo thả cập nhật MP3 mới
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cửa sổ lịch sử"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/[0.08] hover:text-white transition-colors cursor-pointer shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search, Filter & Quick Import */}
        <div className="px-5 py-3.5 border-b border-white/[0.08] space-y-3 shrink-0 bg-[#090B0E]/60">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm tên bài hát, ca sĩ hoặc tên file..."
                className="w-full h-8 rounded bg-[#141920] border border-white/[0.1] pl-8 pr-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#1DB954]"
              />
            </div>

            <div className="inline-flex rounded-md bg-[#141920] border border-white/[0.08] p-0.5 text-xs">
              {(
                [
                  { id: 'all', label: `Tất cả (${items.length})` },
                  { id: 'pushed', label: `Đã đẩy App (${pushedCount})` },
                  { id: 'processed', label: `Đã xử lý (${items.length - pushedCount})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterMode(tab.id)}
                  className={`px-2.5 py-1 rounded transition-colors cursor-pointer whitespace-nowrap ${
                    filterMode === tab.id
                      ? 'bg-[#1DB954] text-[#090B0E] font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowImportBox((v) => !v)}
              className="h-8 px-2.5 rounded border border-white/[0.12] bg-white/[0.05] hover:bg-white/[0.1] text-xs text-slate-200 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5 text-[#1DB954]" />
              <span>Nhập thêm tên</span>
            </button>
          </div>

          {showImportBox && (
            <div className="rounded-lg bg-[#141920] border border-white/[0.1] p-3 space-y-2">
              <div className="text-xs text-slate-300">
                Dán danh sách tên bài hát đã upload trước đây (mỗi dòng 1 bài, dạng{' '}
                <span className="font-mono text-[#6ee79c]">Ca sĩ - Tên bài hát</span> hoặc tên file{' '}
                <span className="font-mono text-[#6ee79c]">.mp3</span>) để lọc trùng sau này:
              </div>
              <textarea
                rows={4}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={'14 Casper & Bon Nghiêm - một đời\nBảo Anh - Thế Nào Là Đúng\nSơn Tùng M-TP - Chúng Ta Của Hiện Tại.mp3'}
                className="w-full rounded bg-[#090B0E] border border-white/[0.1] p-2.5 font-mono text-xs text-slate-200 focus:outline-none focus:border-[#1DB954]"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowImportBox(false)}
                  className="px-3 py-1.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-xs text-slate-300 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={handleImportSubmit}
                  disabled={isImporting || !importText.trim()}
                  className="px-3 py-1.5 rounded bg-[#1DB954] hover:bg-[#1ED760] disabled:opacity-50 text-[#090B0E] text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>Lưu vào lịch sử</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {filteredItems.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              {items.length === 0
                ? 'Chưa có bài hát nào trong lịch sử. Khi bạn xử lý MP3 hoặc đẩy bài hát sang App Nhạc, tên bài hát sẽ tự động được lưu tại đây.'
                : 'Không tìm thấy bài hát nào khớp với từ khóa lọc.'}
            </div>
          ) : (
            filteredItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-[#090B0E] border border-white/[0.07] px-3.5 py-2.5 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-white truncate">
                      {item.title}
                      {item.artist ? ` — ${item.artist}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono truncate">
                    <span className="truncate">{item.fileName}</span>
                    {item.uploadedAt && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="shrink-0">{formatDateTime(item.uploadedAt)}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  <span
                    className={`text-[11px] whitespace-nowrap ${
                      item.pushedToApp ? 'text-[#1DB954]' : 'text-slate-400'
                    }`}
                  >
                    {item.pushedToApp ? 'Đã đẩy App' : 'Đã xử lý MP3'}
                  </span>
                  <button
                    type="button"
                    onClick={() => onDeleteItem(item.id)}
                    title="Xóa khỏi lịch sử (để cho phép nạp lại bài này)"
                    className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-white/[0.06] transition-colors cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] px-5 py-3 shrink-0 bg-[#090B0E]/60">
          <button
            type="button"
            onClick={handleExportTxt}
            disabled={items.length === 0}
            className="px-3 py-1.5 rounded-md border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] disabled:opacity-40 text-xs text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Xuất danh sách (.TXT)</span>
          </button>

          <div className="flex items-center gap-2">
            {items.length > 0 && (
              confirmClearAll ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-red-400">Chắc chắn xóa hết?</span>
                  <button
                    type="button"
                    onClick={async () => {
                      await onClearAll();
                      setConfirmClearAll(false);
                    }}
                    className="px-2.5 py-1.5 rounded bg-red-500 hover:bg-red-400 text-white text-xs font-semibold cursor-pointer"
                  >
                    Xác nhận
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearAll(false)}
                    className="px-2.5 py-1.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-xs text-slate-300 cursor-pointer"
                  >
                    Hủy
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(true)}
                  className="px-3 py-1.5 rounded-md border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-xs text-red-300 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Xóa toàn bộ lịch sử</span>
                </button>
              )
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-md bg-white text-[#090B0E] hover:bg-slate-200 text-xs font-semibold cursor-pointer"
            >
              Đóng
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
