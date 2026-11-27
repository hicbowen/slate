import { useRef, useState, type FormEvent } from 'react';
import { useToast } from '@/components/feedback/toast-context';
import { FormActions } from '@/components/ui/FormActions';
import { ImageFormBody } from '@/features/contents/components/image-form/ImageFormBody';
import { useGenerateContentTts } from '@/features/contents/query/content-audio-queries';
import { useCreateImageContent } from '@/features/contents/query/content-mutation-queries';
import type { useImageContentForm } from '@/features/contents/hooks/useImageContentForm';
import { getApiErrorMessage } from '@/lib/api-errors';

interface ImageCreateFormProps {
  gid: string;
  form: ReturnType<typeof useImageContentForm>;
  onCancel: () => void;
  onDone: () => void;
  onEditCreatedImage: (contentId: string) => void;
}

export function ImageCreateForm({
  gid,
  form,
  onCancel,
  onDone,
  onEditCreatedImage,
}: ImageCreateFormProps) {
  const createImage = useCreateImageContent(gid);
  const generateTts = useGenerateContentTts(gid);
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);

  async function submitContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !form.canCreate) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      const fd = await form.buildFormData();
      const created = await createImage.mutateAsync(fd);
      if (form.audio.wantsTts) {
        try {
          await generateTts.mutateAsync({
            contentId: created.id,
            body: { text: form.audio.trimmedTtsText, voice: form.audio.ttsVoice },
          });
        } catch (err) {
          toast.error('内容已新建，TTS 生成失败', getApiErrorMessage(err));
          onEditCreatedImage(created.id);
          return;
        }
      }
      toast.success('内容已新建');
      onDone();
    } catch (err) {
      toast.error('创建失败', getApiErrorMessage(err));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submitContent}>
      <ImageFormBody
        gid={gid}
        form={form}
        isEdit={false}
        actions={
          <FormActions
            className="z-30 mt-6"
            onCancel={onCancel}
            submitLabel="创建"
            disabled={!form.canCreate}
            submitting={submitting}
          />
        }
      />
    </form>
  );
}
