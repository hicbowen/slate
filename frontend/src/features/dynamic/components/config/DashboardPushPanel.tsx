import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import type { ContentDynamic, DashboardPushToken } from '@/api';
import { useConfirm } from '@/components/feedback/confirm-context';
import { useToast } from '@/components/feedback/toast-context';
import { Button } from '@/components/ui/Button';
import { contentKeys } from '@/features/contents/query/keys';
import { getApiErrorMessage } from '@/lib/api-errors';
import { http } from '@/lib/http';

export function DashboardPushPanel({
  contentId,
  auth,
  data,
}: {
  contentId: string;
  auth: NonNullable<ContentDynamic['pushAuth']>;
  data: Record<string, unknown>;
}) {
  const [token, setToken] = useState('');
  const confirm = useConfirm();
  const toast = useToast();
  const queryClient = useQueryClient();
  const path = `/api/contents/${contentId}/data`;
  const url = new URL(path, window.location.origin).toString();
  const rotate = useMutation({
    mutationFn: () => http.post<DashboardPushToken>(`/contents/${contentId}/data/token`),
    onSuccess: ({ token: next }) => {
      setToken(next);
      void queryClient.invalidateQueries({ queryKey: contentKeys.detail(contentId) });
    },
    onError: (error) => toast.error('令牌生成失败', getApiErrorMessage(error)),
  });
  const mode = token ? 'token' : auth;
  const binding = mode === 'legacy' ? '' : ' -H "Authorization: Bearer $SLATE_PUSH_TOKEN"';
  const payload = JSON.stringify({ version: 1, data }, null, 2);
  const example = [
    `curl -X POST -H 'Content-Type: application/json'${binding} --data-binary @- '${url}' <<'JSON'`,
    payload,
    'JSON',
  ].join('\n');

  async function generate() {
    if (
      mode !== 'unconfigured' &&
      !(await confirm({
        title: mode === 'legacy' ? '启用推送令牌？' : '轮换推送令牌？',
        description: '原有推送凭证会立即失效，请用新令牌更新推送脚本。',
        confirmText: '生成新令牌',
      }))
    ) {
      return;
    }
    rotate.mutate();
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('已复制');
    } catch {
      toast.error('无法访问剪贴板', '请选中文本手动复制。');
    }
  }

  return (
    <div className="space-y-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-stone">数据推送</p>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 select-all break-all border border-line px-2 py-1.5 text-[11px]">
          {url}
        </code>
        <Button size="sm" iconLeft={<Copy size={14} />} onClick={() => void copy(url)}>
          复制地址
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={rotate.isPending} onClick={() => void generate()}>
          {mode === 'token' ? '轮换令牌' : '生成令牌'}
        </Button>
        <span className="text-[11px] text-stone">
          {mode === 'legacy' ? '旧推送地址仍可用' : mode === 'token' ? '已启用令牌' : '待生成令牌'}
        </span>
      </div>
      {token && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-stone">
            令牌仅在本次生成后显示，请保存到推送脚本的环境变量。
          </p>
          <div className="flex items-start gap-2">
            <code className="min-w-0 flex-1 select-all break-all border border-line px-2 py-1.5 text-[11px]">
              {token}
            </code>
            <Button size="sm" iconLeft={<Copy size={14} />} onClick={() => void copy(token)}>
              复制令牌
            </Button>
          </div>
        </div>
      )}
      <details className="text-[11px]">
        <summary className="cursor-pointer font-mono uppercase tracking-[0.12em] text-stone">
          示例 curl
        </summary>
        {mode !== 'legacy' && <p className="mt-2">运行前设置环境变量 SLATE_PUSH_TOKEN。</p>}
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap border border-line bg-cream p-3 text-[10px] leading-snug">
          {example}
        </pre>
      </details>
      <p className="text-[11px] leading-snug text-stone">设备在下次同步时拉取新数据。</p>
    </div>
  );
}
