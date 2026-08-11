import { FRAME_BYTES_BWRY2, type ImageRenditionsT } from 'shared';

export interface ContentRenditionFields {
  imageEtag: string;
  imageSize: number;
  imageBwryEtag?: string | null;
  imageBwrySize?: number | null;
  imageGrayEtag?: string | null;
  imageGraySize?: number | null;
}

export function fallbackBwryEtag(monoEtag: string): string {
  return `mono-${monoEtag}`;
}

export function fallbackGrayEtag(monoEtag: string): string {
  return `mono-gray-${monoEtag}`;
}

export function contentImageRenditions(row: ContentRenditionFields): ImageRenditionsT {
  const renditions: ImageRenditionsT = {
    mono1: { etag: row.imageEtag, size: row.imageSize },
    bwry2: {
      etag: row.imageBwryEtag ?? fallbackBwryEtag(row.imageEtag),
      size: row.imageBwrySize ?? FRAME_BYTES_BWRY2,
    },
  };
  if (row.imageGrayEtag && row.imageGraySize) {
    renditions.gray4 = { etag: row.imageGrayEtag, size: row.imageGraySize };
  }
  return renditions;
}
