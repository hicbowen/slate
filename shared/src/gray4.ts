import type { ImageRenderPreset } from './image-render-preset.js';

/**
 * 当前 Note4 生产波形的实测归一化亮度，0=黑、255=白。
 * 固件来源：ssd2683_waveform::kVendorGray16MeasuredPermille。
 */
export const GRAY16_DEVICE_LEVELS = new Uint8Array([
  0, 14, 34, 52, 57, 92, 100, 119, 144, 149, 176, 194, 201, 221, 237, 255,
]);

/**
 * 把 8-bit 灰度打包成 SSD2683 使用的 4bpp：高半字节在左，0=黑，15=白。
 */
export function packGrayTo4bpp(gray: Uint8Array, width: number, height: number): Uint8Array {
  if (width <= 0 || height <= 0 || width % 2 !== 0) {
    throw new Error(`gray4 尺寸非法：${width}x${height}`);
  }
  if (gray.length !== width * height) {
    throw new Error(`gray4 像素数不匹配：当前 ${gray.length}，期望 ${width * height}`);
  }
  const out = new Uint8Array((width * height) / 2);
  for (let src = 0, dst = 0; src < gray.length; src += 2, dst++) {
    const left = Math.min(15, Math.floor((gray[src]! * 15 + 127) / 255));
    const right = Math.min(15, Math.floor((gray[src + 1]! * 15 + 127) / 255));
    out[dst] = (left << 4) | right;
  }
  return out;
}

/** 使用实机灰阶响应和风格预设把 8-bit 灰度量化为 gray4。 */
export function quantizeGrayTo4bpp(
  gray: Uint8Array,
  width: number,
  height: number,
  preset: Exclude<ImageRenderPreset, 'auto'>
): Uint8Array {
  if (width <= 0 || height <= 0 || width % 2 !== 0) {
    throw new Error(`gray4 尺寸非法：${width}x${height}`);
  }
  if (gray.length !== width * height) {
    throw new Error(`gray4 像素数不匹配：当前 ${gray.length}，期望 ${width * height}`);
  }
  const levels =
    preset === 'graphic'
      ? quantizeNearest(gray)
      : preset === 'vivid'
        ? quantizeErrorDiffusion(gray, width, height)
        : quantizeFineNoise(gray, width, height);
  return packGrayLevels(levels);
}

/** 前端实机近似预览使用，返回每像素 0..15 灰阶编号。 */
export function quantizeGrayToLevels(
  gray: Uint8Array,
  width: number,
  height: number,
  preset: Exclude<ImageRenderPreset, 'auto'>
): Uint8Array {
  if (gray.length !== width * height) {
    throw new Error(`gray4 像素数不匹配：当前 ${gray.length}，期望 ${width * height}`);
  }
  if (preset === 'graphic') return quantizeNearest(gray);
  if (preset === 'vivid') return quantizeErrorDiffusion(gray, width, height);
  return quantizeFineNoise(gray, width, height);
}

function quantizeNearest(gray: Uint8Array): Uint8Array {
  const out = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) out[i] = nearestLevel(gray[i]!);
  return out;
}

function quantizeFineNoise(gray: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(gray.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const value = gray[index]!;
      if (isStrongEdge(gray, width, height, x, y)) {
        out[index] = nearestLevel(value);
        continue;
      }
      const { lower, upper, mix } = bracket(value);
      out[index] = upper === lower || fineNoise(x, y) >= mix ? lower : upper;
    }
  }
  return out;
}

function quantizeErrorDiffusion(gray: Uint8Array, width: number, height: number): Uint8Array {
  const work = new Float32Array(gray.length);
  work.set(gray);
  const out = new Uint8Array(gray.length);
  for (let y = 0; y < height; y++) {
    const reverse = (y & 1) === 1;
    const start = reverse ? width - 1 : 0;
    const end = reverse ? -1 : width;
    const step = reverse ? -1 : 1;
    for (let x = start; x !== end; x += step) {
      const index = y * width + x;
      const value = clamp(work[index]!);
      const level = nearestLevel(value);
      out[index] = level;
      const error = Math.max(-48, Math.min(48, value - GRAY16_DEVICE_LEVELS[level]!));
      diffuseGray(work, width, height, x + step, y, error * 0.5);
      diffuseGray(work, width, height, x - step, y + 1, error * 0.25);
      diffuseGray(work, width, height, x, y + 1, error * 0.25);
    }
  }
  return out;
}

function bracket(value: number): { lower: number; upper: number; mix: number } {
  for (let upper = 1; upper < GRAY16_DEVICE_LEVELS.length; upper++) {
    const high = GRAY16_DEVICE_LEVELS[upper]!;
    if (value <= high) {
      const lower = upper - 1;
      const low = GRAY16_DEVICE_LEVELS[lower]!;
      return { lower, upper, mix: (value - low) / Math.max(1, high - low) };
    }
  }
  return { lower: 15, upper: 15, mix: 0 };
}

function nearestLevel(value: number): number {
  const { lower, upper, mix } = bracket(value);
  return mix < 0.5 ? lower : upper;
}

// Interleaved-gradient threshold：无 Bayer 网格，且比逐像素白噪声少低频色块。
function fineNoise(x: number, y: number): number {
  const inner = fractional(0.06711056 * x + 0.00583715 * y);
  return fractional(52.9829189 * inner);
}

function fractional(value: number): number {
  return value - Math.floor(value);
}

function isStrongEdge(
  gray: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number
): boolean {
  const center = gray[y * width + x]!;
  const left = x > 0 ? gray[y * width + x - 1]! : center;
  const right = x + 1 < width ? gray[y * width + x + 1]! : center;
  const up = y > 0 ? gray[(y - 1) * width + x]! : center;
  const down = y + 1 < height ? gray[(y + 1) * width + x]! : center;
  return Math.max(Math.abs(left - right), Math.abs(up - down)) >= 40;
}

function diffuseGray(
  work: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  error: number
): void {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  const index = y * width + x;
  work[index] = clamp(work[index]! + error);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function packGrayLevels(levels: Uint8Array): Uint8Array {
  const out = new Uint8Array(levels.length / 2);
  for (let src = 0, dst = 0; src < levels.length; src += 2, dst++) {
    out[dst] = (levels[src]! << 4) | levels[src + 1]!;
  }
  return out;
}

/** 将 mono1（bit=1 白）无损扩展为合法 gray4，供旧图片降级兼容。 */
export function expandMono1ToGray4(mono: Uint8Array, width: number, height: number): Uint8Array {
  const expected = (width * height) / 8;
  if (width <= 0 || height <= 0 || width % 8 !== 0 || mono.length !== expected) {
    throw new Error(`mono1 帧大小不匹配：当前 ${mono.length}，期望 ${expected}`);
  }
  const out = new Uint8Array((width * height) / 2);
  let dst = 0;
  for (const byte of mono) {
    for (let shift = 6; shift >= 0; shift -= 2) {
      const left = byte & (1 << (shift + 1)) ? 0xf : 0x0;
      const right = byte & (1 << shift) ? 0xf : 0x0;
      out[dst++] = (left << 4) | right;
    }
  }
  return out;
}
