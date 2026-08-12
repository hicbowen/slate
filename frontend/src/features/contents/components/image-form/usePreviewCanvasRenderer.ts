import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { FrameFormatT, ImageRenderPreset } from 'shared';
import { clearCanvas, decodeFrameImage, isValidFrameLength } from '@/lib/eink/bpp';
import { drawImagePreview } from '@/lib/eink/image-preview';
import { useCanvasPan } from './useCanvasPan';
import { useLoadedImage } from './useLoadedImage';

interface CanvasOffset {
  x: number;
  y: number;
}

export function usePreviewCanvasRenderer({
  imageFile,
  existingSource,
  existingImage,
  renderPreset,
  format,
  scale,
  offset,
  onOffsetChange,
  canvasRef,
}: {
  imageFile: File | null;
  existingSource?: Blob;
  existingImage: ArrayBuffer | undefined;
  renderPreset: ImageRenderPreset;
  format: FrameFormatT;
  scale: number;
  offset: CanvasOffset;
  onOffsetChange: (offset: CanvasOffset) => void;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}) {
  const previewSource = imageFile ?? existingSource ?? null;
  const loadedImage = useLoadedImage(previewSource);
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
      if (!previewSource || loadedImage?.source !== previewSource) return false;
      const canvas = canvasRef.current;
      if (!canvas) return false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      drawImagePreview(ctx, canvas, loadedImage.image, {
        scale,
        offset: currentOffsetRef.current,
        renderPreset,
        format,
        dither,
      });
      return true;
    },
    [canvasRef, format, loadedImage, previewSource, renderPreset, scale]
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
    enabled: !!imageFile && loadedImage?.source === imageFile,
    offset,
    currentOffsetRef,
    onOffsetChange,
    onPreviewMove: () => scheduleImageDraw(false),
    onCommit: () => scheduleImageDraw(true),
  });
  const { isDraggingRef } = pan;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (previewSource) {
      if (loadedImage?.source !== previewSource) {
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
      if (!isValidFrameLength(bytes, format)) {
        clearCanvas(ctx, canvas);
        return;
      }
      const data = decodeFrameImage(bytes, format);
      ctx.putImageData(data, 0, 0);
      return;
    }

    clearCanvas(ctx, canvas);
  }, [
    canvasRef,
    cancelScheduledDraw,
    existingImage,
    format,
    imageFile,
    isDraggingRef,
    loadedImage,
    offset,
    previewSource,
    scheduleImageDraw,
  ]);

  return pan;
}
