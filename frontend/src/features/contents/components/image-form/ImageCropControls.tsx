import type { CropOptions } from '@/lib/eink/image-preview';
import { Button } from '@/components/ui/Button';

type Fit = NonNullable<CropOptions['fit']>;

export function ImageCropControls({
  fit,
  onFitChange,
  scale,
  onScaleChange,
  onReset,
  resetLabel = '重置位置和缩放',
  disabled,
}: {
  fit: Fit;
  onFitChange: (value: Fit) => void;
  scale: number;
  onScaleChange: (value: number) => void;
  onReset: () => void;
  resetLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="构图方式">
        {(['contain', 'cover'] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={fit === value ? 'primary' : 'soft'}
            aria-pressed={fit === value}
            disabled={disabled}
            onClick={() => onFitChange(value)}
          >
            {value === 'contain' ? '完整显示' : '填满画面'}
          </Button>
        ))}
        <Button size="sm" variant="link" disabled={disabled} onClick={onReset}>
          {resetLabel}
        </Button>
      </div>
      <label className="flex items-center gap-2 text-[12px] text-stone">
        缩放
        <input
          type="range"
          min={fit === 'cover' ? 1 : 0.5}
          max="4"
          step="0.05"
          value={scale}
          className="min-w-0 flex-1"
          disabled={disabled}
          onChange={(event) => onScaleChange(Number(event.target.value))}
        />
        <span className="font-mono tabular-nums">{scale.toFixed(2)}×</span>
      </label>
      <p className="text-[11px] text-stone">拖动画面调整位置。</p>
    </div>
  );
}
