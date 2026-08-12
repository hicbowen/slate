import {
  BWRY_DEVICE_PALETTE,
  GRAY16_DEVICE_LEVELS,
  ditherToBinary,
  preprocessGrayForPreset,
  quantizeGrayToLevels,
  renderBwryPixels,
  rgbaToGray,
  type FrameFormatT,
  type ImageRenderPreset,
} from 'shared';
import { clearCanvas } from './bpp';
import { INK_RGB, PAPER_RGB, RED_RGB, YELLOW_RGB } from './colors';

export function drawImagePreview(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  {
    scale,
    offset,
    renderPreset,
    format,
    dither,
  }: {
    scale: number;
    offset: { x: number; y: number };
    renderPreset: ImageRenderPreset;
    format: FrameFormatT;
    dither: boolean;
  }
) {
  clearCanvas(ctx, canvas);

  const sourceWidth = img.naturalWidth || img.width;
  const sourceHeight = img.naturalHeight || img.height;
  const baseScale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
  const finalScale = baseScale * scale;
  const drawW = sourceWidth * finalScale;
  const drawH = sourceHeight * finalScale;
  const drawX = (canvas.width - drawW) / 2 + offset.x;
  const drawY = (canvas.height - drawH) / 2 + offset.y;
  ctx.drawImage(img, drawX, drawY, drawW, drawH);

  if (!dither) return;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  if (format === 'bwry2') {
    drawBwryPreview(imageData, canvas.width, canvas.height, renderPreset);
    ctx.putImageData(imageData, 0, 0);
    return;
  }

  let gray = rgbaToGray(imageData.data, canvas.width, canvas.height, 4);
  const prepared = preprocessGrayForPreset(gray, canvas.width, canvas.height, renderPreset);
  gray = prepared.gray;
  if (format === 'gray4') {
    const levels = quantizeGrayToLevels(gray, canvas.width, canvas.height, prepared.resolvedPreset);
    for (let i = 0, j = 0; i < imageData.data.length; i += 4, j++) {
      const value = GRAY16_DEVICE_LEVELS[levels[j]!]!;
      imageData.data[i] = value;
      imageData.data[i + 1] = value;
      imageData.data[i + 2] = value;
      imageData.data[i + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
    return;
  }
  const mode =
    prepared.resolvedPreset === 'graphic'
      ? 'threshold'
      : prepared.resolvedPreset === 'vivid'
        ? 'atkinson'
        : 'floyd';
  const bin = ditherToBinary(gray, canvas.width, canvas.height, { mode, threshold: 128 });

  for (let i = 0, j = 0; i < imageData.data.length; i += 4, j++) {
    const isWhite = bin[j] === 255;
    const color = isWhite ? PAPER_RGB : INK_RGB;
    imageData.data[i] = color[0];
    imageData.data[i + 1] = color[1];
    imageData.data[i + 2] = color[2];
    imageData.data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

function drawBwryPreview(
  imageData: ImageData,
  width: number,
  height: number,
  renderPreset: ImageRenderPreset
): void {
  const rgb = new Uint8Array(width * height * 3);
  for (let src = 0, dst = 0; src < imageData.data.length; src += 4) {
    rgb[dst++] = imageData.data[src]!;
    rgb[dst++] = imageData.data[src + 1]!;
    rgb[dst++] = imageData.data[src + 2]!;
  }
  const pixels = renderBwryPixels(rgb, width, height, renderPreset);
  const previewPalette = [INK_RGB, PAPER_RGB, YELLOW_RGB, RED_RGB] as const;
  for (let i = 0; i < pixels.length; i++) {
    const sourceColor = BWRY_DEVICE_PALETTE[pixels[i]!]!;
    const previewColor = previewPalette[pixels[i]!] ?? sourceColor;
    const offset = i * 4;
    imageData.data[offset] = previewColor[0];
    imageData.data[offset + 1] = previewColor[1];
    imageData.data[offset + 2] = previewColor[2];
    imageData.data[offset + 3] = 255;
  }
}
