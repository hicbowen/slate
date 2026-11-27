import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { ImageRenderPreset } from '@/lib/eink/render-preset';
import { clearCanvas, decodeBppImage, isValidBppLength } from '@/lib/eink/bpp';
import {
  drawImagePreview,
  normalizeCropOffset,
  type CropOptions,
  type ImageFrameFormat,
  type MonochromeMode,
} from '@/lib/eink/image-preview';
import { useCanvasPan } from './useCanvasPan';
import { useLoadedImage } from './useLoadedImage';

interface CanvasOffset {
  x: number;
  y: number;
}

export function usePreviewCanvasRenderer({
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
}: {
  imageFile: File | null;
  existingImage: ArrayBuffer | undefined;
  preferExistingImage?: boolean;
  format: ImageFrameFormat;
  renderPreset: ImageRenderPreset;
  threshold: number;
  mode: MonochromeMode;
  scale: number;
  fit?: CropOptions['fit'];
  offset: CanvasOffset;
  onOffsetChange: (offset: CanvasOffset) => void;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  interactive: boolean;
}) {
  const loadedImage = useLoadedImage(imageFile);
  const drawFrameRef = useRef<number | null>(null);
  const currentOffsetRef = useRef(offset);

  const cancelScheduledDraw = useCallback(() => {
    if (drawFrameRef.current == null) return;
    cancelAnimationFrame(drawFrameRef.current);
    drawFrameRef.current = null;
  }, []);

  useEffect(() => cancelScheduledDraw, [cancelScheduledDraw]);

  const drawLoadedImage = useCallback(
    (dither: boolean) => {
      if (!imageFile || loadedImage?.file !== imageFile) return false;
      const canvas = canvasRef.current;
      if (!canvas) return false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      drawImagePreview(ctx, canvas, loadedImage.image, {
        scale,
        fit,
        offset: currentOffsetRef.current,
        threshold,
        mode,
        dither,
        format,
        renderPreset,
      });
      return true;
    },
    [renderPreset, canvasRef, fit, format, imageFile, loadedImage, mode, scale, threshold]
  );

  const scheduleImageDraw = useCallback(
    (dither: boolean) => {
      cancelScheduledDraw();
      drawFrameRef.current = requestAnimationFrame(() => {
        drawFrameRef.current = null;
        drawLoadedImage(dither);
      });
    },
    [cancelScheduledDraw, drawLoadedImage]
  );

  const pan = useCanvasPan({
    enabled: interactive && !!imageFile && loadedImage?.file === imageFile,
    offset,
    currentOffsetRef,
    onOffsetChange,
    normalizeOffset: (next) => {
      const canvas = canvasRef.current;
      return canvas && loadedImage
        ? normalizeCropOffset(canvas, loadedImage.image, { scale, fit, offset: next })
        : next;
    },
    onPreviewMove: () => scheduleImageDraw(false),
    onCommit: () => scheduleImageDraw(true),
  });
  const { isDraggingRef } = pan;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (imageFile && !preferExistingImage) {
      if (loadedImage?.file !== imageFile) {
        cancelScheduledDraw();
        clearCanvas(ctx, canvas);
        return;
      }
      if (!isDraggingRef.current) {
        currentOffsetRef.current = offset;
      }
      scheduleImageDraw(!isDraggingRef.current);
      return cancelScheduledDraw;
    }

    cancelScheduledDraw();
    if (existingImage) {
      const bytes = new Uint8Array(existingImage);
      if (!isValidBppLength(bytes)) {
        clearCanvas(ctx, canvas);
        return;
      }
      const data = decodeBppImage(bytes);
      ctx.putImageData(data, 0, 0);
      return;
    }

    clearCanvas(ctx, canvas);
  }, [
    canvasRef,
    cancelScheduledDraw,
    existingImage,
    imageFile,
    isDraggingRef,
    loadedImage,
    offset,
    preferExistingImage,
    scheduleImageDraw,
  ]);

  return pan;
}
