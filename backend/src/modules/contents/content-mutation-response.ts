import type { ContentMutationResponseT } from 'shared';
import { contentImageRenditions } from './content-renditions';

export function toContentMutationResponse(
  contentId: string,
  seq: number,
  imageEtag: string,
  audioEtag: string | null,
  manifestEtag: string,
  contentEtag: string,
  imageBwryEtag?: string | null,
  imageBwrySize?: number | null,
  imageSize = 15000,
  imageGrayEtag?: string | null,
  imageGraySize?: number | null,
  displayMode: ContentMutationResponseT['display_mode'] = 'mono1'
): ContentMutationResponseT {
  return {
    id: contentId,
    seq,
    content_etag: contentEtag,
    image_etag: imageEtag,
    image_renditions: contentImageRenditions({
      imageEtag,
      imageSize,
      imageBwryEtag,
      imageBwrySize,
      imageGrayEtag,
      imageGraySize,
    }),
    display_mode: displayMode,
    audio_etag: audioEtag,
    manifest_etag: manifestEtag,
  };
}
