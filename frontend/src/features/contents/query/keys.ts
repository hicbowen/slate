export const contentKeys = {
  group: (gid: string | undefined) => ['contents', gid] as const,
  detail: (contentId: string | undefined) => ['contents', 'detail', contentId] as const,
  image: (contentId: string, etag?: string | null, format: 'mono1' | 'bwry2' = 'mono1') =>
    etag === undefined
      ? (['content-image', contentId] as const)
      : (['content-image', contentId, format, etag] as const),
  audio: (contentId: string, etag?: string | null) =>
    etag === undefined
      ? (['content-audio', contentId] as const)
      : (['content-audio', contentId, etag] as const),
};
