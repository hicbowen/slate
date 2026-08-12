import { useCallback } from 'react';
import { FRAME_HEIGHT, FRAME_WIDTH, type ImageDisplayModeT, type ImageRenderPreset } from 'shared';
import { PAPER_HEX } from '@/lib/eink/colors';

export function useImageFormSubmit({
  imageFile,
  audioFile,
  frameName,
  renderPreset,
  scale,
  offset,
  displayMode,
}: {
  imageFile: File | null;
  audioFile: File | null;
  frameName: string;
  renderPreset: ImageRenderPreset;
  scale: number;
  offset: { x: number; y: number };
  displayMode: ImageDisplayModeT;
}) {
  return useCallback(async (): Promise<FormData> => {
    const fd = new FormData();
    if (imageFile) {
      const blob = await exportNormalizedSource(imageFile, scale, offset);
      fd.append('image', blob, 'cropped.png');
    }
    fd.append('render_preset', renderPreset);
    if (audioFile) fd.append('audio', audioFile);
    fd.append('frame_name', frameName.trim());
    fd.append('display_mode', displayMode);
    return fd;
  }, [audioFile, displayMode, frameName, imageFile, offset, renderPreset, scale]);
}

async function exportNormalizedSource(
  file: File,
  scale: number,
  offset: { x: number; y: number }
): Promise<Blob> {
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = FRAME_WIDTH;
    canvas.height = FRAME_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建图片画布。');

    ctx.fillStyle = PAPER_HEX;
    ctx.fillRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    const baseScale = Math.min(FRAME_WIDTH / image.width, FRAME_HEIGHT / image.height);
    const finalScale = baseScale * scale;
    const drawWidth = image.width * finalScale;
    const drawHeight = image.height * finalScale;
    ctx.drawImage(
      image,
      (FRAME_WIDTH - drawWidth) / 2 + offset.x,
      (FRAME_HEIGHT - drawHeight) / 2 + offset.y,
      drawWidth,
      drawHeight
    );
    return await exportCanvasBlob(canvas);
  } finally {
    image.close();
  }
}

function exportCanvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas export failed'))),
      'image/png'
    );
  });
}
