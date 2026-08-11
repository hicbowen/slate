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
