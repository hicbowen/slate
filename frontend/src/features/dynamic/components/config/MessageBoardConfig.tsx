import type { DynamicConfig } from '@/api';
import { Input } from '@/components/ui/Input';
import { inputCls } from '@/components/ui/styles/form';
import { cn } from '@/lib/cn';

function localDateTime(instant: string | undefined): string {
  if (!instant) return '';
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function MessageBoardTextFields({
  config,
  onChange,
}: {
  config: DynamicConfig;
  onChange: (config: DynamicConfig) => void;
}) {
  return (
    <>
      <label className="block">
        <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-stone">
          留言正文
        </span>
        <textarea
          className={cn(inputCls, 'resize-y')}
          value={config.message ?? ''}
          onChange={(event) => onChange({ ...config, message: event.target.value })}
          placeholder="如：今晚六点回来吃饭"
          maxLength={100}
          rows={3}
          required
        />
        <span className="mt-1.5 block text-[11px] text-stone">最多 100 字，可手动分成四行。</span>
      </label>
      <Input
        label="落款（可选）"
        maxLength={20}
        value={config.messageAuthor ?? ''}
        onChange={(event) => onChange({ ...config, messageAuthor: event.target.value })}
      />
    </>
  );
}

export function MessageBoardConfigPanel({
  config,
  onChange,
}: {
  config: DynamicConfig;
  onChange: (config: DynamicConfig) => void;
}) {
  return (
    <div className="space-y-5">
      <MessageBoardTextFields config={config} onChange={onChange} />
      <Input
        type="datetime-local"
        label="过期时间（可选）"
        value={localDateTime(config.messageExpiresAt)}
        onChange={(event) => {
          const date = new Date(event.target.value);
          onChange({
            ...config,
            messageExpiresAt: Number.isFinite(date.getTime()) ? date.toISOString() : undefined,
          });
        }}
        hint="按当前浏览器时区填写。留空时，留言持续显示。"
      />
      {config.messageExpiresAt && (
        <Input
          label="过期后显示（可选）"
          maxLength={48}
          value={config.messageFallback ?? ''}
          onChange={(event) => onChange({ ...config, messageFallback: event.target.value })}
          placeholder="暂无新留言"
        />
      )}
    </div>
  );
}
