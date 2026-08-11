import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import {
  API_DEFAULT_DITHER_MODE,
  BW_THRESHOLD_DEFAULT,
  FRAME_BYTES,
  FRAME_BYTES_BWRY2,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  autoContrast,
  autoInvert,
  ditherTo1bpp,
  ditherToBwry2bpp,
  type DitherMode,
} from 'shared';
import { ValidationError } from '../../common/errors';
import { computeETag } from '../../common/utils/etag';
import { ImageRenderCacheService } from './image-render-cache.service';

export interface RenderOptions {
  width?: number;
  height?: number;
  threshold?: number;
  mode?: DitherMode;
  autoInvert?: boolean;
  letterbox?: boolean;
  sourceEtag?: string;
}

export interface RenderResult {
  data: Buffer;
  width: number;
  height: number;
  fromCache: boolean;
}

/**
 * 把任意格式图片(PNG/JPG/WebP/...)转成 EPD 1bpp 帧缓冲。
 *
 * pipeline:
 *   1. sharp:flatten 白底 → letterbox resize → grayscale.raw()
 *   2. shared.autoInvert：四角自适应反相
 *   3. shared.autoContrast：cutoff=1% 拉对比
 *   4. shared.ditherTo1bpp：按 mode 抖动并打包
 *
 * 输出 raw 1bpp packed：每字节 8 像素，MSB first，bit=1 白 / bit=0 黑。
 * 字节序与固件 epd_ssd1683.cc 的 SetPx1 对齐。
 */
@Injectable()
export class ImageRendererService {
  constructor(private readonly cache: ImageRenderCacheService) {}

  async renderTo1bpp(input: Buffer, options: RenderOptions = {}): Promise<RenderResult> {
    const W = options.width ?? FRAME_WIDTH;
    const H = options.height ?? FRAME_HEIGHT;
    const threshold = options.threshold ?? BW_THRESHOLD_DEFAULT;
    const mode = options.mode ?? API_DEFAULT_DITHER_MODE;
    const doAutoInvert = options.autoInvert ?? true;
    const letterbox = options.letterbox ?? true;

    if (W % 8 !== 0) {
      throw new ValidationError(`图宽必须是 8 的倍数，当前为 ${W}`);
    }
    if (W <= 0 || H <= 0) {
      throw new ValidationError(`图片尺寸非法：${W}x${H}`);
    }

    const sourceEtag = options.sourceEtag ?? computeETag(input);
    const key = this.cache.key({
      format: 'mono1',
      sourceEtag,
      width: W,
      height: H,
      threshold,
      mode,
      autoInvert: doAutoInvert,
      letterbox,
    });
    const { data, fromCache } = await this.cache.getOrCompute(key, async () => {
      return runSharpPipeline(input, { W, H, mode, threshold, doAutoInvert, letterbox });
    });

    return { data, width: W, height: H, fromCache };
  }

  /** 把任意图片量化为 Note4C 的 B/W/Y/R raw 2bpp 帧。 */
  async renderTo2bpp(input: Buffer, options: RenderOptions = {}): Promise<RenderResult> {
    const W = options.width ?? FRAME_WIDTH;
    const H = options.height ?? FRAME_HEIGHT;
    const letterbox = options.letterbox ?? true;
    if (W % 4 !== 0) throw new ValidationError(`图宽必须是 4 的倍数，当前为 ${W}`);
    if (W <= 0 || H <= 0) throw new ValidationError(`图片尺寸非法：${W}x${H}`);

    const sourceEtag = options.sourceEtag ?? computeETag(input);
    const key = this.cache.key({
      format: 'bwry2',
      sourceEtag,
      width: W,
      height: H,
      threshold: 0,
      mode: 'floyd-bwry',
      autoInvert: false,
      letterbox,
    });
    const { data, fromCache } = await this.cache.getOrCompute(key, async () => {
      const { data: rgb } = await sharp(input)
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .resize(W, H, {
          fit: letterbox ? 'contain' : 'cover',
          background: { r: 255, g: 255, b: 255 },
        })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (rgb.length !== W * H * 3) {
        throw new ValidationError(`图片解码异常：当前 ${rgb.length} 字节，期望 ${W * H * 3} 字节`);
      }
      const packed = ditherToBwry2bpp(
        new Uint8Array(rgb.buffer, rgb.byteOffset, rgb.byteLength),
        W,
        H
      );
      return Buffer.from(packed.buffer, packed.byteOffset, packed.byteLength);
    });
    return { data, width: W, height: H, fromCache };
  }

  validateFrameSize(buf: Buffer): void {
    if (buf.length !== FRAME_BYTES) {
      throw new ValidationError(`帧大小不匹配：当前 ${buf.length} 字节，期望 ${FRAME_BYTES} 字节`);
    }
  }

  validateBwryFrameSize(buf: Buffer): void {
    if (buf.length !== FRAME_BYTES_BWRY2) {
      throw new ValidationError(
        `四色帧大小不匹配：当前 ${buf.length} 字节，期望 ${FRAME_BYTES_BWRY2} 字节`
      );
    }
  }
}

async function runSharpPipeline(
  input: Buffer,
  o: {
    W: number;
    H: number;
    mode: DitherMode;
    threshold: number;
    doAutoInvert: boolean;
    letterbox: boolean;
  }
): Promise<Buffer> {
  const { data: rawGray } = await sharp(input)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .resize(o.W, o.H, {
      fit: o.letterbox ? 'contain' : 'cover',
      background: { r: 255, g: 255, b: 255 },
    })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (rawGray.length !== o.W * o.H) {
    throw new ValidationError(`图片解码异常：当前 ${rawGray.length} 字节，期望 ${o.W * o.H} 字节`);
  }
  let gray: Uint8Array = new Uint8Array(rawGray.buffer, rawGray.byteOffset, rawGray.byteLength);
  if (o.doAutoInvert) gray = autoInvert(gray, o.W, o.H);
  gray = autoContrast(gray, 1);

  const packed = ditherTo1bpp(gray, o.W, o.H, { mode: o.mode, threshold: o.threshold });
  return Buffer.from(packed.buffer, packed.byteOffset, packed.byteLength);
}
