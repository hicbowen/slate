import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { FRAME_HEIGHT, FRAME_WIDTH, type FrameFormatT } from 'shared';
import { cn } from '@/lib/cn';
import { clearCanvas, decodeFrameImage, isValidFrameLength } from '@/lib/eink/bpp';
import { StatusBarOverlay } from './StatusBarOverlay';

interface FrameBitmapPreviewProps {
  data?: ArrayBuffer | null;
  caption?: string | null;
  className?: string;
  showStatusBar?: boolean;
  format?: FrameFormatT;
}

export function FrameBitmapPreview({
  data,
  caption,
  className,
  showStatusBar = true,
  format = 'mono1',
}: FrameBitmapPreviewProps) {
  const canvasRef = useContentBitmap(data, format);

  return (
    <div className={cn('relative h-full w-full overflow-hidden bg-paper', className)}>
      <canvas
        ref={canvasRef}
        width={FRAME_WIDTH}
        height={FRAME_HEIGHT}
        className="block h-full w-full"
        style={{ imageRendering: 'pixelated' }}
      />
      {showStatusBar && <StatusBarOverlay caption={caption} />}
    </div>
  );
}

function useContentBitmap(data: ArrayBuffer | null | undefined, format: FrameFormatT) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageData = useMemo(() => decodeContentBitmap(data, format), [data, format]);

  useLayoutEffect(() => {
    drawContentBitmap(canvasRef.current, imageData);
  }, [imageData]);

  return useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node;
  }, []);
}

function drawContentBitmap(canvas: HTMLCanvasElement | null, data: ImageData | null): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (!data) {
    clearCanvas(ctx);
    return;
  }

  ctx.putImageData(data, 0, 0);
}

function decodeContentBitmap(
  data: ArrayBuffer | null | undefined,
  format: FrameFormatT
): ImageData | null {
  if (!data) return null;
  const bytes = new Uint8Array(data);
  if (!isValidFrameLength(bytes, format)) return null;
  return decodeFrameImage(bytes, format);
}
