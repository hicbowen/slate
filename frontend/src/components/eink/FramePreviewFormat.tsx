import { Button } from '@/components/ui/Button';
import type { ImageFrameFormat } from '@/lib/eink/image-preview';

const formats = [
  ['mono1', 'Note4 黑白'],
  ['gray4', 'Note4 16 灰'],
  ['bwry2', 'Note4C 四色'],
] as const;

export function FramePreviewFormat({
  format,
  onChange,
  allowGray = false,
  grayAvailable = false,
  colorAvailable = true,
}: {
  format: ImageFrameFormat;
  onChange: (format: ImageFrameFormat) => void;
  allowGray?: boolean;
  grayAvailable?: boolean;
  colorAvailable?: boolean;
}) {
  return (
    <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="设备预览">
      {formats
        .filter(([value]) => allowGray || value !== 'gray4')
        .map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={value === format ? 'primary' : 'soft'}
            aria-pressed={value === format}
            disabled={
              (value === 'gray4' && !grayAvailable) || (value === 'bwry2' && !colorAvailable)
            }
            onClick={() => onChange(value)}
          >
            {label}
          </Button>
        ))}
    </div>
  );
}
