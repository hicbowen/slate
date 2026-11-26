import { expect, test } from 'bun:test';
import { GRAY16_DEVICE_LEVELS, quantizeGrayTo4bpp } from './gray4';

test('packs calibrated Note4 levels from the left pixel to the right pixel', () => {
  for (const preset of ['graphic', 'photo', 'vivid'] as const) {
    const frame = quantizeGrayTo4bpp(GRAY16_DEVICE_LEVELS, 16, 1, preset);
    expect(Array.from(frame)).toEqual([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]);
  }
});
