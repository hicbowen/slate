import { describe, expect, it } from 'bun:test';
import type { BitmapFont } from './fonts/bitmap-font';
import { BitmapCanvas, PIXEL_BLACK, PIXEL_WHITE } from './bitmap-canvas';

describe('BitmapCanvas', () => {
  it('packs partial trailing bytes for non-8-divisible canvas sizes', () => {
    const canvas = new BitmapCanvas(3, 3);
    canvas.setPixel(2, 2, PIXEL_WHITE);

    const raw = canvas.toRaw1bpp();

    expect(raw.length).toBe(2);
    expect(raw[1]).toBe(0x80);
  });

  it('clips horizontal and vertical lines before writing pixels', () => {
    const canvas = new BitmapCanvas(4, 4);

    canvas.drawHLine(-2, 1, 5, PIXEL_WHITE);
    canvas.drawVLine(3, -1, 3, PIXEL_WHITE);

    const raw = canvas.toRaw1bpp();
    expect([...raw]).toEqual([0x1f, 0x00]);
  });

  it('packs SSD2683 BWRY colors in high-bit-first order', () => {
    const canvas = new BitmapCanvas(4, 1);
    canvas.setPixel(0, 0, 0);
    canvas.setPixel(1, 0, 1);
    canvas.setPixel(2, 0, 2);
    canvas.setPixel(3, 0, 3);
    expect([...canvas.toRaw2bpp()]).toEqual([0x1b]);
  });

  it('按整数倍放大点阵文字', () => {
    const font: BitmapFont = {
      name: 'test',
      lineHeight: 1,
      baseLine: 0,
      glyphs: new Map([
        [0x31, { bitmap_index: 0, adv_w: 16, box_w: 1, box_h: 1, ofs_x: 0, ofs_y: 0 }],
      ]),
      bitmap: new Uint8Array([0x80]),
    };
    const canvas = new BitmapCanvas(4, 2);
    canvas.clear(PIXEL_WHITE);

    expect(canvas.drawTextScaled(font, '1', 0, 2, 2, PIXEL_BLACK)).toBe(2);
    expect([...canvas.toRaw1bpp()]).toEqual([0x33]);
  });
});
