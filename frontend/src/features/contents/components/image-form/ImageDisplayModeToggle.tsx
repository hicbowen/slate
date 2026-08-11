import type { ImageDisplayModeT } from 'shared';
import { cn } from '@/lib/cn';

export function ImageDisplayModeToggle({
  value,
  onChange,
}: {
  value: ImageDisplayModeT;
  onChange: (value: ImageDisplayModeT) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <ModeButton
        active={value === 'mono1'}
        title="黑白 · 快速"
        detail="日常 UI / 文字，支持局刷"
        onClick={() => onChange('mono1')}
      />
      <ModeButton
        active={value === 'gray16'}
        title="16 灰 · 照片"
        detail="完整灰阶全刷，刷新较慢"
        onClick={() => onChange('gray16')}
      />
    </div>
  );
}

function ModeButton({
  active,
  title,
  detail,
  onClick,
}: {
  active: boolean;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'border px-3 py-2.5 text-left transition-colors',
        active ? 'border-ink bg-ink text-paper' : 'border-line bg-paper hover:border-ink'
      )}
    >
      <span className="block font-mono text-[11px] tracking-[0.08em]">{title}</span>
      <span
        className={cn('mt-1 block font-sans text-[11px]', active ? 'text-cream' : 'text-stone')}
      >
        {detail}
      </span>
    </button>
  );
}
