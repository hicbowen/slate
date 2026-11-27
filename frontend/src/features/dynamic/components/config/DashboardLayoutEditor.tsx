import { useId, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { DashboardBlock, DashboardTemplate } from '@/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem } from '@/components/ui/Select';

const blockTypes = {
  text: '文本',
  metric: '指标',
  progress: '进度条',
  sparkline: '趋势线',
  rect: '矩形',
  line: '直线',
};

const colors = { black: '黑', white: '白', red: '红', yellow: '黄' };

function newBlock(type: DashboardBlock['type'], blocks: DashboardBlock[]): DashboardBlock {
  const spans = blocks.map((block) =>
    block.type === 'line'
      ? { top: Math.min(block.y1, block.y2), bottom: Math.max(block.y1, block.y2) + 1 }
      : { top: block.y, bottom: block.y + block.h }
  );
  const height = type === 'line' ? 1 : 40;
  const starts = [40, ...spans.map((span) => span.bottom + 8)].sort((a, b) => a - b);
  const y =
    starts.find(
      (start) =>
        start >= 24 &&
        start + height <= 300 &&
        spans.every(({ top, bottom }) => start + height <= top || start >= bottom)
    ) ?? 40;
  const base = { type, x: 16, y, w: 160, h: 40, x1: 16, y1: y, x2: 176, y2: y };
  switch (type) {
    case 'text':
      return { ...base, value: '文本' };
    case 'metric':
      return { ...base, label: '指标', value: '0' };
    case 'progress':
      return { ...base, label: '进度', percentage: 50 };
    case 'sparkline':
      return { ...base, values: [2, 8, 5, 9] };
    default:
      return base;
  }
}

export function DashboardLayoutEditor({
  template,
  data,
  onChange,
}: {
  template: DashboardTemplate;
  data: Record<string, unknown>;
  onChange: (template: DashboardTemplate) => void;
}) {
  const [selected, setSelected] = useState(0);
  const [newType, setNewType] = useState<DashboardBlock['type']>('text');
  const { blocks } = template;
  const index = Math.min(selected, blocks.length - 1);
  const block = blocks[index];
  const setBlocks = (next: DashboardBlock[]) => onChange({ ...template, blocks: next });

  function move(direction: -1 | 1) {
    const next = index + direction;
    const copy = [...blocks];
    [copy[index], copy[next]] = [copy[next]!, copy[index]!];
    setBlocks(copy);
    setSelected(next);
  }

  return (
    <div className="space-y-3">
      <Input
        label="模板名称"
        maxLength={48}
        value={template.name ?? ''}
        onChange={(event) => onChange({ ...template, name: event.target.value })}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="新区块类型"
          value={newType}
          onValueChange={(value) => setNewType(value as DashboardBlock['type'])}
        >
          {Object.entries(blockTypes).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </Select>
        <Button
          size="sm"
          iconLeft={<Plus size={14} />}
          disabled={blocks.length >= 32}
          onClick={() => {
            setBlocks([...blocks, newBlock(newType, blocks)]);
            setSelected(blocks.length);
          }}
        >
          添加区块
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(6rem,1fr)_2fr]">
        <ul className="max-h-56 divide-y divide-line overflow-auto border border-line self-start">
          {blocks.map((item, i) => (
            <li key={i}>
              <button
                type="button"
                aria-pressed={i === index}
                className={`w-full truncate px-2 py-1.5 text-left text-[12px] ${i === index ? 'bg-cream font-semibold' : 'hover:bg-cream'}`}
                onClick={() => setSelected(i)}
              >
                {i + 1}. {blockTypes[item.type]}
                {item.label && ` · ${item.label}`}
              </button>
            </li>
          ))}
        </ul>
        {block && (
          <div className="min-w-0 space-y-3">
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                aria-label="上移区块"
                disabled={index === 0}
                onClick={() => move(-1)}
              >
                <ArrowUp size={14} />
              </Button>
              <Button
                size="sm"
                aria-label="下移区块"
                disabled={index >= blocks.length - 1}
                onClick={() => move(1)}
              >
                <ArrowDown size={14} />
              </Button>
              <Button
                size="sm"
                aria-label="删除区块"
                disabled={blocks.length === 1}
                onClick={() => {
                  setBlocks(blocks.filter((_, i) => i !== index));
                  setSelected(Math.max(0, index - 1));
                }}
              >
                <Trash2 size={14} />
              </Button>
            </div>
            <DashboardBlockFields
              block={block}
              data={data}
              onChange={(patch) =>
                setBlocks(blocks.map((item, i) => (i === index ? { ...item, ...patch } : item)))
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

function DashboardBlockFields({
  block,
  data,
  onChange,
}: {
  block: DashboardBlock;
  data: Record<string, unknown>;
  onChange: (patch: Partial<DashboardBlock>) => void;
}) {
  const bindings = useId();
  const { type } = block;
  const position =
    type === 'line' ? (['x1', 'y1', 'x2', 'y2'] as const) : (['x', 'y', 'w', 'h'] as const);
  const positionLabels =
    type === 'line'
      ? ['起点 X', '起点 Y', '终点 X', '终点 Y']
      : ['左边 X', '上边 Y', '宽度', '高度'];
  const fields: ReactNode[] = [];
  const textField = (key: 'value' | 'label' | 'valueText', label: string) => (
    <Input
      key={key}
      label={label}
      list={bindings}
      maxLength={160}
      value={block[key] ?? ''}
      onChange={(event) => onChange({ [key]: event.target.value })}
    />
  );
  const colorField = (key: 'color' | 'fill' | 'strokeColor', label: string) => (
    <label key={key} className="block space-y-1">
      <span className="block text-[11px] text-stone">{label}</span>
      <select
        className="w-full border border-line bg-paper p-1.5 text-[12px]"
        value={block[key] === 'none' ? 'default' : block[key] || 'default'}
        onChange={(event) =>
          onChange({ [key]: event.target.value === 'default' ? undefined : event.target.value })
        }
      >
        <option value="default">{key === 'fill' ? '无填充' : '默认'}</option>
        {Object.entries(colors).map(([value, name]) => (
          <option key={value} value={value}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
  if (type === 'metric' || type === 'progress') fields.push(textField('label', '标题'));
  if (type === 'metric' || type === 'text')
    fields.push(textField('value', type === 'text' ? '正文' : '数值'));
  if (type === 'progress') {
    fields.push(
      <Input
        key="percentage"
        label="百分比"
        list={bindings}
        value={block.percentage ?? ''}
        onChange={(event) => onChange({ percentage: event.target.value || undefined })}
      />,
      textField('valueText', '右侧文字'),
      <div key="thresholds" className="grid grid-cols-2 gap-2">
        {(['warningAt', 'criticalAt'] as const).map((key) => (
          <Input
            key={key}
            type="number"
            label={key === 'warningAt' ? '黄色阈值 (%)' : '红色阈值 (%)'}
            min="0.01"
            max="100"
            step="any"
            value={block[key] ?? ''}
            onChange={(event) =>
              onChange({ [key]: event.target.value ? Number(event.target.value) : undefined })
            }
          />
        ))}
      </div>
    );
  }
  if (type === 'sparkline') {
    const value =
      typeof block.values === 'string' ? block.values : (block.values?.join(', ') ?? '');
    fields.push(
      <Input
        key="values"
        label="数据序列"
        hint="选择数据字段，或输入逗号分隔的数字。"
        list={bindings}
        value={value}
        onChange={(event) => onChange({ values: event.target.value })}
        onBlur={(event) => {
          const parts = event.target.value.split(',').map((part) => part.trim());
          if (
            parts.length > 1 &&
            parts.every((part) => part !== '' && Number.isFinite(Number(part)))
          )
            onChange({ values: parts.map(Number) });
        }}
      />
    );
  }
  if (type === 'rect') {
    fields.push(colorField('fill', '填充'), colorField('strokeColor', '边框'));
  } else {
    fields.push(colorField('color', '墨色'));
  }

  return (
    <div className="space-y-2">
      <datalist id={bindings}>
        {Object.keys(data)
          .filter((key) => /^[\w.\u4e00-\u9fff-]+$/.test(key))
          .map((key) => (
            <option key={key} value={`{${key}}`} />
          ))}
      </datalist>
      <div className="grid grid-cols-2 gap-2">
        {position.map((key, i) => (
          <Input
            key={key}
            type="number"
            label={positionLabels[i]}
            value={block[key] ?? 0}
            onChange={(event) => onChange({ [key]: Number(event.target.value) })}
          />
        ))}
      </div>
      {fields}
    </div>
  );
}
