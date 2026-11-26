export const IMAGE_RENDER_PRESETS = ['auto', 'photo', 'vivid', 'graphic'] as const;

export type ImageRenderPreset = (typeof IMAGE_RENDER_PRESETS)[number];

export const DEFAULT_IMAGE_RENDER_PRESET: ImageRenderPreset = 'auto';

export const IMAGE_RENDER_PRESET_INFO: Record<ImageRenderPreset, { label: string; hint: string }> =
  {
    auto: { label: '自动 · 推荐', hint: '自动判断照片或图文' },
    photo: { label: '照片 · 自然', hint: '柔和渐变，减少色带' },
    vivid: { label: '照片 · 鲜明', hint: '加强细节与色彩' },
    graphic: { label: '图文 · 清晰', hint: '保持文字和色块锐利' },
  };

/**
 * 用很轻量的统计区分连续色调图片和少色图文。渐变即使来自插画，也应走照片路径来避免色带。
 */
export function resolveImageRenderPreset(
  gray: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  preset: ImageRenderPreset
): Exclude<ImageRenderPreset, 'auto'> {
  if (preset !== 'auto') return preset;
  if (gray.length !== width * height || width <= 0 || height <= 0) return 'photo';

  const bins = new Uint8Array(16);
  let samples = 0;
  let smooth = 0;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 75));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const value = gray[y * width + x]!;
      bins[value >> 4] = 1;
      samples++;
      if (x + step < width && y + step < height) {
        const dx = Math.abs(value - gray[y * width + x + step]!);
        const dy = Math.abs(value - gray[(y + step) * width + x]!);
        if (dx < 12 && dy < 12) smooth++;
      }
    }
  }
  let occupied = 0;
  for (const value of bins) occupied += value;
  return occupied >= 12 || (occupied >= 8 && smooth / Math.max(1, samples) >= 0.12)
    ? 'photo'
    : 'graphic';
}
