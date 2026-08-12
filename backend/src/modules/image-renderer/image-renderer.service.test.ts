import { afterAll, beforeAll, describe, it, expect } from 'bun:test';
import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import {
  FRAME_BYTES,
  FRAME_BYTES_BWRY2,
  FRAME_BYTES_GRAY4,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  renderBwryPixels,
  resolveBwryRenderPreset,
} from 'shared';
import { ImageRendererService } from './image-renderer.service';
import { ImageRenderCacheService } from './image-render-cache.service';

let tmp = '';
let cache: ImageRenderCacheService;
let renderer: ImageRendererService;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'render-test-'));
  cache = new ImageRenderCacheService({ blobDir: tmp } as never);
  renderer = new ImageRendererService(cache);
});

afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

async function makePng(
  width: number,
  height: number,
  fill: { r: number; g: number; b: number }
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: fill },
  })
    .png()
    .toBuffer();
}

describe('ImageRendererService', () => {
  it('白图渲染后全白(全 0xff)', async () => {
    const input = await makePng(800, 600, { r: 255, g: 255, b: 255 });
    const { data, width, height } = await renderer.renderTo1bpp(input);
    expect(width).toBe(FRAME_WIDTH);
    expect(height).toBe(FRAME_HEIGHT);
    expect(data.length).toBe(FRAME_BYTES);
    expect(data.every((b) => b === 0xff)).toBe(true);
  });

  it('四色图按 SSD2683 线序输出黑白红黄', async () => {
    const input = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 220, g: 24, b: 24 } },
    })
      .png()
      .toBuffer();
    const { data } = await renderer.renderTo2bpp(input);
    expect(data.length).toBe(FRAME_BYTES_BWRY2);
    expect(data.every((byte) => byte === 0xff)).toBe(true);
  });

  it('16 灰图按高 nibble 在前输出 4bpp，0 黑/15 白', async () => {
    const white = await makePng(400, 300, { r: 255, g: 255, b: 255 });
    const black = await makePng(400, 300, { r: 0, g: 0, b: 0 });
    const whiteFrame = await renderer.renderTo4bppGray(white, { autoInvert: false });
    const blackFrame = await renderer.renderTo4bppGray(black, { autoInvert: false });

    expect(whiteFrame.data.length).toBe(FRAME_BYTES_GRAY4);
    expect(whiteFrame.data.every((byte) => byte === 0xff)).toBe(true);
    expect(blackFrame.data.every((byte) => byte === 0x00)).toBe(true);
    expect(() => renderer.validateGrayFrameSize(whiteFrame.data)).not.toThrow();
    expect(() => renderer.validateGrayFrameSize(Buffer.alloc(100))).toThrow();
  });

  it('16 灰照片会在实机相邻灰阶间混合以填补亮度空洞', async () => {
    const input = await makePng(400, 300, { r: 74, g: 74, b: 74 });
    const { data } = await renderer.renderTo4bppGray(input, { preset: 'photo' });
    const levels = new Set<number>();
    for (const byte of data) {
      levels.add(byte >> 4);
      levels.add(byte & 0x0f);
    }
    expect(levels).toEqual(new Set([4, 5]));
  });

  it('16 灰图文模式按实机响应选择最近灰阶并保持纯色块', async () => {
    const input = await makePng(400, 300, { r: 200, g: 200, b: 200 });
    const { data } = await renderer.renderTo4bppGray(input, { preset: 'graphic' });
    expect(data.every((byte) => byte === 0xcc)).toBe(true);
  });

  it('四色照片对中性灰启用黑白保护，不产生伪红或伪黄', async () => {
    const input = await makePng(400, 300, { r: 128, g: 128, b: 128 });
    const { data } = await renderer.renderTo2bpp(input, { preset: 'photo' });
    expect(data.every((byte) => (byte & 0xaa) === 0)).toBe(true);
  });

  it('四色照片不会把低彩度暖灰当成黄色中间调', async () => {
    const input = await makePng(400, 300, { r: 180, g: 165, b: 150 });
    const { data } = await renderer.renderTo2bpp(input, { preset: 'photo' });
    expect(data.every((byte) => (byte & 0xaa) === 0)).toBe(true);
  });

  it('四色照片的低彩度棕色不混入红墨来代替暗部', async () => {
    const input = await makePng(400, 300, { r: 180, g: 130, b: 80 });
    const { data } = await renderer.renderTo2bpp(input, { preset: 'photo' });
    const colors = new Set<number>();
    for (const byte of data) {
      colors.add(byte & 0x03);
      colors.add((byte >> 2) & 0x03);
      colors.add((byte >> 4) & 0x03);
      colors.add((byte >> 6) & 0x03);
    }
    expect(colors.has(2)).toBe(true);
    expect(colors.has(3)).toBe(false);
  });

  it('四色鲜明模式保留纯红色块', async () => {
    const input = await makePng(400, 300, { r: 185, g: 43, b: 39 });
    const { data } = await renderer.renderTo2bpp(input, { preset: 'vivid' });
    expect(data.every((byte) => byte === 0xff)).toBe(true);
  });

  it('四色鲜明模式保留纯黄色块', async () => {
    const input = await makePng(400, 300, { r: 217, g: 165, b: 0 });
    const { data } = await renderer.renderTo2bpp(input, { preset: 'vivid' });
    expect(data.every((byte) => byte === 0xaa)).toBe(true);
  });

  it('四色照片把不支持的蓝色降级为黑白明暗，不凭空加入暖色', async () => {
    const input = await makePng(400, 300, { r: 40, g: 110, b: 200 });
    const { data } = await renderer.renderTo2bpp(input, { preset: 'photo' });
    expect(data.every((byte) => (byte & 0xaa) === 0)).toBe(true);
  });

  it('四色自动模式能区分连续渐变照片与高边缘图文', () => {
    const width = 120;
    const height = 90;
    const gradient = new Uint8Array(width * height * 3);
    const graphic = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 3;
        const gray = Math.round((x / (width - 1)) * 255);
        gradient[offset] = gray;
        gradient[offset + 1] = gray;
        gradient[offset + 2] = gray;
        const block = ((x >> 3) + (y >> 3)) & 1 ? 255 : 0;
        graphic[offset] = block;
        graphic[offset + 1] = block;
        graphic[offset + 2] = block;
      }
    }
    expect(resolveBwryRenderPreset(gradient, width, height, 'auto')).toBe('photo');
    expect(resolveBwryRenderPreset(graphic, width, height, 'auto')).toBe('graphic');
  });

  it('四色自动图文对浅黄平坦色块使用实色而不是纸白噪点', () => {
    const width = 120;
    const height = 90;
    const rgb = new Uint8Array(width * height * 3);
    rgb.fill(255);
    for (let y = 20; y < 70; y++) {
      for (let x = 30; x < 90; x++) {
        const offset = (y * width + x) * 3;
        rgb[offset] = 254;
        rgb[offset + 1] = 220;
        rgb[offset + 2] = 102;
      }
    }
    expect(resolveBwryRenderPreset(rgb, width, height, 'auto')).toBe('graphic');
    const pixels = renderBwryPixels(rgb, width, height, 'auto');
    const blockColors = new Set<number>();
    for (let y = 22; y < 68; y++) {
      for (let x = 32; x < 88; x++) blockColors.add(pixels[y * width + x]!);
    }
    expect(blockColors).toEqual(new Set([2]));
  });

  it('四色图文使用红黄彩墨合成橙色而不掺入纸白', () => {
    const width = 64;
    const height = 64;
    const rgb = new Uint8Array(width * height * 3);
    for (let offset = 0; offset < rgb.length; offset += 3) {
      rgb[offset] = 253;
      rgb[offset + 1] = 159;
      rgb[offset + 2] = 42;
    }
    const colors = new Set(renderBwryPixels(rgb, width, height, 'graphic'));
    expect(colors).toEqual(new Set([2, 3]));
  });

  it('黑图(autoInvert 触发) 仍是白', async () => {
    const input = await makePng(800, 600, { r: 0, g: 0, b: 0 });
    const { data } = await renderer.renderTo1bpp(input);
    expect(data.every((b) => b === 0xff)).toBe(true);
  });

  it('autoInvert=false 时全黑图保持全黑(全 0x00)', async () => {
    const input = await makePng(800, 600, { r: 0, g: 0, b: 0 });
    const { data } = await renderer.renderTo1bpp(input, { autoInvert: false });
    expect(data.every((b) => b === 0x00)).toBe(true);
  });

  it('size 验证', async () => {
    const input = await makePng(100, 100, { r: 128, g: 128, b: 128 });
    const { data } = await renderer.renderTo1bpp(input);
    expect(() => renderer.validateFrameSize(data)).not.toThrow();
    expect(() => renderer.validateFrameSize(Buffer.alloc(100))).toThrow();
  });

  it('width 不是 8 的倍数时报错', async () => {
    const input = await makePng(100, 100, { r: 0, g: 0, b: 0 });
    await expect(renderer.renderTo1bpp(input, { width: 401, height: 300 })).rejects.toThrow(
      /8 的倍数/
    );
  });

  it('mode 默认为 threshold(向后兼容)', async () => {
    const input = await makePng(400, 300, { r: 255, g: 255, b: 255 });
    const { data: defaultData } = await renderer.renderTo1bpp(input);
    const { data: explicitData } = await renderer.renderTo1bpp(input, {
      mode: 'threshold',
    });
    expect(Buffer.compare(defaultData, explicitData)).toBe(0);
  });

  it('atkinson 全黑图(autoInvert off) 输出全黑', async () => {
    const input = await makePng(400, 300, { r: 0, g: 0, b: 0 });
    const { data } = await renderer.renderTo1bpp(input, {
      mode: 'atkinson',
      autoInvert: false,
    });
    expect(data.every((b) => b === 0x00)).toBe(true);
  });

  it('bayer8 全白图输出全白', async () => {
    const input = await makePng(400, 300, { r: 255, g: 255, b: 255 });
    const { data } = await renderer.renderTo1bpp(input, { mode: 'bayer8' });
    expect(data.every((b) => b === 0xff)).toBe(true);
  });

  it('同图二次渲染应命中缓存（fromCache=true）', async () => {
    const input = await makePng(400, 300, { r: 32, g: 64, b: 128 });
    const r1 = await renderer.renderTo1bpp(input, { mode: 'floyd' });
    expect(r1.fromCache).toBe(false);
    const r2 = await renderer.renderTo1bpp(input, { mode: 'floyd' });
    expect(r2.fromCache).toBe(true);
    expect(Buffer.compare(r1.data, r2.data)).toBe(0);
  });

  it('同 key 并发未命中时只执行一次 compute', async () => {
    const localCache = new ImageRenderCacheService({ blobDir: tmp } as never);
    const key = `concurrent-${Date.now()}`;
    let calls = 0;

    const [first, second] = await Promise.all([
      localCache.getOrCompute(key, async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return Buffer.from('cached');
      }),
      localCache.getOrCompute(key, async () => {
        calls += 1;
        return Buffer.from('duplicate');
      }),
    ]);

    expect(calls).toBe(1);
    expect([first.fromCache, second.fromCache].sort()).toEqual([false, true]);
    expect(first.data.toString()).toBe(second.data.toString());
  });

  it('compute 失败后清理 in-flight entry，后续请求可重新计算', async () => {
    const localCache = new ImageRenderCacheService({ blobDir: tmp } as never);
    const key = `retry-after-failure-${Date.now()}`;
    let calls = 0;

    await expect(
      localCache.getOrCompute(key, async () => {
        calls += 1;
        throw new Error('render failed');
      })
    ).rejects.toThrow('render failed');

    const result = await localCache.getOrCompute(key, async () => {
      calls += 1;
      return Buffer.from('recovered');
    });

    expect(calls).toBe(2);
    expect(result.fromCache).toBe(false);
    expect(result.data.toString()).toBe('recovered');
  });

  it('cache path resolves relative blobDir to an absolute root', () => {
    const localCache = new ImageRenderCacheService({ blobDir: './relative-blobs' } as never);
    const path = localCache.path('abcdef');

    expect(isAbsolute(path)).toBe(true);
    expect(path).toBe(resolve('./relative-blobs/image-render-cache/ab/abcdef.bin'));
  });

  it('opts 不同 → key 不同 → fromCache=false', async () => {
    const input = await makePng(400, 300, { r: 100, g: 100, b: 100 });
    const r1 = await renderer.renderTo1bpp(input, { mode: 'threshold', threshold: 100 });
    const r2 = await renderer.renderTo1bpp(input, { mode: 'threshold', threshold: 200 });
    expect(r1.fromCache).toBe(false);
    expect(r2.fromCache).toBe(false);
  });
});
