import type { FormEvent, ReactNode } from 'react';
import type { FrameFormatT } from 'shared';
import { cn } from '@/lib/cn';
import { FrameFormatToggle } from '@/components/eink/FrameFormatToggle';

export function DynamicContentFormShell({
  onSubmit,
  preview,
  header,
  fields,
  actions,
  gridClassName,
  previewFormat,
  onPreviewFormatChange,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  preview: ReactNode;
  header: ReactNode;
  fields?: ReactNode;
  actions?: ReactNode;
  gridClassName?: string;
  previewFormat?: FrameFormatT;
  onPreviewFormatChange?: (format: FrameFormatT) => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className={cn('grid grid-cols-1 gap-6 lg:gap-8', gridClassName ?? 'lg:grid-cols-[1.3fr_1fr]')}
    >
      <div className="order-2 min-w-0 lg:order-1">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 ml-0.5">
          <p className="font-mono text-[10px] leading-5 text-stone uppercase tracking-[0.18em]">
            设备预览
          </p>
          {previewFormat && onPreviewFormatChange && (
            <FrameFormatToggle value={previewFormat} onChange={onPreviewFormatChange} />
          )}
        </div>
        {preview}
      </div>

      <div className="order-1 min-w-0 lg:order-2 lg:mt-7 space-y-6">
        {header}
        {fields}
        {actions}
      </div>
    </form>
  );
}
