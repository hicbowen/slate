import { useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { MessageSquare, Send } from 'lucide-react';
import type { DynamicConfig } from '@/api';
import { useToast } from '@/components/feedback/toast-context';
import { Button } from '@/components/ui/Button';
import { DialogHeader } from '@/components/ui/DialogHeader';
import { Spinner } from '@/components/ui/Spinner';
import { dialogContentWideCls, dialogOverlayCls } from '@/components/ui/styles/dialog';
import { useUpdateDynamicContent } from '@/features/dynamic/query/dynamic-content-queries';
import { getApiErrorMessage } from '@/lib/api-errors';
import { cn } from '@/lib/cn';
import { MessageBoardTextFields } from './config/MessageBoardConfig';

const emptyNote: DynamicConfig = { type: 'message_board', message: '' };

export function QuickMessageBoardDialog({ gid, contentId }: { gid: string; contentId: string }) {
  const update = useUpdateDynamicContent(gid);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(emptyNote);
  const [error, setError] = useState<string>();
  const pending = update.isPending;

  function changeOpen(next: boolean) {
    if (pending) return;
    if (next) {
      setDraft(emptyNote);
      setError(undefined);
    }
    setOpen(next);
  }

  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !draft.message?.trim()) return;
    setError(undefined);
    try {
      await update.mutateAsync({ contentId, config: draft });
      setOpen(false);
      toast.success('已保存，待设备同步');
    } catch (err) {
      setError(getApiErrorMessage(err, '留言发布失败，请重试。'));
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild>
        <Button variant="soft" size="sm" iconLeft={<MessageSquare size={14} />} className="px-2.5">
          写留言
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayCls} />
        <Dialog.Content
          className={cn(dialogContentWideCls, 'max-w-md max-h-[calc(100dvh-2rem)]')}
          onPointerDownOutside={(event) => {
            if (draft.message?.trim() || draft.messageAuthor?.trim() || pending)
              event.preventDefault();
          }}
        >
          <DialogHeader
            icon={<MessageSquare size={22} />}
            title="写留言"
            description="快捷发布后，留言会持续显示。过期时间可在卡片编辑页设置。"
            className="border-b border-line px-5 py-4 sm:px-6 sm:py-5"
          />
          <form className="flex min-h-0 flex-col" onSubmit={publish} aria-busy={pending}>
            <fieldset
              disabled={pending}
              className="min-h-0 space-y-5 overflow-y-auto px-5 py-5 sm:px-6"
            >
              <MessageBoardTextFields
                config={draft}
                onChange={(config) => {
                  setDraft(config);
                  setError(undefined);
                }}
              />
              {error && (
                <p role="alert" className="text-sm leading-relaxed text-clay">
                  {error}
                </p>
              )}
            </fieldset>
            <div className="flex justify-end gap-2 border-t border-line px-5 py-4 sm:px-6">
              <Dialog.Close asChild>
                <Button variant="outline" disabled={pending}>
                  取消
                </Button>
              </Dialog.Close>
              <Button
                type="submit"
                disabled={pending || !draft.message?.trim()}
                iconLeft={<Send size={14} />}
              >
                {pending ? <Spinner label="正在发布" /> : '发布留言'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
