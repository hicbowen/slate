// Note4C / SSD2683 的 2bpp 线序：00 黑、01 白、10 黄、11 红。

export const BWRY_PALETTE = [
  [0, 0, 0],
  [255, 255, 255],
  [255, 220, 0],
  [220, 24, 24],
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
export function expandMono1ToBwry2(
  mono: Uint8Array,
  width: number,
  height: number
): Uint8Array {
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
      (((byte >> 3) & 1) << 6) |
      (((byte >> 2) & 1) << 4) |
      (((byte >> 1) & 1) << 2) |
      (byte & 1);
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
