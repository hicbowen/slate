import type { MonochromeMode } from '@/lib/eink/image-preview';
import { DITHER_MODES } from '@/lib/eink/dither';
import { cn } from '@/lib/cn';

interface DitherControlsProps {
  mode: MonochromeMode;
  onModeChange: (m: MonochromeMode) => void;
  threshold: number;
  onThresholdChange: (n: number) => void;
  disabled?: boolean;
}

export function DitherControls({
  mode,
  onModeChange,
  threshold,
  onThresholdChange,
  disabled = false,
}: DitherControlsProps) {
  const modes = [
    { id: 'preset', label: '跟随优化风格', hint: '自动选择抖动' } as const,
    ...DITHER_MODES,
  ];
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-baseline justify-between mb-2 ml-0.5">
          <p className="font-sans text-[13px] text-stone">黑白抖动</p>
          <p className="font-mono text-[11px] text-stone-light">
            {modes.find((info) => info.id === mode)?.hint}
          </p>
        </div>
        <div className="grid grid-cols-2">
          {modes.map(({ id: m, label }) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              disabled={disabled}
              onClick={() => onModeChange(m)}
              className={cn(
                'flex items-center justify-between px-3 py-2.5 font-serif text-[13px] border border-ink -ml-px -mt-px transition-colors',
                mode === m ? 'bg-cream-deep text-ink' : 'text-stone hover:bg-cream',
                disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent'
              )}
            >
              <span>{label}</span>
              {mode === m && <span className="font-mono text-[10px]">●</span>}
            </button>
          ))}
        </div>
        <p className="font-serif text-[11px] text-stone-light mt-1.5">
          线稿用「线稿 · 纯黑白」;照片用「照片 · 推荐」。
        </p>
      </div>

      {mode === 'threshold' && (
        <div>
          <div className="flex items-baseline justify-between mb-2 ml-0.5">
            <p className="font-sans text-[13px] text-stone">阈值</p>
            <p className="font-mono text-[12px] text-ink tabular-nums">
              {threshold}
              <span className="text-stone-light">/255</span>
            </p>
          </div>
          <input
            type="range"
            min="0"
            max="255"
            value={threshold}
            disabled={disabled}
            onChange={(e) => onThresholdChange(Number(e.target.value))}
          />
          <p className="font-serif italic text-[11px] text-stone-light mt-1.5">
            {disabled ? '换图后可调整抖动参数。' : '简笔画 128;带细灰边的图试 180+。'}
          </p>
        </div>
      )}
    </div>
  );
}
