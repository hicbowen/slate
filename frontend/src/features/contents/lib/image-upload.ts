import {
  FrameHeight,
  FrameWidth,
  ImageOriginalMaxBytes,
  type Content,
  type ImageCrop,
} from '@/api';
import {
  normalizeCropOffset,
  renderFrames,
  type CropOptions,
  type DitherSettings,
} from '@/lib/eink/image-preview';

export interface ImageUploadOptions extends CropOptions, DitherSettings {
  imageFile: File | null;
  audioFile?: File | null;
  frameName: string;
  displayMode?: Content['displayMode'];
  keepOriginal?: boolean;
  reuseImageOriginal?: string;
  removeImageOriginal?: boolean;
}

export function canRetainOriginal(file: File) {
  return file.size <= ImageOriginalMaxBytes && /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name);
}

export async function decodeImageFile(file: File) {
  return createImageBitmap(file).catch(() => {
    throw new Error('图片无法解码，请换一张图片。');
  });
}

export async function buildImageUpload({
  imageFile,
  audioFile,
  frameName,
  displayMode,
  keepOriginal,
  reuseImageOriginal,
  removeImageOriginal,
  ...renderOptions
}: ImageUploadOptions): Promise<FormData> {
  const form = new FormData();
  if (imageFile) {
    const bitmap = await decodeImageFile(imageFile);
    try {
      const { mono, gray, color, imageSource } = await renderFrames(bitmap, renderOptions);
      form.append('frame', new Blob([mono.slice()]), 'frame.bin');
      form.append('grayFrame', new Blob([gray.slice()]), 'frame-gray4.bin');
      form.append('colorFrame', new Blob([color.slice()]), 'frame-bwry.bin');
      form.append('imageSource', imageSource, 'source.png');
      form.append('imageRenderPreset', renderOptions.renderPreset);
      if (keepOriginal) {
        const { x, y } = normalizeCropOffset(
          { width: FrameWidth, height: FrameHeight },
          bitmap,
          renderOptions
        );
        const crop: ImageCrop = {
          fit: renderOptions.fit ?? 'contain',
          scale: renderOptions.scale,
          x,
          y,
          dither: renderOptions.mode,
          threshold: renderOptions.threshold,
        };
        form.append('imageCrop', JSON.stringify(crop));
        if (reuseImageOriginal) form.append('reuseImageOriginal', reuseImageOriginal);
        else form.append('imageOriginal', imageFile);
      }
    } finally {
      bitmap.close();
    }
  }
  if (audioFile) form.append('audio', audioFile);
  if (displayMode) form.append('displayMode', displayMode);
  if (removeImageOriginal) form.append('removeImageOriginal', 'true');
  form.append('frameName', frameName.trim());
  return form;
}
