import { useCallback } from 'react';
import type { Content } from '@/api';
import type { ImageRenderPreset } from '@/lib/eink/render-preset';
import type { DitherMode } from '@/lib/eink/dither';
import { renderFrames, type CropOptions } from '@/lib/eink/image-preview';

export function useImageFormSubmit({
  imageFile,
  audioFile,
  frameName,
  displayMode,
  threshold,
  mode,
  renderPreset,
  scale,
  offset,
}: {
  imageFile: File | null;
  audioFile: File | null;
  frameName: string;
  displayMode?: Content['displayMode'];
  threshold: number;
  mode: DitherMode;
  renderPreset: ImageRenderPreset;
} & CropOptions) {
  return useCallback(async (): Promise<FormData> => {
    const fd = new FormData();
    if (imageFile) {
      const bitmap = await createImageBitmap(imageFile).catch(() => {
        throw new Error('图片无法解码，请换一张图片。');
      });
      try {
        const { mono, gray, color } = renderFrames(bitmap, {
          scale,
          offset,
          threshold,
          mode,
          renderPreset,
        });
        fd.append(
          'frame',
          new Blob([mono.slice()], { type: 'application/octet-stream' }),
          'frame.bin'
        );
        fd.append(
          'grayFrame',
          new Blob([gray.slice()], { type: 'application/octet-stream' }),
          'frame-gray4.bin'
        );
        fd.append(
          'colorFrame',
          new Blob([color.slice()], { type: 'application/octet-stream' }),
          'frame-bwry.bin'
        );
      } finally {
        bitmap.close();
      }
    }
    if (audioFile) fd.append('audio', audioFile);
    if (displayMode) fd.append('displayMode', displayMode);
    fd.append('frameName', frameName.trim());
    return fd;
  }, [audioFile, renderPreset, displayMode, frameName, imageFile, mode, offset, scale, threshold]);
}
