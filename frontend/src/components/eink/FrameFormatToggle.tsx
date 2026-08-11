import type { FrameFormatT } from 'shared';
import { cn } from '@/lib/cn';

export function FrameFormatToggle({
  value,
  onChange,
  className,
  allowGray = false,
}: {
  value: FrameFormatT;
  onChange: (value: FrameFormatT) => void;
  className?: string;
  allowGray?: boolean;
}) {
  return (
    <div
      className={cn(
        'inline-grid border border-ink bg-paper',
        allowGray ? 'grid-cols-3' : 'grid-cols-2',
        className
      )}
    >
      <FormatButton
        active={value === 'mono1'}
        label="Note4 · 黑白"
        onClick={() => onChange('mono1')}
      />
      {allowGray && (
        <FormatButton
          active={value === 'gray4'}
          label="Note4 · 16 灰"
          onClick={() => onChange('gray4')}
        />
      )}
      <FormatButton
        active={value === 'bwry2'}
        label="Note4C · 四色"
        onClick={() => onChange('bwry2')}
      />
    </div>
  );
}

function FormatButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 font-mono text-[10px] tracking-[0.08em] transition-colors [&:not(:last-child)]:border-r [&:not(:last-child)]:border-ink',
        active ? 'bg-ink text-paper' : 'text-stone hover:bg-cream hover:text-ink'
      )}
    >
      {label}
    </button>
  );
}
