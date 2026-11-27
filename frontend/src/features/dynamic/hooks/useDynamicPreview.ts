import { useCallback, useEffect, useRef, useState } from 'react';
import { ColorFrameFormat, type DynamicConfig, type DynamicType } from '@/api';
import { usePreviewDynamicContent } from '@/features/dynamic/query/dynamic-content-queries';
import { getApiErrorMessage } from '@/lib/api-errors';

type PreviewContentType = DynamicType | 'image';
type Frame = { scope: string; data: ArrayBuffer };
type RequestStatus = { scope: string; pending: boolean; error?: string };

export function useDynamicPreview({
  contentId,
  type,
  config,
  dashboardData,
  color,
  debounceMs = 800,
}: {
  contentId?: string;
  type: PreviewContentType | null;
  config: DynamicConfig | null;
  dashboardData?: Record<string, unknown> | null;
  color: boolean;
  debounceMs?: number;
}) {
  const { mutate: preview } = usePreviewDynamicContent(contentId);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [status, setStatus] = useState<RequestStatus | null>(null);
  const [retry, setRetry] = useState(0);
  const previewSeq = useRef(0);
  const scope = `${contentId ?? 'new'}:${type}:${color}`;

  const invalidatePreview = useCallback(() => {
    previewSeq.current++;
    setFrame(null);
    setStatus(null);
  }, []);

  useEffect(() => {
    if (!config || type === 'image' || type === null) return;
    const seq = ++previewSeq.current;
    let active = true;
    const controller = new AbortController();
    setStatus({ scope, pending: true });
    const timer = setTimeout(() => {
      preview(
        {
          config,
          data: config.type === 'dashboard' ? (dashboardData ?? undefined) : undefined,
          format: color ? ColorFrameFormat : undefined,
          signal: controller.signal,
        },
        {
          onSuccess: (data) => {
            if (!active || seq !== previewSeq.current) return;
            setFrame({ scope, data });
            setStatus({ scope, pending: false });
          },
          onError: (error) => {
            if (!active || seq !== previewSeq.current) return;
            setStatus({
              scope,
              pending: false,
              error: getApiErrorMessage(error, '无法生成预览，请检查配置后重试。'),
            });
          },
        }
      );
    }, debounceMs);

    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [color, config, dashboardData, debounceMs, preview, retry, scope, type]);

  return {
    livePreviewData: config && frame?.scope === scope ? frame.data : null,
    previewPending: !!config && status?.scope === scope && status.pending,
    previewError: config && status?.scope === scope ? status.error : undefined,
    retryPreview: () => setRetry((previous) => previous + 1),
    invalidatePreview,
  };
}
