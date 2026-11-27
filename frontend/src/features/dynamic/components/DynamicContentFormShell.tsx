import { useRef, type FormEvent, type ReactNode } from 'react';
import { FramePreviewFormat } from '@/components/eink/FramePreviewFormat';
import { MobilePreviewDock } from '@/components/eink/MobilePreviewDock';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

export function DynamicContentFormShell({
  onSubmit,
  preview,
  previewFormat,
  previewError,
  onRetryPreview,
  header,
  fields,
  actions,
  gridClassName,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  preview: ReactNode;
  previewFormat?: { color: boolean; onChange: (color: boolean) => void };
  previewError?: string;
  onRetryPreview?: () => void;
  header: ReactNode;
  fields?: ReactNode;
  actions?: ReactNode;
  gridClassName?: string;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const feedback = previewError && (
    <div className="mt-2 flex items-center justify-between gap-2">
      <p role="alert" className="min-w-0 break-words text-[12px] text-clay">
        {previewError}
      </p>
      <Button size="sm" variant="outline" className="shrink-0" onClick={onRetryPreview}>
        重试预览
      </Button>
    </div>
  );
  return (
    <form
      onSubmit={onSubmit}
      className={cn('lg:grid lg:items-start lg:gap-8', gridClassName ?? 'lg:grid-cols-[1.3fr_1fr]')}
    >
      <div ref={previewRef} className="min-w-0 lg:sticky lg:top-4">
        {previewFormat ? (
          <FramePreviewFormat
            format={previewFormat.color ? 'bwry2' : 'mono1'}
            onChange={(format) => previewFormat.onChange(format === 'bwry2')}
          />
        ) : (
          <p className="font-mono text-[10px] leading-5 text-stone uppercase tracking-[0.18em] ml-0.5 mb-2">
            设备预览
          </p>
        )}
        <div className="lg:max-w-[calc((100dvh_-_11rem)*1.33333)]">{preview}</div>
        {feedback}
      </div>
      <MobilePreviewDock previewRef={previewRef} preview={preview} feedback={feedback} />

      <div className="mt-6 min-w-0 space-y-6 lg:mt-0">
        {header}
        {fields}
        {actions}
      </div>
    </form>
  );
}
