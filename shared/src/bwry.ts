// Note4C / SSD2683 的 2bpp 线序：00 黑、01 白、10 黄、11 红。

import type { ImageRenderPreset } from './image-render-preset.js';

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

/** 使用分离的彩墨层和明暗层生成四色像素。 */
export function renderBwryPixels(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  preset: ImageRenderPreset
): Uint8Array {
  if (rgb.length !== width * height * 3) {
    throw new Error(`rgb buffer size mismatch: ${rgb.length} vs ${width * height * 3}`);
  }
  const resolved = resolveBwryRenderPreset(rgb, width, height, preset);
  return quantizeBwryLayers(rgb, width, height, resolved);
}

/** 四色图片额外使用彩色边缘统计，避免把连续色调插画一律误判成照片。 */
export function resolveBwryRenderPreset(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  preset: ImageRenderPreset
): Exclude<ImageRenderPreset, 'auto'> {
  if (preset !== 'auto') return preset;
  if (rgb.length !== width * height * 3 || width <= 1 || height <= 1) return 'photo';

  const step = Math.max(1, Math.floor(Math.min(width, height) / 100));
  let samples = 0;
  let edges = 0;
  let hardEdges = 0;
  for (let y = 0; y + step < height; y += step) {
    for (let x = 0; x + step < width; x += step) {
      const pixel = y * width + x;
      const dx = Math.abs(colorLuma(rgb, pixel) - colorLuma(rgb, pixel + step));
      const dy = Math.abs(colorLuma(rgb, pixel) - colorLuma(rgb, pixel + step * width));
      const delta = Math.max(dx, dy);
      if (delta >= 36) edges++;
      if (delta >= 64) hardEdges++;
      samples++;
    }
  }
  const edgeRatio = edges / Math.max(1, samples);
  const hardEdgeRatio = hardEdges / Math.max(1, samples);
  return edgeRatio >= 0.12 || (edgeRatio >= 0.09 && hardEdgeRatio >= 0.06) ? 'graphic' : 'photo';
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

const DEVICE_OKLAB = BWRY_DEVICE_PALETTE.map((color) =>
  linearRgbToOklab(srgbToLinear(color[0]), srgbToLinear(color[1]), srgbToLinear(color[2]))
);

type ResolvedPreset = Exclude<ImageRenderPreset, 'auto'>;

interface LabPlanes {
  l: Float32Array;
  a: Float32Array;
  b: Float32Array;
}

interface InkWeights {
  black: number;
  white: number;
  yellow: number;
  red: number;
}

interface LayerConfig {
  chromaFloor: number;
  chromaFull: number;
  colorBoost: number;
  detail: number;
  smoothDelta: number;
}

const LAYER_CONFIG: Record<ResolvedPreset, LayerConfig> = {
  photo: {
    chromaFloor: 0.04,
    chromaFull: 0.155,
    colorBoost: 0.9,
    detail: 0.5,
    smoothDelta: 0.055,
  },
  vivid: {
    chromaFloor: 0.028,
    chromaFull: 0.125,
    colorBoost: 1.08,
    detail: 0.8,
    smoothDelta: 0.045,
  },
  graphic: {
    chromaFloor: 0.018,
    chromaFull: 0.13,
    colorBoost: 1,
    detail: 1,
    smoothDelta: 0,
  },
};

function quantizeBwryLayers(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  preset: ResolvedPreset
): Uint8Array {
  const lab = createLabPlanes(rgb);
  const filtered = preset === 'graphic' ? lab : smoothLabPlanes(lab, width, height, preset);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const config = LAYER_CONFIG[preset];
      const detailL = filtered.l[index]! + (lab.l[index]! - filtered.l[index]!) * config.detail;
      const weights = separateInkWeights(
        toneLightness(detailL, preset),
        filtered.a[index]!,
        filtered.b[index]!,
        preset
      );
      out[index] = pickInk(weights, x, y, preset);
    }
  }
  return out;
}

function createLabPlanes(rgb: Uint8Array | Uint8ClampedArray): LabPlanes {
  const pixels = rgb.length / 3;
  const l = new Float32Array(pixels);
  const a = new Float32Array(pixels);
  const b = new Float32Array(pixels);
  for (let src = 0, dst = 0; src < rgb.length; src += 3, dst++) {
    const color = linearRgbToOklab(
      srgbToLinear(rgb[src]!),
      srgbToLinear(rgb[src + 1]!),
      srgbToLinear(rgb[src + 2]!)
    );
    l[dst] = color[0];
    a[dst] = color[1];
    b[dst] = color[2];
  }
  return { l, a, b };
}

function smoothLabPlanes(
  source: LabPlanes,
  width: number,
  height: number,
  preset: ResolvedPreset
): LabPlanes {
  const l = new Float32Array(source.l.length);
  const a = new Float32Array(source.a.length);
  const b = new Float32Array(source.b.length);
  const delta = LAYER_CONFIG[preset].smoothDelta;
  const neighbors = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const centerL = source.l[index]!;
      let sumL = centerL * 4;
      let sumA = source.a[index]! * 4;
      let sumB = source.b[index]! * 4;
      let weight = 4;
      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (Math.abs(source.l[neighbor]! - centerL) > delta) continue;
        const neighborWeight = dx === 0 || dy === 0 ? 2 : 1;
        sumL += source.l[neighbor]! * neighborWeight;
        sumA += source.a[neighbor]! * neighborWeight;
        sumB += source.b[neighbor]! * neighborWeight;
        weight += neighborWeight;
      }
      l[index] = sumL / weight;
      a[index] = sumA / weight;
      b[index] = sumB / weight;
    }
  }
  return { l, a, b };
}

/** 把彩墨覆盖率与剩余黑白明暗分开求解，彩墨不再被用作“中间灰”。 */
function separateInkWeights(
  targetL: number,
  sourceA: number,
  sourceB: number,
  preset: ResolvedPreset
): InkWeights {
  const black = DEVICE_OKLAB[0]!;
  const white = DEVICE_OKLAB[1]!;
  const yellow = DEVICE_OKLAB[2]!;
  const red = DEVICE_OKLAB[3]!;
  const neutralMix = clamp01((targetL - black[0]) / (white[0] - black[0]));
  const neutralA = black[1] + (white[1] - black[1]) * neutralMix;
  const neutralB = black[2] + (white[2] - black[2]) * neutralMix;
  const da = sourceA - neutralA;
  const db = sourceB - neutralB;
  const chroma = Math.hypot(da, db);
  const config = LAYER_CONFIG[preset];
  const chromaMix = smoothstep(config.chromaFloor, config.chromaFull, chroma);
  const hue = (Math.atan2(db, da) * 180) / Math.PI;
  const redAffinity = hueAffinity(hue, 25, 18, 45);
  const yellowAffinity = hueAffinity(hue, 86, 20, 60);
  const affinitySum = redAffinity + yellowAffinity;
  let colorCoverage = chromaMix * Math.max(redAffinity, yellowAffinity) * config.colorBoost;
  if (affinitySum <= 0 || colorCoverage <= 0) {
    colorCoverage = 0;
  }
  colorCoverage = clamp01(colorCoverage);

  const yellowRatio = affinitySum > 0 ? yellowAffinity / affinitySum : 0;
  const redRatio = affinitySum > 0 ? redAffinity / affinitySum : 0;
  const colorL = yellow[0] * yellowRatio + red[0] * redRatio;
  if (colorCoverage > 0) {
    const darkLimit = (targetL - black[0]) / Math.max(0.001, colorL - black[0]);
    const lightLimit = (white[0] - targetL) / Math.max(0.001, white[0] - colorL);
    const lumaLimited = Math.min(colorCoverage, clamp01(darkLimit), clamp01(lightLimit));
    const graphicSolidity = preset === 'graphic' ? smoothstep(0.075, 0.145, chroma) : 0;
    colorCoverage = lumaLimited + (colorCoverage - lumaLimited) * graphicSolidity;
  }

  const yellowWeight = colorCoverage * yellowRatio;
  const redWeight = colorCoverage * redRatio;
  const neutralWeight = 1 - colorCoverage;
  const whiteWeight = clampRange(
    (targetL - yellowWeight * yellow[0] - redWeight * red[0] - neutralWeight * black[0]) /
      (white[0] - black[0]),
    0,
    neutralWeight
  );
  return {
    black: neutralWeight - whiteWeight,
    white: whiteWeight,
    yellow: yellowWeight,
    red: redWeight,
  };
}

function pickInk(weights: InkWeights, x: number, y: number, preset: ResolvedPreset): BwryColor {
  const colorCoverage = weights.yellow + weights.red;
  const colorThreshold = ditherThreshold(x, y, 0, preset);
  if (colorThreshold < colorCoverage) {
    const redRatio = colorCoverage > 0 ? weights.red / colorCoverage : 0;
    return ditherThreshold(x, y, 1, preset) < redRatio ? 3 : 2;
  }
  const neutralCoverage = weights.black + weights.white;
  const blackRatio = neutralCoverage > 0 ? weights.black / neutralCoverage : 0;
  return ditherThreshold(x, y, 2, preset) < blackRatio ? 0 : 1;
}

const BAYER_8 = new Uint8Array([
  0, 48, 12, 60, 3, 51, 15, 63, 32, 16, 44, 28, 35, 19, 47, 31, 8, 56, 4, 52, 11, 59, 7, 55, 40, 24,
  36, 20, 43, 27, 39, 23, 2, 50, 14, 62, 1, 49, 13, 61, 34, 18, 46, 30, 33, 17, 45, 29, 10, 58, 6,
  54, 9, 57, 5, 53, 42, 26, 38, 22, 41, 25, 37, 21,
]);

function ditherThreshold(x: number, y: number, seed: number, preset: ResolvedPreset): number {
  if (preset === 'graphic') {
    const sx = (x + seed * 3) & 7;
    const sy = (y + seed * 5) & 7;
    return (BAYER_8[sy * 8 + sx]! + 0.5) / 64;
  }
  const inner = fractional(0.06711056 * (x + seed * 17) + 0.00583715 * (y + seed * 29));
  return fractional(52.9829189 * inner);
}

function toneLightness(value: number, preset: ResolvedPreset): number {
  const l = clamp01(value);
  if (preset === 'photo') {
    const position = clamp01((l - 0.12) / 0.88);
    return clamp01(l + Math.sin(Math.PI * position) * 0.065);
  }
  return l;
}

function hueAffinity(hue: number, center: number, core: number, limit: number): number {
  const distance = angularDistance(hue, center);
  if (distance <= core) return 1;
  if (distance >= limit) return 0;
  return 1 - smoothstep(core, limit, distance);
}

function angularDistance(a: number, b: number): number {
  const distance = Math.abs(a - b) % 360;
  return Math.min(distance, 360 - distance);
}

function smoothstep(low: number, high: number, value: number): number {
  const t = clamp01((value - low) / Math.max(0.0001, high - low));
  return t * t * (3 - 2 * t);
}

function fractional(value: number): number {
  return value - Math.floor(value);
}

function clampRange(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function colorLuma(rgb: Uint8Array | Uint8ClampedArray, pixel: number): number {
  const offset = pixel * 3;
  return (rgb[offset]! * 54 + rgb[offset + 1]! * 183 + rgb[offset + 2]! * 19) >> 8;
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

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
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
