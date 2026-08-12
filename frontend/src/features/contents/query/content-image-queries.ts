import { useQuery } from '@tanstack/react-query';
import type { FrameFormatT } from 'shared';
import { API_PREFIX, api } from '@/lib/http';
import { contentKeys } from './keys';

export function useContentImage(
  contentId: string,
  etag: string | null | undefined,
  format: FrameFormatT = 'mono1'
) {
  return useQuery({
    queryKey: contentKeys.image(contentId, etag, format),
    queryFn: async () => {
      const { data } = await api.get<ArrayBuffer>(`${API_PREFIX}/contents/${contentId}/image`, {
        responseType: 'arraybuffer',
        params: { format },
      });
      return data;
    },
    staleTime: Infinity,
    enabled: !!contentId && !!etag,
  });
}

export function useContentImageSource(contentId: string, enabled: boolean) {
  return useQuery({
    queryKey: contentKeys.source(contentId),
    queryFn: async () => {
      const { data } = await api.get<Blob>(`${API_PREFIX}/contents/${contentId}/source`, {
        responseType: 'blob',
      });
      return data;
    },
    staleTime: Infinity,
    enabled: !!contentId && enabled,
  });
}
