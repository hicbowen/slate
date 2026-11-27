import {
  CountdownLayoutEditorial,
  CountdownModeDown,
  CountdownModeUp,
  type CountdownLayout,
  type DynamicConfig,
} from '@/api';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem, SelectSeparator } from '@/components/ui/Select';

const layouts = {
  editorial: '左对齐日签',
  poster: '居中海报',
  split: '左右分栏',
} satisfies Record<CountdownLayout, string>;

const milestoneDays = [30, 100, 365, 1000];
const labelClass = 'font-mono text-[10px] text-stone uppercase tracking-[0.18em] mb-1.5';

export function CountdownConfigPanel({
  config,
  onChange,
}: {
  config: DynamicConfig;
  onChange: (config: DynamicConfig) => void;
}) {
  const countUp = config.countdownMode === CountdownModeUp;
  const milestones = config.milestones ?? [];
  const layoutLabel = countUp ? '正数日版式' : '倒数日版式';

  return (
    <div className="space-y-5">
      <div>
        <p className={labelClass}>计日模式</p>
        <Select
          aria-label="计日模式"
          value={countUp ? CountdownModeUp : CountdownModeDown}
          onValueChange={(value) => {
            const up = value === CountdownModeUp;
            onChange({
              ...config,
              countdownMode: up ? CountdownModeUp : undefined,
              countdownLayout: up
                ? (config.countdownLayout ?? CountdownLayoutEditorial)
                : config.countdownLayout,
            });
          }}
        >
          <SelectItem value={CountdownModeDown}>倒数日</SelectItem>
          <SelectItem value={CountdownModeUp}>正数日</SelectItem>
        </Select>
      </div>
      <Input
        label={countUp ? '事件名称' : '目标'}
        value={config.goal ?? ''}
        maxLength={32}
        onChange={(event) => onChange({ ...config, goal: event.target.value })}
        placeholder={countUp ? '如：搬进新家' : '如：期末考试周'}
        required
      />
      <Input
        type="date"
        label={countUp ? '起始日期' : '目标日期'}
        value={config.targetDate ?? ''}
        onChange={(event) => onChange({ ...config, targetDate: event.target.value })}
        hint={countUp ? '起始日期当天是第 1 天。' : '按当地日期计算，到期当天及之后显示 0 天。'}
        required
      />
      <div>
        <p className={labelClass}>{layoutLabel}</p>
        <Select
          aria-label={layoutLabel}
          value={config.countdownLayout ?? (countUp ? CountdownLayoutEditorial : 'legacy')}
          onValueChange={(value) => {
            const countdownLayout = value === 'legacy' ? undefined : (value as CountdownLayout);
            onChange({ ...config, countdownLayout });
          }}
        >
          {Object.entries(layouts).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
          {!countUp && <SelectSeparator />}
          {!countUp && <SelectItem value="legacy">原版样式</SelectItem>}
        </Select>
      </div>
      {countUp && (
        <fieldset>
          <legend className={labelClass}>里程碑（可选）</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {milestoneDays.map((day) => (
              <label key={day} className="inline-flex items-center gap-1.5 text-sm text-ink">
                <input
                  type="checkbox"
                  className="accent-ink"
                  checked={milestones.includes(day)}
                  onChange={(event) =>
                    onChange({
                      ...config,
                      milestones: event.target.checked
                        ? [...milestones, day].sort((a, b) => a - b)
                        : milestones.filter((milestone) => milestone !== day),
                    })
                  }
                />
                第 {day} 天
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}
