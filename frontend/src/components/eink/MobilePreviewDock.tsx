import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Maximize2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { dialogContentWideCls, dialogOverlayCls } from '@/components/ui/styles/dialog';

export function MobilePreviewDock({
  previewRef,
  preview,
  feedback,
}: {
  previewRef: RefObject<HTMLDivElement | null>;
  preview: ReactNode;
  feedback?: ReactNode;
}) {
  const [pastPreview, setPastPreview] = useState(false);

  useEffect(() => {
    const target = previewRef.current;
    if (!target) return;
    const desktop = window.matchMedia('(min-width: 1024px)');
    const observer = new IntersectionObserver(([entry]) => {
      if (entry) setPastPreview(entry.boundingClientRect.bottom <= 0);
    });
    const watch = () => {
      observer.disconnect();
      if (desktop.matches) setPastPreview(false);
      else observer.observe(target);
    };
    watch();
    desktop.addEventListener('change', watch);
    return () => {
      desktop.removeEventListener('change', watch);
      observer.disconnect();
    };
  }, [previewRef]);

  return (
    <Dialog.Root>
      <div className="sticky top-0 z-30 h-0 lg:hidden">
        {pastPreview && (
          <Dialog.Trigger asChild>
            <button
              type="button"
              aria-label="放大预览"
              className="absolute inset-x-0 top-0 flex w-full items-center justify-center gap-3 border-b border-line bg-paper py-2"
            >
              <div className="pointer-events-none w-[min(12rem,30dvh,60%)]" aria-hidden="true">
                {preview}
              </div>
              <span className="flex items-center gap-1 text-[12px] text-stone">
                <Maximize2 size={14} /> 放大
              </span>
            </button>
          </Dialog.Trigger>
        )}
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayCls} />
        <Dialog.Content className={dialogContentWideCls + ' overflow-auto p-3'}>
          <div className="mb-2 flex items-center justify-between">
            <Dialog.Title className="font-serif text-[16px]">设备预览</Dialog.Title>
            <Dialog.Close asChild>
              <Button aria-label="关闭预览" size="sm" variant="link">
                <X size={17} />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">查看当前参数下的画面效果。</Dialog.Description>
          <div className="mx-auto w-full max-w-[calc((100dvh_-_8rem)*1.33333)]">{preview}</div>
          {feedback}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
