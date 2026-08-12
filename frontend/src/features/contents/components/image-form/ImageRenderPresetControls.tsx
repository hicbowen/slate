import { IMAGE_RENDER_PRESETS, IMAGE_RENDER_PRESET_INFO, type ImageRenderPreset } from 'shared';
import { cn } from '@/lib/cn';

interface ImageRenderPresetControlsProps {
  preset: ImageRenderPreset;
  onPresetChange: (preset: ImageRenderPreset) => void;
  disabled?: boolean;
  hasImage: boolean;
  scale: number;
  onScaleChange: (scale: number) => void;
  onResetCrop: () => void;
}

export function ImageRenderPresetControls({
  preset,
  onPresetChange,
  disabled = false,
  hasImage,
  scale,
  onScaleChange,
  onResetCrop,
}: ImageRenderPresetControlsProps) {
  return (
    <div className="space-y-5">
      {hasImage && (
        <div>
          <div className="flex items-baseline justify-between mb-2 ml-0.5">
            <p className="font-sans text-[13px] text-stone">缩放</p>
            <div className="flex items-center gap-2">
              <p className="font-mono text-[12px] text-ink tabular-nums">{scale.toFixed(1)}×</p>
              <button
                type="button"
                onClick={onResetCrop}
                className="font-sans text-[11px] text-stone border-b border-stone hover:border-ink hover:text-ink transition-colors"
              >
                重置
              </button>
            </div>
          </div>
          <input
            type="range"
            min="0.5"
            max="3"
            step="0.1"
            value={scale}
            onChange={(event) => onScaleChange(Number(event.target.value))}
          />
          <p className="font-serif italic text-[11px] text-stone-light mt-1.5">
            预览图可拖拽定位，滑块控制缩放。
          </p>
        </div>
      )}

      <div>
        <div className="flex items-baseline justify-between mb-2 ml-0.5">
          <p className="font-sans text-[13px] text-stone">图片优化</p>
          <p className="font-mono text-[11px] text-stone-light">
            {IMAGE_RENDER_PRESET_INFO[preset].hint}
          </p>
        </div>
        <div className="grid grid-cols-2">
          {IMAGE_RENDER_PRESETS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={preset === value}
              disabled={disabled}
              onClick={() => onPresetChange(value)}
              className={cn(
                'flex items-center justify-between px-3 py-2.5 font-serif text-[13px] border border-ink -ml-px -mt-px transition-colors',
                preset === value ? 'bg-cream-deep text-ink' : 'text-stone hover:bg-cream',
                disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent'
              )}
            >
              <span>{IMAGE_RENDER_PRESET_INFO[value].label}</span>
              {preset === value && <span className="font-mono text-[10px]">●</span>}
            </button>
          ))}
        </div>
        <p className="font-serif text-[11px] text-stone-light mt-1.5">
          三种屏幕会分别采用适合自身墨色的算法，无需调整阈值。
        </p>
        {disabled && (
          <p className="font-serif italic text-[11px] text-clay mt-1.5">
            这是一张旧图片，重新上传一次后即可切换优化风格。
          </p>
        )}
      </div>
    </div>
  );
}
