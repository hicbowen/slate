import { ColorFrameFormat, DisplayModeMono, FrameHeight, FrameWidth, GrayFrameFormat } from '@/api';
import { ditherTo1bpp, ditherToBinary, type DitherMode } from './dither';
import { autoContrast, autoInvert, preprocessGrayForPreset, rgbaToGray } from './preprocess';
import { renderBwry2bpp } from './bwry';
import { quantizeGrayTo4bpp } from './gray4';
import type { ImageRenderPreset } from './render-preset';
import { clearCanvas, decodeBppImage } from './bpp';
import { INK_RGB, PAPER_RGB } from './colors';

export interface CropOptions {
  scale: number;
  offset: { x: number; y: number };
}

export interface DitherSettings {
  threshold: number;
  mode: DitherMode;
  renderPreset: ImageRenderPreset;
}

type Source = HTMLImageElement | ImageBitmap;
export type ImageFrameFormat =
  typeof DisplayModeMono | typeof GrayFrameFormat | typeof ColorFrameFormat;

/** Draws the crop onto the preview canvas, dithered to ink and paper when `dither` is set. */
export function drawImagePreview(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  img: Source,
  {
    dither,
    format,
    ...options
  }: CropOptions & DitherSettings & { dither: boolean; format: ImageFrameFormat }
) {
  drawCrop(ctx, canvas, img, options, format !== 'mono1');
  if (!dither) return;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (format !== 'mono1') {
    const packed =
      format === 'gray4'
        ? grayFrame(imageData, options.renderPreset)
        : colorFrame(imageData, options.renderPreset);
    ctx.putImageData(decodeBppImage(packed, canvas.width, canvas.height), 0, 0);
    return;
  }
  const bin = ditherToBinary(preprocess(imageData, canvas), canvas.width, canvas.height, options);
  for (let i = 0, j = 0; i < imageData.data.length; i += 4, j++) {
    const color = bin[j] === 255 ? PAPER_RGB : INK_RGB;
    imageData.data[i] = color[0];
    imageData.data[i + 1] = color[1];
    imageData.data[i + 2] = color[2];
    imageData.data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

/**
 * Renders packed device frames from the same 400×300 crop.
 * This is what gets uploaded; the server stores it as is.
 */
export function renderFrames(img: Source, options: CropOptions & DitherSettings) {
  const canvas = document.createElement('canvas');
  canvas.width = FrameWidth;
  canvas.height = FrameHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2d context unavailable');
  drawCrop(ctx, canvas, img, options);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const mono = ditherTo1bpp(preprocess(imageData, canvas), canvas.width, canvas.height, options);
  drawCrop(ctx, canvas, img, options, true);
  const source = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    mono,
    gray: grayFrame(source, options.renderPreset),
    color: colorFrame(source, options.renderPreset),
  };
}

function grayFrame({ data, width, height }: ImageData, preset: ImageRenderPreset): Uint8Array {
  const prepared = preprocessGrayForPreset(rgbaToGray(data, width, height), width, height, preset);
  return quantizeGrayTo4bpp(prepared.gray, width, height, prepared.resolvedPreset);
}

function colorFrame({ data, width, height }: ImageData, preset: ImageRenderPreset): Uint8Array {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i]!;
    rgb[j + 1] = data[i + 1]!;
    rgb[j + 2] = data[i + 2]!;
  }
  return renderBwry2bpp(rgb, width, height, preset);
}

function drawCrop(
  ctx: CanvasRenderingContext2D,
  canvas: { width: number; height: number },
  img: Source,
  { scale, offset }: CropOptions,
  whiteBackground = false
) {
  if (whiteBackground) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    clearCanvas(ctx, canvas);
  }
  const sourceWidth = img instanceof HTMLImageElement ? img.naturalWidth || img.width : img.width;
  const sourceHeight =
    img instanceof HTMLImageElement ? img.naturalHeight || img.height : img.height;
  const finalScale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight) * scale;
  const drawW = sourceWidth * finalScale;
  const drawH = sourceHeight * finalScale;
  const drawX = (canvas.width - drawW) / 2 + offset.x;
  const drawY = (canvas.height - drawH) / 2 + offset.y;
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
}

function preprocess(imageData: ImageData, canvas: { width: number; height: number }): Uint8Array {
  const gray = autoInvert(
    rgbaToGray(imageData.data, canvas.width, canvas.height, 4),
    canvas.width,
    canvas.height
  );
  return autoContrast(gray, 1);
}
