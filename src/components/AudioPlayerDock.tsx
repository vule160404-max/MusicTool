import { Pause, Play, Volume2, X } from 'lucide-react';

interface AudioPlayerDockProps {
  title: string;
  artist: string;
  sourceLabel: string;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onTogglePlayPause: () => void;
  onSeek: (time: number) => void;
  onClose: () => void;
}

function formatSec(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function AudioPlayerDock({
  title,
  artist,
  sourceLabel,
  isPlaying,
  currentTime,
  duration,
  onTogglePlayPause,
  onSeek,
  onClose,
}: AudioPlayerDockProps) {
  const safeDuration = duration > 0 ? duration : 1;
  const pct = Math.min(100, Math.max(0, (currentTime / safeDuration) * 100));

  return (
    <div className="sticky bottom-0 z-30 border-t border-white/[0.1] bg-[#111419]/95 backdrop-blur-md px-4 sm:px-6 py-2.5">
      <div className="flex items-center justify-between gap-4 max-w-full">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={onTogglePlayPause}
            aria-label={isPlaying ? 'Tạm dừng' : 'Phát tiếp'}
            className="h-9 w-9 rounded-full bg-[#1DB954] hover:bg-[#1ED760] text-[#090B0E] flex items-center justify-center shrink-0 transition-colors cursor-pointer"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4 fill-current" />
            ) : (
              <Play className="h-4 w-4 fill-current ml-0.5" />
            )}
          </button>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white truncate">{title}</span>
              <span className="text-xs text-slate-400 shrink-0 hidden sm:inline">
                · {sourceLabel}
              </span>
            </div>
            <div className="text-xs text-slate-400 truncate">{artist || 'Chưa rõ ca sĩ'}</div>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-3 flex-1 max-w-md">
          <span className="font-mono text-xs text-slate-400 tabular-nums w-10 text-right">
            {formatSec(currentTime)}
          </span>
          <input
            type="range"
            min={0}
            max={safeDuration}
            step={0.5}
            value={currentTime}
            onChange={(e) => onSeek(Number(e.target.value))}
            aria-label="Tua tiến trình phát nhạc"
            className="w-full h-1.5 accent-[#1DB954] cursor-pointer"
            style={{
              background: `linear-gradient(to right, #1DB954 ${pct}%, rgba(255,255,255,0.12) ${pct}%)`,
            }}
          />
          <span className="font-mono text-xs text-slate-400 tabular-nums w-10">
            {formatSec(duration)}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Volume2 className="h-4 w-4 text-slate-400 hidden sm:block" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng trình phát"
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
