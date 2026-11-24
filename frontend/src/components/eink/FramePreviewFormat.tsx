import { Button } from '@/components/ui/Button';

export function FramePreviewFormat({
  color,
  onChange,
  disabled,
}: {
  color: boolean;
  onChange: (color: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="设备预览">
      <Button
        size="sm"
        variant={color ? 'soft' : 'primary'}
        aria-pressed={!color}
        onClick={() => onChange(false)}
      >
        Note4 黑白
      </Button>
      <Button
        size="sm"
        variant={color ? 'primary' : 'soft'}
        aria-pressed={color}
        disabled={disabled}
        onClick={() => onChange(true)}
      >
        Note4C 四色
      </Button>
    </div>
  );
}
