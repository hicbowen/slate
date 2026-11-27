import { DisplayModeGray, type AudioStatus } from '@/api';
import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useBlob } from '@/features/contents/query/content-image-queries';
import { MobilePreviewDock } from '@/components/eink/MobilePreviewDock';
import { Input } from '@/components/ui/Input';
import { FormSection } from '@/components/ui/FormSection';
import { Select, SelectItem } from '@/components/ui/Select';
import { appRoutes } from '@/app/routes';
import { IMAGE_RENDER_PRESET_INFO, type ImageRenderPreset } from '@/lib/eink/render-preset';
import type { useImageContentForm } from '@/features/contents/hooks/useImageContentForm';
import { DitherControls } from './DitherControls';
import { ImageAudioBlock } from './ImageAudioBlock';
import { ImageCropControls } from './ImageCropControls';
import { ImageDropzone } from './ImageDropzone';
import { ImagePreviewDeviceControls, type PreviewDevice } from './ImagePreviewDeviceControls';
import { PreviewCanvas, type PreviewCanvasProps } from './PreviewCanvas';

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
  actions,
}: ImageFormBodyProps) {
  const [device, setDevice] = useState<PreviewDevice>('note4');
  const previewRef = useRef<HTMLDivElement>(null);
  const image = form.image.file ?? form.image.sourceFile;
  const grayAvailable = !!(image || grayImageHash);
  const colorAvailable = !!(image || colorImageHash);
  const showingColor = device === 'note4c' && colorAvailable;
  const format = showingColor
    ? 'bwry2'
    : form.displayMode === DisplayModeGray && grayAvailable
      ? 'gray4'
      : 'mono1';
  const savedHash = { mono1: imageHash, gray4: grayImageHash, bwry2: colorImageHash }[format];
  const saved = useBlob(form.image.renderFile ? null : savedHash);
  const preview: PreviewCanvasProps = {
    imageFile: image,
    preferExistingImage: !!savedHash && !!form.image.sourceFile && !form.image.renderFile,
    existingImage: saved.data,
    existingImagePending: !!savedHash && !form.image.renderFile && saved.isPending,
    format,
    renderPreset: form.dither.renderPreset,
    threshold: form.dither.threshold,
    mode: form.dither.mode,
    scale: form.crop.scale,
    fit: form.crop.fit,
    offset: form.crop.offset,
    onOffsetChange: form.crop.setOffset,
    statusCaption: form.frameName.trim() || null,
  };
  const audioConfigured =
    hasExistingAudio || !!audioStatus || !!form.audio.file || !!form.audio.ttsText;

  return (
    <>
      <div className="mb-5 space-y-2">
        <ImageDropzone
          isEdit={isEdit}
          imageFile={form.image.file}
          onPick={form.image.onPick}
          pending={form.image.pending}
          error={form.image.error}
        />
        {!isEdit && (
          <Link
            to={appRoutes.batchImages(gid)}
            className="text-[12px] text-stone underline underline-offset-4"
          >
            批量导入照片
          </Link>
        )}
        {form.image.sourceError && (
          <p className="text-[12px] text-clay">可编辑图片加载失败，仍可更换图片。</p>
        )}
        {(form.image.file || form.image.hadOriginal) && (
          <label className="flex items-start gap-2 text-[12px] text-stone">
            <input
              type="checkbox"
              className="mt-0.5 accent-ink"
              checked={form.image.keepOriginal}
              disabled={!form.image.canRetainOriginal}
              onChange={(event) => form.image.setKeepOriginal(event.target.checked)}
            />
            <span>
              <span className="block text-ink">保留原图</span>
              {form.image.canRetainOriginal
                ? '原图保存在服务端，以后可重新裁剪。单张上限 12 MB。'
                : '只保留裁剪后的图片。可保留的原图须为 PNG、JPG、WebP、GIF 或 BMP，且不超过 12 MB。'}
            </span>
          </label>
        )}
        {isEdit && !form.image.file && !form.image.hadOriginal && (
          <p className="text-[12px] text-stone">如需重取裁剪范围，请重新选择原图。</p>
        )}
      </div>

      {image || imageHash ? (
        <div className="lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start lg:gap-8">
          <div ref={previewRef} className="min-w-0 lg:sticky lg:top-4">
            <div className="space-y-2">
              <ImagePreviewDeviceControls
                device={showingColor ? 'note4c' : 'note4'}
                onDeviceChange={setDevice}
                displayMode={form.displayMode}
                onDisplayModeChange={form.setDisplayMode}
                grayAvailable={grayAvailable}
                colorAvailable={colorAvailable}
              />
              <div className="lg:max-w-[calc((100dvh_-_21rem)*1.33333)]">
                <PreviewCanvas {...preview} interactive={!!image} />
              </div>
            </div>
            {image && (
              <ImageCropControls
                fit={form.crop.fit}
                scale={form.crop.scale}
                onFitChange={(next) => {
                  if (next === form.crop.fit) return;
                  form.crop.setFit(next);
                  form.crop.reset();
                }}
                onScaleChange={form.crop.setScale}
                onReset={form.crop.reset}
              />
            )}
          </div>

          <MobilePreviewDock
            previewRef={previewRef}
            preview={<PreviewCanvas {...preview} interactive={false} />}
          />

          <div className="mt-6 min-w-0 space-y-5 lg:mt-0">
            <Input
              label="帧名称（选填）"
              maxLength={64}
              value={form.frameName}
              onChange={(event) => form.setFrameName(event.target.value)}
              placeholder={form.image.file?.name.replace(/\.[^.]+$/, '') || '填写状态栏标题'}
            />
            {image && (
              <>
                <FormSection
                  label="图片风格"
                  hint={
                    format === 'mono1' && form.dither.mode !== 'preset'
                      ? '当前黑白预览使用手动抖动。图片风格用于 16 灰和四色。'
                      : undefined
                  }
                >
                  <Select
                    aria-label="图片风格"
                    value={form.dither.renderPreset}
                    onValueChange={(value) =>
                      form.dither.setImageRenderPreset(value as ImageRenderPreset)
                    }
                  >
                    {Object.entries(IMAGE_RENDER_PRESET_INFO).map(([value, { label, hint }]) => (
                      <SelectItem key={value} value={value} hint={hint}>
                        {label}
                      </SelectItem>
                    ))}
                  </Select>
                </FormSection>
                <details className="border-y border-line py-3">
                  <summary className="cursor-pointer text-[13px] text-ink">高级设置</summary>
                  <div className="mt-4">
                    {format === 'mono1' ? (
                      <DitherControls
                        mode={form.dither.mode}
                        onModeChange={form.dither.setMode}
                        threshold={form.dither.threshold}
                        onThresholdChange={form.dither.setThreshold}
                      />
                    ) : (
                      <p className="text-[12px] text-stone">切换到 Note4 黑白可调整抖动和阈值。</p>
                    )}
                  </div>
                </details>
              </>
            )}
            <details className="border-b border-line pb-3" open={audioConfigured || undefined}>
              <summary className="cursor-pointer text-[13px] text-ink">
                {audioConfigured ? '音频' : '添加音频'}
              </summary>
              <div className="mt-4">
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
              </div>
            </details>
            {actions}
          </div>
        </div>
      ) : (
        actions
      )}
    </>
  );
}
