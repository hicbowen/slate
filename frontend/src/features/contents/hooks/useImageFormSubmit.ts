import { useCallback } from 'react';
import { buildImageUpload, type ImageUploadOptions } from '@/features/contents/lib/image-upload';

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
  fit,
  keepOriginal,
  reuseImageOriginal,
  removeImageOriginal,
}: ImageUploadOptions) {
  return useCallback(
    () =>
      buildImageUpload({
        imageFile,
        audioFile,
        frameName,
        displayMode,
        threshold,
        mode,
        renderPreset,
        scale,
        offset,
        fit,
        keepOriginal,
        reuseImageOriginal,
        removeImageOriginal,
      }),
    [
      audioFile,
      renderPreset,
      displayMode,
      frameName,
      imageFile,
      mode,
      offset,
      scale,
      threshold,
      fit,
      keepOriginal,
      reuseImageOriginal,
      removeImageOriginal,
    ]
  );
}
