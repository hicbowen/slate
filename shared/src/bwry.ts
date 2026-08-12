// Note4C / SSD2683 的 2bpp 线序：00 黑、01 白、10 黄、11 红。

import { resolveImageRenderPreset, type ImageRenderPreset } from './image-render-preset.js';

export const BWRY_PALETTE = [
  [0, 0, 0],
  [255, 255, 255],
  [255, 220, 0],
  [220, 24, 24],
] as const;

/** 管理端已有的 Note4C 墨色近似值，用于感知量化；后续实测后只需替换这一处。 */
export const BWRY_DEVICE_PALETTE = [
  [20, 17, 13],
  [245, 243, 237],
  [217, 165, 0],
  [185, 43, 39],
] as const;

export type BwryColor = 0 | 1 | 2 | 3;

export interface BwryDitherOptions {
  serpentine?: boolean;
}

/** RGB → 每像素 BWRY 色号，使用 Floyd-Steinberg 误差扩散。 */
export function ditherToBwryPixels(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options: BwryDitherOptions = {}
): Uint8Array {
  if (rgb.length !== width * height * 3) {
    throw new Error(`rgb buffer size mismatch: ${rgb.length} vs ${width * height * 3}`);
  }
  const work = new Float32Array(rgb.length);
  work.set(rgb);
  const out = new Uint8Array(width * height);
  const serpentine = options.serpentine ?? true;

  for (let y = 0; y < height; y++) {
    const reverse = serpentine && (y & 1) === 1;
    const start = reverse ? width - 1 : 0;
    const end = reverse ? -1 : width;
    const step = reverse ? -1 : 1;
    for (let x = start; x !== end; x += step) {
      const pixel = y * width + x;
      const offset = pixel * 3;
      const color = nearestBwry(work[offset]!, work[offset + 1]!, work[offset + 2]!);
      out[pixel] = color;
      const target = BWRY_PALETTE[color];
      const er = work[offset]! - target[0];
      const eg = work[offset + 1]! - target[1];
      const eb = work[offset + 2]! - target[2];

      diffuse(work, width, height, x, y, reverse ? -1 : 1, 0, er, eg, eb, 7 / 16);
      diffuse(work, width, height, x, y, reverse ? 1 : -1, 1, er, eg, eb, 3 / 16);
      diffuse(work, width, height, x, y, 0, 1, er, eg, eb, 5 / 16);
      diffuse(work, width, height, x, y, reverse ? -1 : 1, 1, er, eg, eb, 1 / 16);
    }
  }
  return out;
}

/** RGB → SSD2683 raw 2bpp，4 像素/字节，高位像素在前。 */
export function ditherToBwry2bpp(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options: BwryDitherOptions = {}
): Uint8Array {
  if (width % 4 !== 0) throw new Error(`width must be multiple of 4, got ${width}`);
  return packBwryPixels(ditherToBwryPixels(rgb, width, height, options), width, height);
}

/** 使用照片风格、感知色距和受限误差扩散生成四色像素。 */
export function renderBwryPixels(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  preset: ImageRenderPreset
): Uint8Array {
  if (rgb.length !== width * height * 3) {
    throw new Error(`rgb buffer size mismatch: ${rgb.length} vs ${width * height * 3}`);
  }
  const gray = new Uint8Array(width * height);
  for (let src = 0, dst = 0; src < rgb.length; src += 3, dst++) {
    gray[dst] = (rgb[src]! * 54 + rgb[src + 1]! * 183 + rgb[src + 2]! * 19) >> 8;
  }
  const resolved = resolveImageRenderPreset(gray, width, height, preset);
  if (resolved === 'graphic') return quantizeBwryGraphic(rgb, width, height);
  return quantizeBwryPhoto(rgb, width, height, resolved === 'vivid');
}

export function renderBwry2bpp(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  preset: ImageRenderPreset
): Uint8Array {
  return packBwryPixels(renderBwryPixels(rgb, width, height, preset), width, height);
}

export function packBwryPixels(pixels: Uint8Array, width: number, height: number): Uint8Array {
  if (width % 4 !== 0) throw new Error(`width must be multiple of 4, got ${width}`);
  if (pixels.length !== width * height) {
    throw new Error(`pixel buffer size mismatch: ${pixels.length} vs ${width * height}`);
  }
  const out = new Uint8Array((width * height) / 4);
  for (let i = 0; i < pixels.length; i += 4) {
    out[i >> 2] =
      ((pixels[i]! & 3) << 6) |
      ((pixels[i + 1]! & 3) << 4) |
      ((pixels[i + 2]! & 3) << 2) |
      (pixels[i + 3]! & 3);
  }
  return out;
}

/** 历史 1bpp 内容映射到四彩线序；不会凭空恢复已经丢失的红黄信息。 */
export function expandMono1ToBwry2(mono: Uint8Array, width: number, height: number): Uint8Array {
  if (width % 8 !== 0) throw new Error(`width must be multiple of 8, got ${width}`);
  if (mono.length !== (width * height) / 8) {
    throw new Error(`mono buffer size mismatch: ${mono.length} vs ${(width * height) / 8}`);
  }
  const out = new Uint8Array((width * height) / 4);
  let dst = 0;
  for (const byte of mono) {
    const upper =
      (((byte >> 7) & 1) << 6) |
      (((byte >> 6) & 1) << 4) |
      (((byte >> 5) & 1) << 2) |
      ((byte >> 4) & 1);
    const lower =
      (((byte >> 3) & 1) << 6) | (((byte >> 2) & 1) << 4) | (((byte >> 1) & 1) << 2) | (byte & 1);
    out[dst++] = upper;
    out[dst++] = lower;
  }
  return out;
}

function nearestBwry(r: number, g: number, b: number): BwryColor {
  let best: BwryColor = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let rawIndex = 0; rawIndex < BWRY_PALETTE.length; rawIndex++) {
    const index = rawIndex as BwryColor;
    const target = BWRY_PALETTE[index];
    const dr = r - target[0];
    const dg = g - target[1];
    const db = b - target[2];
    // 绿色通道对感知亮度影响更大；轻微惩罚彩色墨，减少灰阶照片里的伪红/伪黄。
    const chromaPenalty = index >= 2 ? 1800 : 0;
    const distance = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11 + chromaPenalty;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

const DEVICE_LINEAR = BWRY_DEVICE_PALETTE.map((color) => [
  srgbToLinear(color[0]),
  srgbToLinear(color[1]),
  srgbToLinear(color[2]),
]) as readonly (readonly [number, number, number])[];

const DEVICE_OKLAB = DEVICE_LINEAR.map((color) => linearRgbToOklab(color[0], color[1], color[2]));

function quantizeBwryGraphic(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let src = 0, dst = 0; src < rgb.length; src += 3, dst++) {
    const r = srgbToLinear(rgb[src]!);
    const g = srgbToLinear(rgb[src + 1]!);
    const b = srgbToLinear(rgb[src + 2]!);
    out[dst] = nearestPerceptual(r, g, b, !isNeutral(rgb, src), false);
  }
  return out;
}

function quantizeBwryPhoto(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  vivid: boolean
): Uint8Array {
  const work = new Float32Array(rgb.length);
  for (let i = 0; i < rgb.length; i += 3) {
    const source = vivid ? boostSaturation(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!) : null;
    work[i] = srgbToLinear(source ? source[0] : rgb[i]!);
    work[i + 1] = srgbToLinear(source ? source[1] : rgb[i + 1]!);
    work[i + 2] = srgbToLinear(source ? source[2] : rgb[i + 2]!);
  }
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const reverse = (y & 1) === 1;
    const start = reverse ? width - 1 : 0;
    const end = reverse ? -1 : width;
    const step = reverse ? -1 : 1;
    for (let x = start; x !== end; x += step) {
      const pixel = y * width + x;
      const offset = pixel * 3;
      const r = clamp01(work[offset]!);
      const g = clamp01(work[offset + 1]!);
      const b = clamp01(work[offset + 2]!);
      const color = nearestPerceptual(r, g, b, !isNeutral(rgb, offset), vivid);
      out[pixel] = color;
      const target = DEVICE_LINEAR[color]!;
      const edgeScale = isColorEdge(rgb, width, height, x, y) ? 0.2 : 1;
      const er = clampError(r - target[0]) * edgeScale;
      const eg = clampError(g - target[1]) * edgeScale;
      const eb = clampError(b - target[2]) * edgeScale;
      diffuseLinear(work, width, height, x + step, y, er, eg, eb, 7 / 16);
      diffuseLinear(work, width, height, x - step, y + 1, er, eg, eb, 3 / 16);
      diffuseLinear(work, width, height, x, y + 1, er, eg, eb, 5 / 16);
      diffuseLinear(work, width, height, x + step, y + 1, er, eg, eb, 1 / 16);
    }
  }
  return out;
}

function nearestPerceptual(
  r: number,
  g: number,
  b: number,
  allowColor: boolean,
  vivid: boolean
): BwryColor {
  const source = linearRgbToOklab(r, g, b);
  let best: BwryColor = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let raw = 0; raw < DEVICE_OKLAB.length; raw++) {
    const index = raw as BwryColor;
    if (!allowColor && index >= 2) continue;
    const target = DEVICE_OKLAB[index]!;
    const dL = source[0] - target[0];
    const da = source[1] - target[1];
    const db = source[2] - target[2];
    const inkPenalty = index >= 2 ? (vivid ? 0.0005 : 0.004) : 0;
    const distance = dL * dL * 1.2 + da * da + db * db + inkPenalty;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

function diffuseLinear(
  work: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  er: number,
  eg: number,
  eb: number,
  weight: number
): void {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const offset = (y * width + x) * 3;
  work[offset] = clamp01(work[offset]! + er * weight);
  work[offset + 1] = clamp01(work[offset + 1]! + eg * weight);
  work[offset + 2] = clamp01(work[offset + 2]! + eb * weight);
}

function isNeutral(rgb: Uint8Array | Uint8ClampedArray, offset: number): boolean {
  const min = Math.min(rgb[offset]!, rgb[offset + 1]!, rgb[offset + 2]!);
  const max = Math.max(rgb[offset]!, rgb[offset + 1]!, rgb[offset + 2]!);
  return max - min < 24;
}

function isColorEdge(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number
): boolean {
  const center = colorLuma(rgb, y * width + x);
  const left = colorLuma(rgb, y * width + Math.max(0, x - 1));
  const right = colorLuma(rgb, y * width + Math.min(width - 1, x + 1));
  const up = colorLuma(rgb, Math.max(0, y - 1) * width + x);
  const down = colorLuma(rgb, Math.min(height - 1, y + 1) * width + x);
  return Math.max(Math.abs(left - right), Math.abs(up - down), Math.abs(center - left)) >= 48;
}

function colorLuma(rgb: Uint8Array | Uint8ClampedArray, pixel: number): number {
  const offset = pixel * 3;
  return (rgb[offset]! * 54 + rgb[offset + 1]! * 183 + rgb[offset + 2]! * 19) >> 8;
}

function boostSaturation(r: number, g: number, b: number): [number, number, number] {
  const luma = (r * 54 + g * 183 + b * 19) / 256;
  return [
    clamp255(luma + (r - luma) * 1.15),
    clamp255(luma + (g - luma) * 1.15),
    clamp255(luma + (b - luma) * 1.15),
  ];
}

function srgbToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function linearRgbToOklab(r: number, g: number, b: number): readonly [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function clampError(value: number): number {
  return Math.max(-0.35, Math.min(0.35, value));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function diffuse(
  work: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
  er: number,
  eg: number,
  eb: number,
  weight: number
): void {
  const nx = x + dx;
  const ny = y + dy;
  if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
  const offset = (ny * width + nx) * 3;
  work[offset] = clamp(work[offset]! + er * weight);
  work[offset + 1] = clamp(work[offset + 1]! + eg * weight);
  work[offset + 2] = clamp(work[offset + 2]! + eb * weight);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, value));
}
