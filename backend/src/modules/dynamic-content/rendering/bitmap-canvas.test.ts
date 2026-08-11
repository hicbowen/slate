import { describe, expect, it } from 'bun:test';
import { BitmapCanvas, PIXEL_WHITE } from './bitmap-canvas';

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
});
