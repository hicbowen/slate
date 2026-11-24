import { useCallback } from 'react';
import type { BwryPreset } from '@/lib/eink/bwry';
import type { DitherMode } from '@/lib/eink/dither';
import { renderFrames, type CropOptions } from '@/lib/eink/image-preview';

export function useImageFormSubmit({
  imageFile,
  audioFile,
  frameName,
  threshold,
  mode,
  bwryPreset,
  scale,
  offset,
}: {
  imageFile: File | null;
  audioFile: File | null;
  frameName: string;
  threshold: number;
  mode: DitherMode;
  bwryPreset: BwryPreset;
} & CropOptions) {
  return useCallback(async (): Promise<FormData> => {
    const fd = new FormData();
    if (imageFile) {
      const bitmap = await createImageBitmap(imageFile).catch(() => {
        throw new Error('图片无法解码，请换一张图片。');
      });
      try {
        const { mono, color } = renderFrames(bitmap, {
          scale,
          offset,
          threshold,
          mode,
          bwryPreset,
        });
        fd.append(
          'frame',
          new Blob([mono.slice()], { type: 'application/octet-stream' }),
          'frame.bin'
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
    fd.append('frameName', frameName.trim());
    return fd;
  }, [audioFile, bwryPreset, frameName, imageFile, mode, offset, scale, threshold]);
}
