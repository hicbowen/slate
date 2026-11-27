// 图片内容编辑器 — 仅用于编辑已有图片内容；新建流程走 ContentCreateEditor。
//
// 拆分：
//   PreviewCanvas   — 帧预览 + 拖拽/缩放交互
//   ImageDropzone   — 选图(可选)
//   AudioDropzone   — 选音频 + 删除已有音频
//   DitherControls  — 缩放 / 抖动算法 / 阈值

import { useRef, useState, type FormEvent } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import type { Content } from '@/api';
import { useGenerateContentTts } from '@/features/contents/query/content-audio-queries';
import {
  usePatchContentFrameName,
  useUpdateImageContent,
} from '@/features/contents/query/content-mutation-queries';
import { useToast } from '@/components/feedback/toast-context';
import { FormActions } from '@/components/ui/FormActions';
import { PageHeader } from '@/components/layout/PageHeader';
import { useLeaveDraft } from '@/hooks/useLeaveDraft';
import { getApiErrorMessage } from '@/lib/api-errors';
import { useImageContentForm } from '@/features/contents/hooks/useImageContentForm';
import { ImageFormBody } from './ImageFormBody';

interface ImageContentEditorProps {
  gid: string;
  content: Content;
  onDone: () => void;
}

export function ImageContentEditor({ gid, content, onDone }: ImageContentEditorProps) {
  const updateImageContent = useUpdateImageContent(gid);
  const patchFrameName = usePatchContentFrameName(gid);
  const generateTts = useGenerateContentTts(gid);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const toast = useToast();
  const form = useImageContentForm(content);
  const leaveAfterSave = useLeaveDraft(form.dirty);

  const canSubmit = form.canEdit;

  async function submitContent() {
    if (inFlight.current || !canSubmit) return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      if (form.hasUploadPatch) {
        const fd = await form.buildFormData();
        await updateImageContent.mutateAsync({ contentId: content.id, form: fd });
      } else if (form.frameNameChanged) {
        await patchFrameName.mutateAsync({
          contentId: content.id,
          frameName: form.frameName.trim() || null,
        });
      }
      if (form.audio.wantsTts) {
        try {
          await generateTts.mutateAsync({
            contentId: content.id,
            body: { text: form.audio.trimmedTtsText, voice: form.audio.ttsVoice },
          });
        } catch (err) {
          const title = form.hasContentPatch ? '内容已保存，TTS 生成失败' : 'TTS 生成失败';
          toast.error(title, `${getApiErrorMessage(err)}。可调整 TTS 文案后重新保存。`);
          return;
        }
      }
      toast.success('内容已保存');
      leaveAfterSave(onDone);
    } catch (err) {
      toast.error('保存失败', getApiErrorMessage(err));
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitContent();
  }

  return (
    <div>
      <PageHeader
        onBack={onDone}
        icon={<ImageIcon size={24} />}
        title="编辑图片"
        subtitle={`内容组中的第 ${content.seq + 1} 项`}
      />

      <div className="mt-6 fade-up fade-up-1">
        <form onSubmit={onSubmit}>
          <ImageFormBody
            gid={gid}
            form={form}
            isEdit
            imageHash={content.imageHash}
            colorImageHash={content.colorImageHash}
            grayImageHash={content.grayImageHash}
            hasExistingAudio={!!content.audio?.hash}
            editingContentId={content.id}
            audioStatus={content.audio?.status ?? null}
            audioError={content.audio?.error ?? null}
            actions={
              <FormActions
                className="z-30 mt-6"
                onCancel={onDone}
                submitLabel="保存"
                disabled={!canSubmit}
                submitting={submitting}
              />
            }
          />
        </form>
      </div>
    </div>
  );
}
