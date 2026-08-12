import type { DynamicConfigT } from 'shared';
import { Input } from '@/components/ui/Input';
import type { DynamicConfigChange } from '@/features/dynamic/model/config-types';

export function CountdownConfigPanel({
  config,
  onChange,
}: {
  config: Extract<DynamicConfigT, { type: 'countdown' }>;
  onChange: DynamicConfigChange;
}) {
  return (
    <div className="space-y-5">
      <Input
        label="目标"
        type="text"
        maxLength={32}
        value={config.goal}
        onChange={(event) => onChange({ ...config, goal: event.target.value })}
        placeholder="如：期末考试周"
        hint="显示在卡片中央，最多 32 个字符。"
      />
      <Input
        label="目标日期"
        type="date"
        value={config.target_date}
        onChange={(event) => onChange({ ...config, target_date: event.target.value })}
        hint="按当前时区计算自然日；到期当天及之后显示 0 天。"
      />
    </div>
  );
}
