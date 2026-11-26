// Note4C / SSD2683 的 2bpp 线序：00 黑、01 白、10 黄、11 红。

import type { ImageRenderPreset } from './render-preset';

/** 管理端已有的 Note4C 墨色近似值，用于感知量化；后续实测后只需替换这一处。 */
export const BWRY_DEVICE_PALETTE = [
  [20, 17, 13],
  [245, 243, 237],
  [217, 165, 0],
  [185, 43, 39],
] as const;

type BwryColor = 0 | 1 | 2 | 3;

/** 使用分离的彩墨层和明暗层生成四色像素。 */
function renderBwryPixels(
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
function resolveBwryRenderPreset(
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
  let paper = 0;
  for (let y = 0; y + step < height; y += step) {
    for (let x = 0; x + step < width; x += step) {
      const pixel = y * width + x;
      const offset = pixel * 3;
      const min = Math.min(rgb[offset]!, rgb[offset + 1]!, rgb[offset + 2]!);
      const max = Math.max(rgb[offset]!, rgb[offset + 1]!, rgb[offset + 2]!);
      if (min >= 250 && max - min <= 8) paper++;
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
  const paperRatio = paper / Math.max(1, samples);
  return paperRatio >= 0.45 || edgeRatio >= 0.12 || (edgeRatio >= 0.09 && hardEdgeRatio >= 0.06)
    ? 'graphic'
    : 'photo';
}

export function renderBwry2bpp(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  preset: ImageRenderPreset
): Uint8Array {
  return packBwryPixels(renderBwryPixels(rgb, width, height, preset), width, height);
}

function packBwryPixels(pixels: Uint8Array, width: number, height: number): Uint8Array {
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
  flatnessStart: number;
  flatColorStart: number;
  flatColorFull: number;
}

const LAYER_CONFIG: Record<ResolvedPreset, LayerConfig> = {
  photo: {
    chromaFloor: 0.04,
    chromaFull: 0.155,
    colorBoost: 0.9,
    detail: 0.5,
    smoothDelta: 0.055,
    flatnessStart: 0.82,
    flatColorStart: 0.68,
    flatColorFull: 0.8,
  },
  vivid: {
    chromaFloor: 0.028,
    chromaFull: 0.125,
    colorBoost: 1.08,
    detail: 0.8,
    smoothDelta: 0.045,
    flatnessStart: 0.7,
    flatColorStart: 0.58,
    flatColorFull: 0.72,
  },
  graphic: {
    chromaFloor: 0.065,
    chromaFull: 0.145,
    colorBoost: 1,
    detail: 0.25,
    smoothDelta: 0.06,
    flatnessStart: 0.55,
    flatColorStart: 0.45,
    flatColorFull: 0.62,
  },
};

// 16x16 void-and-cluster rank tile。每个 16x16 区块恰好覆盖一次 0..255，
// 区块间再做旋转/镜像，既保持局部蓝噪声分布，也避免整屏出现固定斜纹。
const BLUE_NOISE_RANK_16 = new Uint8Array([
  172, 28, 84, 122, 191, 90, 46, 119, 27, 59, 112, 10, 170, 68, 16, 143, 216, 105, 204, 15, 54, 245,
  214, 78, 167, 221, 94, 236, 130, 211, 100, 45, 120, 66, 239, 177, 153, 109, 11, 136, 192, 17, 146,
  52, 159, 76, 193, 235, 161, 8, 141, 39, 81, 226, 163, 37, 242, 85, 205, 35, 248, 1, 150, 32, 252,
  189, 96, 200, 134, 61, 185, 99, 55, 131, 173, 104, 187, 117, 89, 58, 108, 72, 228, 24, 213, 2,
  254, 124, 219, 9, 232, 71, 20, 224, 206, 176, 140, 31, 125, 56, 169, 113, 77, 30, 160, 199, 43,
  144, 166, 129, 47, 13, 218, 181, 244, 152, 91, 233, 179, 142, 63, 87, 115, 249, 29, 82, 240, 157,
  95, 51, 110, 18, 198, 49, 22, 210, 237, 184, 50, 175, 217, 107, 194, 69, 5, 230, 190, 83, 222,
  139, 102, 121, 12, 97, 151, 3, 133, 57, 23, 126, 174, 132, 34, 155, 7, 60, 250, 164, 41, 207, 243,
  80, 186, 156, 255, 203, 148, 64, 246, 116, 212, 178, 88, 196, 75, 137, 111, 26, 229, 42, 98, 74,
  234, 40, 93, 168, 73, 38, 149, 25, 223, 53, 165, 202, 65, 123, 215, 21, 106, 209, 188, 19, 241,
  127, 231, 114, 183, 14, 238, 101, 145, 6, 158, 182, 128, 4, 138, 62, 103, 201, 0, 67, 92, 135, 36,
  79, 180, 247, 86, 48, 70, 251, 162, 225, 33, 147, 171, 208, 253, 154, 195, 220, 44, 118, 227, 197,
]);

const BLUE_NOISE_OFFSETS = [
  [0, 0],
  [5, 9],
  [11, 3],
] as const;

function quantizeBwryLayers(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  preset: ResolvedPreset
): Uint8Array {
  const lab = createLabPlanes(rgb);
  const firstPass = smoothLabPlanes(lab, width, height, preset);
  const filtered =
    preset === 'graphic' ? smoothLabPlanes(firstPass, width, height, preset) : firstPass;
  const flatness = createFlatnessPlane(lab, width, height);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const config = LAYER_CONFIG[preset];
      const detailL = filtered.l[index]! + (lab.l[index]! - filtered.l[index]!) * config.detail;
      const targetL = toneLightness(detailL, preset);
      let weights = separateInkWeights(targetL, filtered.a[index]!, filtered.b[index]!, preset);
      weights = protectFlatColor(
        weights,
        flatness[index]!,
        targetL,
        filtered.a[index]!,
        filtered.b[index]!,
        preset
      );
      out[index] = pickInk(weights, x, y);
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

/**
 * 估算每个像素周围的局部平坦度。使用原始 OKLab 而不是滤波结果，防止边缘被平滑后
 * 误判为色块内部；亮度和色度任一变化明显都会降低保护强度。
 */
function createFlatnessPlane(source: LabPlanes, width: number, height: number): Float32Array {
  const flatness = new Float32Array(source.l.length);
  const neighbors = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      let variation = 0;
      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const neighbor = ny * width + nx;
        const deltaL = Math.abs(source.l[index]! - source.l[neighbor]!);
        const deltaA = source.a[index]! - source.a[neighbor]!;
        const deltaB = source.b[index]! - source.b[neighbor]!;
        variation = Math.max(variation, deltaL + Math.hypot(deltaA, deltaB) * 0.65);
      }
      flatness[index] = 1 - smoothstep(0.008, 0.05, variation);
    }
  }
  return flatness;
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
  let redAffinity = hueAffinity(hue, 25, 18, 45);
  let yellowAffinity = hueAffinity(hue, 86, 20, 60);
  if (redAffinity < yellowAffinity * 0.25) redAffinity = 0;
  if (yellowAffinity < redAffinity * 0.25) yellowAffinity = 0;
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

/**
 * 高彩度且局部平坦的暖色色块优先使用红/黄彩墨本身表达，逐渐压低其中的纸白和黑点。
 * 低彩度、肤色、暖灰以及纹理/边缘仍保留原有明暗层，不会被强制染成红黄。
 */
function protectFlatColor(
  weights: InkWeights,
  flatness: number,
  targetL: number,
  sourceA: number,
  sourceB: number,
  preset: ResolvedPreset
): InkWeights {
  const colorCoverage = weights.yellow + weights.red;
  const neutralCoverage = weights.black + weights.white;
  if (colorCoverage <= 0 || neutralCoverage <= 0) return weights;

  const config = LAYER_CONFIG[preset];
  const strength =
    smoothstep(config.flatnessStart, 1, flatness) *
    smoothstep(config.flatColorStart, config.flatColorFull, colorCoverage);
  if (strength <= 0) return weights;

  const protectedCoverage = colorCoverage + (1 - colorCoverage) * strength;
  const black = DEVICE_OKLAB[0]!;
  const white = DEVICE_OKLAB[1]!;
  const neutralMix = clamp01((targetL - black[0]) / (white[0] - black[0]));
  const hue =
    (Math.atan2(
      sourceB - (black[2] + (white[2] - black[2]) * neutralMix),
      sourceA - (black[1] + (white[1] - black[1]) * neutralMix)
    ) *
      180) /
    Math.PI;
  const hueRedMix = 1 - smoothstep(42, 78, hue);
  const lumaFactor = 0.3 + 0.7 * clamp01((0.92 - targetL) / 0.22);
  const protectedRedRatio = clamp01(hueRedMix * lumaFactor);
  const originalRedRatio = weights.red / colorCoverage;
  const redRatio = originalRedRatio + (protectedRedRatio - originalRedRatio) * strength;
  const neutralScale = (1 - protectedCoverage) / neutralCoverage;
  return {
    black: weights.black * neutralScale,
    white: weights.white * neutralScale,
    yellow: protectedCoverage * (1 - redRatio),
    red: protectedCoverage * redRatio,
  };
}

function pickInk(weights: InkWeights, x: number, y: number): BwryColor {
  const colorCoverage = weights.yellow + weights.red;
  const colorThreshold = ditherThreshold(x, y, 0);
  if (colorThreshold < colorCoverage) {
    const redRatio = colorCoverage > 0 ? weights.red / colorCoverage : 0;
    return ditherThreshold(x, y, 1) < redRatio ? 3 : 2;
  }
  const neutralCoverage = weights.black + weights.white;
  const blackRatio = neutralCoverage > 0 ? weights.black / neutralCoverage : 0;
  return ditherThreshold(x, y, 2) < blackRatio ? 0 : 1;
}

/** 从蓝噪声 rank tile 取阈值；分层使用不同偏移，区块使用不同朝向以降低重复纹理。 */
function ditherThreshold(x: number, y: number, seed: number): number {
  const blockX = x >> 4;
  const blockY = y >> 4;
  let localX = x & 15;
  let localY = y & 15;
  const transform =
    (Math.imul(blockX + seed * 17, 0x45d9f3b) ^ Math.imul(blockY + seed * 29, 0x119de1f3)) & 7;
  if (transform & 1) [localX, localY] = [localY, localX];
  if (transform & 2) localX = 15 - localX;
  if (transform & 4) localY = 15 - localY;
  const offset = BLUE_NOISE_OFFSETS[seed] ?? BLUE_NOISE_OFFSETS[0];
  localX = (localX + offset[0]) & 15;
  localY = (localY + offset[1]) & 15;
  return (BLUE_NOISE_RANK_16[localY * 16 + localX]! + 0.5) / 256;
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
