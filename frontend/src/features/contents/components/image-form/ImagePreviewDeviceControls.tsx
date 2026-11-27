import { DisplayModeGray, DisplayModeMono, type Content } from '@/api';
import { Button } from '@/components/ui/Button';

export type PreviewDevice = 'note4' | 'note4c';

export function ImagePreviewDeviceControls({
  device,
  onDeviceChange,
  displayMode,
  onDisplayModeChange,
  grayAvailable,
  colorAvailable,
  disabled,
}: {
  device: PreviewDevice;
  onDeviceChange: (value: PreviewDevice) => void;
  displayMode: Content['displayMode'];
  onDisplayModeChange: (value: Content['displayMode']) => void;
  grayAvailable: boolean;
  colorAvailable: boolean;
  disabled?: boolean;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-2" role="group" aria-label="预览设备">
        <Button
          size="sm"
          variant={device === 'note4' ? 'primary' : 'soft'}
          aria-pressed={device === 'note4'}
          onClick={() => onDeviceChange('note4')}
        >
          Note4
        </Button>
        <Button
          size="sm"
          variant={device === 'note4c' ? 'primary' : 'soft'}
          aria-pressed={device === 'note4c'}
          disabled={!colorAvailable}
          onClick={() => onDeviceChange('note4c')}
        >
          Note4C
        </Button>
      </div>
      {device === 'note4c' ? (
        <p className="text-[12px] text-stone">Note4C · 黑白红黄四色</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Note4 上屏方式">
          <span className="text-[12px] text-stone">Note4 上屏</span>
          <Button
            size="sm"
            variant={displayMode === DisplayModeMono ? 'primary' : 'soft'}
            aria-pressed={displayMode === DisplayModeMono}
            disabled={disabled}
            onClick={() => onDisplayModeChange(DisplayModeMono)}
          >
            黑白 · 快速
          </Button>
          <Button
            size="sm"
            variant={displayMode === DisplayModeGray ? 'primary' : 'soft'}
            aria-pressed={displayMode === DisplayModeGray}
            disabled={disabled || !grayAvailable}
            onClick={() => onDisplayModeChange(DisplayModeGray)}
          >
            16 灰 · 全刷
          </Button>
        </div>
      )}
    </>
  );
}
