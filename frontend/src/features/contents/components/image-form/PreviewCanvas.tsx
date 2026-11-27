import type { CropOptions, ImageFrameFormat, MonochromeMode } from '@/lib/eink/image-preview';
import { FrameWidth, FrameHeight } from '@/api';
import type { ImageRenderPreset } from '@/lib/eink/render-preset';
import { useRef } from 'react';
import { cn } from '@/lib/cn';
import { StatusBarOverlay } from '@/components/eink/StatusBarOverlay';
import { usePreviewCanvasRenderer } from './usePreviewCanvasRenderer';

export interface PreviewCanvasProps {
  imageFile: File | null;
  existingImage: ArrayBuffer | undefined;
  preferExistingImage?: boolean;
  format: ImageFrameFormat;
  renderPreset: ImageRenderPreset;
  existingImagePending?: boolean;
  threshold: number;
  mode: MonochromeMode;
  scale: number;
  fit?: CropOptions['fit'];
  offset: { x: number; y: number };
  onOffsetChange: (o: { x: number; y: number }) => void;
  interactive?: boolean;
  statusCaption?: string | null;
  showStatusBar?: boolean;
}

export function PreviewCanvas({
  imageFile,
  existingImage,
  preferExistingImage,
  format,
  renderPreset,
  existingImagePending,
  threshold,
  mode,
  scale,
  fit,
  offset,
  onOffsetChange,
  interactive = true,
  statusCaption,
  showStatusBar = true,
}: PreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canPan = interactive && !!imageFile;
  const pan = usePreviewCanvasRenderer({
    imageFile,
    existingImage,
    preferExistingImage,
    format,
    renderPreset,
    threshold,
    mode,
    scale,
    fit,
    offset,
    onOffsetChange,
    canvasRef,
    interactive,
  });

  return (
    <div className="frame-preview-surface">
      {existingImagePending && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="font-serif italic text-[13px] text-stone-light">加载中…</span>
        </div>
      )}
      {!imageFile && !existingImage && !existingImagePending && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="font-serif italic text-[13px] text-stone-light">选图后显示预览</span>
        </div>
      )}
      <canvas
        ref={canvasRef}
        width={FrameWidth}
        height={FrameHeight}
        className={cn(
          'block w-full h-full',
          canPan && 'touch-none cursor-grab',
          pan.isDragging && 'cursor-grabbing'
        )}
        onPointerDown={pan.onPointerDown}
        onPointerMove={pan.onPointerMove}
        onPointerUp={pan.onPointerUp}
        onPointerCancel={pan.onPointerUp}
      />
      {showStatusBar && <StatusBarOverlay caption={statusCaption} />}
    </div>
  );
}
