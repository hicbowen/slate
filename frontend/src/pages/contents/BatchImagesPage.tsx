import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDropzone } from 'react-dropzone';
import { Images, Trash2 } from 'lucide-react';
import { MobilePreviewDock } from '@/components/eink/MobilePreviewDock';
import { ImageCropControls } from '@/features/contents/components/image-form/ImageCropControls';
import {
  ImagePreviewDeviceControls,
  type PreviewDevice,
} from '@/features/contents/components/image-form/ImagePreviewDeviceControls';
import { useLeaveDraft } from '@/hooks/useLeaveDraft';
import { PageHeader } from '@/components/layout/PageHeader';
import { RequireRouteParams } from '@/components/layout/RequireRouteParams';
import { Button } from '@/components/ui/Button';
import { Select, SelectItem } from '@/components/ui/Select';
import { PreviewCanvas } from '@/features/contents/components/image-form/PreviewCanvas';
import {
  buildImageUpload,
  canRetainOriginal,
  decodeImageFile,
} from '@/features/contents/lib/image-upload';
import { useInvalidateContentDependencies } from '@/features/contents/query/content-cache-helpers';
import { getApiErrorMessage } from '@/lib/api-errors';
import { http, SLOW_REQUEST } from '@/lib/http';
import { cn } from '@/lib/cn';
import { appRoutes } from '@/app/routes';
import { DisplayModeGray, DisplayModeMono, type Content } from '@/api';
import type { CropOptions, ImageFrameFormat } from '@/lib/eink/image-preview';
import {
  IMAGE_RENDER_PRESETS,
  IMAGE_RENDER_PRESET_INFO,
  type ImageRenderPreset,
} from '@/lib/eink/render-preset';

type Photo = {
  id: string;
  file: File;
  crop?: CropOptions;
  uploaded?: boolean;
  error?: string;
  invalid?: boolean;
  checking?: boolean;
};

const accept = { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'] };
const frameName = (file: File) => file.name.replace(/\.[^.]+$/, '');
const newPhoto = (file: File): Photo => ({
  id: Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join(''),
  file,
  checking: true,
});

export function BatchImagesPage() {
  return (
    <RequireRouteParams names={['gid'] as const} hint="请从内容组进入批量导入。">
      {({ gid }) => <BatchImages key={gid} gid={gid} />}
    </RequireRouteParams>
  );
}

function BatchImages({ gid }: { gid: string }) {
  const navigate = useNavigate();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [defaultFit, setDefaultFit] = useState<NonNullable<CropOptions['fit']>>('contain');
  const [renderPreset, setRenderPreset] = useState<ImageRenderPreset>('auto');
  const [displayMode, setDisplayMode] = useState<Content['displayMode']>(DisplayModeMono);
  const [keepOriginal, setKeepOriginal] = useState(false);
  const [device, setDevice] = useState<PreviewDevice>('note4');
  const format: ImageFrameFormat =
    device === 'note4c' ? 'bwry2' : displayMode === DisplayModeGray ? 'gray4' : 'mono1';
  const [activeId, setActiveId] = useState('');
  const [dropMessage, setDropMessage] = useState('');
  const uploadRef = useRef<AbortController | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const invalidate = useInvalidateContentDependencies(gid);
  useEffect(() => () => uploadRef.current?.abort(), []);

  useLeaveDraft(photos.some((photo) => !photo.uploaded && !photo.invalid));
  const checking = photos.some((photo) => photo.checking);
  const pending = photos.filter((photo) => !photo.uploaded && !photo.invalid && !photo.checking);
  const selected = pending.find((photo) => photo.id === selectedId) ?? pending[0];
  const selectedCrop = cropFor(selected);
  function cropFor(photo: Photo | undefined): CropOptions {
    const crop = photo?.crop ?? { fit: defaultFit, scale: 1, offset: { x: 0, y: 0 } };
    return crop.fit === 'cover' && crop.scale < 1 ? { ...crop, scale: 1 } : crop;
  }
  const busy = activeId !== '';
  const dropzone = useDropzone({
    accept,
    disabled: busy || checking,
    onDrop: async (files, rejected) => {
      const added = files.map(newPhoto);
      setPhotos((rows) => [...rows, ...added]);
      setDropMessage(rejected.length > 0 ? `${rejected.length} 个文件格式不受支持。` : '');
      for (const photo of added) {
        try {
          const bitmap = await decodeImageFile(photo.file);
          bitmap.close();
          updatePhoto(photo.id, { checking: false });
        } catch (error) {
          updatePhoto(photo.id, {
            checking: false,
            invalid: true,
            error: getApiErrorMessage(error),
          });
        }
      }
    },
  });

  function updatePhoto(id: string, patch: Partial<Photo>) {
    setPhotos((rows) => rows.map((photo) => (photo.id === id ? { ...photo, ...patch } : photo)));
  }

  async function upload() {
    if (uploadRef.current || checking || pending.length === 0) return;
    const controller = new AbortController();
    uploadRef.current = controller;
    try {
      for (const photo of pending) {
        setActiveId(photo.id);
        updatePhoto(photo.id, { error: undefined });
        try {
          const form = await buildImageUpload({
            imageFile: photo.file,
            frameName: frameName(photo.file),
            ...cropFor(photo),
            displayMode,
            renderPreset,
            threshold: 128,
            mode: 'preset',
            keepOriginal: keepOriginal && canRetainOriginal(photo.file),
          });
          controller.signal.throwIfAborted();
          const content = await http.post<Content>(`/groups/${gid}/contents`, form, {
            ...SLOW_REQUEST,
            signal: controller.signal,
            headers: { 'Idempotency-Key': photo.id },
          });
          updatePhoto(photo.id, { uploaded: true });
          invalidate(content.id);
        } catch (error) {
          if (!controller.signal.aborted) {
            updatePhoto(photo.id, { error: getApiErrorMessage(error, '上传失败，可以继续重试。') });
            setSelectedId(photo.id);
          }
          break;
        }
      }
    } finally {
      uploadRef.current = null;
      if (!controller.signal.aborted) setActiveId('');
    }
  }

  const previewProps = {
    imageFile: selected?.file ?? null,
    existingImage: undefined,
    format,
    renderPreset,
    threshold: 128,
    mode: 'preset' as const,
    ...selectedCrop,
    onOffsetChange: (offset: CropOptions['offset']) => {
      if (
        selected &&
        !busy &&
        (offset.x !== selectedCrop.offset.x || offset.y !== selectedCrop.offset.y)
      ) {
        updatePhoto(selected.id, { crop: { ...selectedCrop, offset } });
      }
    },
    statusCaption: selected ? frameName(selected.file) : null,
  };
  return (
    <div>
      <PageHeader
        backLabel="内容组"
        onBack={() => navigate(appRoutes.group(gid))}
        icon={<Images size={24} />}
        title="批量导入照片"
        subtitle="统一设置裁剪和渲染风格，也可以逐张微调。"
      />
      <section className="mt-6 space-y-2">
        <div
          {...dropzone.getRootProps({
            className: cn(
              'border border-dashed border-ink px-4 py-6 text-center text-[13px]',
              busy ? 'opacity-50' : 'cursor-pointer hover:bg-cream',
              dropzone.isDragActive && 'bg-cream'
            ),
            'aria-label': '添加照片',
          })}
        >
          <input {...dropzone.getInputProps()} />
          拖入照片或点击选择
        </div>
        <label className="flex items-center gap-2 text-[12px] text-stone">
          <input
            type="checkbox"
            className="accent-ink"
            checked={keepOriginal}
            disabled={busy}
            onChange={(event) => setKeepOriginal(event.target.checked)}
          />
          保留原图（每张最多 12 MB）
        </label>
        {keepOriginal && pending.some((photo) => !canRetainOriginal(photo.file)) && (
          <p className="text-[12px] text-stone">
            有 {pending.filter((photo) => !canRetainOriginal(photo.file)).length}{' '}
            张不符合原图保留条件，只会保存裁剪后的图片。
          </p>
        )}
        {dropMessage && (
          <p role="alert" className="text-[12px] text-clay">
            {dropMessage}
          </p>
        )}
      </section>
      <div className="mt-5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
        {selected && (
          <>
            <div ref={previewRef} className="min-w-0 lg:sticky lg:top-4">
              <div className="space-y-2">
                <ImagePreviewDeviceControls
                  device={device}
                  onDeviceChange={setDevice}
                  displayMode={displayMode}
                  onDisplayModeChange={setDisplayMode}
                  grayAvailable
                  colorAvailable
                  disabled={busy}
                />
                <div className="lg:max-w-[calc((100dvh_-_21rem)*1.33333)]">
                  <PreviewCanvas key={selected.id} {...previewProps} interactive={!busy} />
                </div>
              </div>
              <ImageCropControls
                fit={selectedCrop.fit ?? defaultFit}
                scale={selectedCrop.scale}
                disabled={busy}
                onFitChange={(fit) => {
                  if (fit !== selectedCrop.fit)
                    updatePhoto(selected.id, { crop: { ...selectedCrop, fit } });
                }}
                onScaleChange={(scale) =>
                  updatePhoto(selected.id, { crop: { ...selectedCrop, scale } })
                }
                onReset={() => updatePhoto(selected.id, { crop: undefined })}
                resetLabel="重置本张"
              />
            </div>
            <MobilePreviewDock
              previewRef={previewRef}
              preview={<PreviewCanvas key={selected.id} {...previewProps} interactive={false} />}
            />
          </>
        )}
        <section className="mt-5 min-w-0 space-y-4 lg:mt-0">
          <div className="flex flex-wrap gap-2">
            <Select
              aria-label="批量默认构图"
              value={defaultFit}
              disabled={busy}
              onValueChange={(value) => setDefaultFit(value === 'cover' ? 'cover' : 'contain')}
            >
              <SelectItem value="contain">默认 · 完整显示</SelectItem>
              <SelectItem value="cover">默认 · 填满画面</SelectItem>
            </Select>
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy || !pending.some((photo) => photo.crop && photo.crop.fit !== defaultFit)
              }
              onClick={() =>
                setPhotos((rows) =>
                  rows.map((row) =>
                    row.uploaded || !row.crop
                      ? row
                      : { ...row, crop: { ...row.crop, fit: defaultFit } }
                  )
                )
              }
            >
              将默认构图应用到全部
            </Button>
            <Select
              aria-label="渲染风格"
              value={renderPreset}
              disabled={busy}
              onValueChange={(value) => setRenderPreset(value as ImageRenderPreset)}
            >
              {IMAGE_RENDER_PRESETS.map((preset) => (
                <SelectItem key={preset} value={preset}>
                  {IMAGE_RENDER_PRESET_INFO[preset].label}
                </SelectItem>
              ))}
            </Select>
          </div>
          {photos.length > 0 && (
            <ul className="max-h-80 divide-y divide-line overflow-auto border border-line">
              {photos.map((photo) => (
                <li key={photo.id} className="flex items-center gap-2 px-2 py-1.5">
                  <button
                    type="button"
                    className={cn(
                      'min-w-0 flex-1 truncate px-2 py-1 text-left text-[13px]',
                      selected?.id === photo.id && 'bg-cream'
                    )}
                    disabled={photo.uploaded || photo.invalid || photo.checking || busy}
                    aria-pressed={selected?.id === photo.id}
                    onClick={() => setSelectedId(photo.id)}
                  >
                    {photo.file.name}
                    {photo.crop && ' · 已微调'}
                  </button>
                  <span
                    className={cn('text-[11px] text-stone', photo.error && 'text-clay')}
                    role={photo.error ? 'alert' : undefined}
                  >
                    {photo.error ??
                      (photo.uploaded
                        ? '已导入'
                        : photo.checking
                          ? '正在读取…'
                          : activeId === photo.id
                            ? '上传中…'
                            : null)}
                  </span>
                  {!photo.uploaded && (
                    <Button
                      variant="link"
                      size="sm"
                      aria-label={`移除 ${photo.file.name}`}
                      disabled={busy}
                      onClick={() => setPhotos((rows) => rows.filter((row) => row.id !== photo.id))}
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              disabled={busy || checking || !pending.length}
              onClick={() => void upload()}
            >
              {busy ? '正在导入…' : `导入 ${pending.length} 张`}
            </Button>
            <span role="status" className="text-[12px] text-stone">
              已导入 {photos.filter((photo) => photo.uploaded).length} 张
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
