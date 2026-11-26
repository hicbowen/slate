import { DisplayModeGray, DisplayModeMono, type AudioStatus } from '@/api';
import { useState, type ReactNode } from 'react';
import { useBlob } from '@/features/contents/query/content-image-queries';
import { FramePreviewFormat } from '@/components/eink/FramePreviewFormat';
import { Button } from '@/components/ui/Button';
import type { ImageFrameFormat } from '@/lib/eink/image-preview';
import { Input } from '@/components/ui/Input';
import { FormSection } from '@/components/ui/FormSection';
import { cn } from '@/lib/cn';
import { DitherControls } from './DitherControls';
import { ImageAudioBlock } from './ImageAudioBlock';
import { ImageDropzone } from './ImageDropzone';
import { PreviewCanvas } from './PreviewCanvas';
import type { useImageContentForm } from '@/features/contents/hooks/useImageContentForm';

interface ImageFormBodyProps {
  gid: string;
  form: ReturnType<typeof useImageContentForm>;
  isEdit: boolean;
  imageHash?: string;
  colorImageHash?: string | null;
  grayImageHash?: string | null;
  hasExistingAudio?: boolean;
  editingContentId?: string | null;
  audioStatus?: AudioStatus | null;
  audioError?: string | null;
  frameNamePlaceholder?: string;
  frameNameAutoFocus?: boolean;
  gridClassName?: string;
  beforeFields?: ReactNode;
  actions: ReactNode;
}

export function ImageFormBody({
  gid,
  form,
  isEdit,
  imageHash,
  colorImageHash,
  grayImageHash,
  hasExistingAudio = false,
  editingContentId = null,
  audioStatus,
  audioError,
  frameNamePlaceholder = '如：挖掘机',
  frameNameAutoFocus,
  gridClassName,
  beforeFields,
  actions,
}: ImageFormBodyProps) {
  const [format, setFormat] = useState<ImageFrameFormat>(
    form.displayMode === DisplayModeGray ? 'gray4' : 'mono1'
  );
  const canRender = !!(form.image.file || form.image.sourceFile);
  const grayAvailable = canRender || !!grayImageHash;
  const colorAvailable = canRender || !!colorImageHash;
  const previewFormat =
    (format === 'gray4' && !grayAvailable) || (format === 'bwry2' && !colorAvailable)
      ? 'mono1'
      : format;
  const savedHash = { mono1: imageHash, gray4: grayImageHash, bwry2: colorImageHash }[
    previewFormat
  ];
  const saved = useBlob(form.image.renderFile ? null : savedHash);
  return (
    <div
      className={cn('grid grid-cols-1 gap-6 lg:gap-8', gridClassName ?? 'lg:grid-cols-[1.3fr_1fr]')}
    >
      <div className="order-2 min-w-0 lg:order-1">
        <FramePreviewFormat
          format={previewFormat}
          onChange={setFormat}
          allowGray
          grayAvailable={grayAvailable}
          colorAvailable={colorAvailable}
        />
        <PreviewCanvas
          canvasRef={form.image.previewRef}
          imageFile={form.image.file ?? form.image.sourceFile}
          preferExistingImage={!!savedHash && !!form.image.sourceFile && !form.image.renderFile}
          existingImage={saved.data}
          existingImagePending={!!savedHash && !form.image.renderFile && saved.isPending}
          format={previewFormat}
          renderPreset={form.dither.renderPreset}
          threshold={form.dither.threshold}
          mode={form.dither.mode}
          scale={form.crop.scale}
          offset={form.crop.offset}
          onOffsetChange={form.crop.setOffset}
          statusCaption={form.frameName.trim() || null}
        />
      </div>

      <div className="order-1 min-w-0 lg:order-2 lg:mt-7 space-y-6">
        {beforeFields}

        <FormSection label="帧名称（选填，最多 64 字）">
          <Input
            type="text"
            maxLength={64}
            value={form.frameName}
            onChange={(event) => form.setFrameName(event.target.value)}
            placeholder={frameNamePlaceholder}
            autoFocus={frameNameAutoFocus}
          />
        </FormSection>

        <FormSection
          label="Note4 上屏方式"
          hint={grayAvailable ? '16 灰使用全刷，适合照片。' : '上传原图可生成 16 灰帧。'}
        >
          <div className="flex flex-wrap gap-2" role="group" aria-label="Note4 上屏方式">
            <Button
              size="sm"
              variant={form.displayMode === DisplayModeMono ? 'primary' : 'soft'}
              aria-pressed={form.displayMode === DisplayModeMono}
              onClick={() => {
                form.setDisplayMode(DisplayModeMono);
                setFormat('mono1');
              }}
            >
              黑白 · 快速
            </Button>
            <Button
              size="sm"
              variant={form.displayMode === DisplayModeGray ? 'primary' : 'soft'}
              disabled={!grayAvailable}
              aria-pressed={form.displayMode === DisplayModeGray}
              onClick={() => {
                form.setDisplayMode(DisplayModeGray);
                setFormat('gray4');
              }}
            >
              16 灰 · 照片
            </Button>
          </div>
        </FormSection>

        <FormSection
          label="类型参数"
          hint={
            form.image.sourceError
              ? '可编辑源图加载失败，仍可更换图片。'
              : form.image.sourceFile
                ? '可用已保存的源图重新调整渲染。'
                : undefined
          }
        >
          <div className="space-y-4">
            <ImageDropzone isEdit={isEdit} imageFile={form.image.file} onPick={form.image.onPick} />
            <DitherControls
              format={previewFormat}
              renderPreset={form.dither.renderPreset}
              onImageRenderPresetChange={form.dither.setImageRenderPreset}
              mode={form.dither.mode}
              onModeChange={form.dither.setMode}
              threshold={form.dither.threshold}
              onThresholdChange={form.dither.setThreshold}
              disabled={isEdit && !canRender}
              hasImage={canRender}
              scale={form.crop.scale}
              onScaleChange={form.crop.setScale}
              onResetCrop={form.crop.reset}
            />
          </div>
        </FormSection>

        <FormSection label="音频">
          <ImageAudioBlock
            gid={gid}
            mode={form.audio.mode}
            onModeChange={form.audio.setMode}
            audioFile={form.audio.file}
            onAudioFileChange={form.audio.setFile}
            ttsText={form.audio.ttsText}
            onTtsTextChange={form.audio.setTtsText}
            ttsVoice={form.audio.ttsVoice}
            onTtsVoiceChange={form.audio.setTtsVoice}
            hasExistingAudio={hasExistingAudio}
            editingContentId={editingContentId}
            audioStatus={audioStatus}
            audioError={audioError}
          />
        </FormSection>

        {actions}
      </div>
    </div>
  );
}
