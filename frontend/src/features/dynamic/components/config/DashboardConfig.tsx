import { useCallback, useState } from 'react';
import {
  catalog,
  systemTemplate,
  type ContentDynamic,
  type DashboardTemplate,
  type DynamicConfig,
} from '@/api';
import {
  DASHBOARD_CUSTOM_STARTER_SAMPLE_DATA,
  DASHBOARD_SYSTEM_TEMPLATE_SAMPLE_DATA,
} from '@/features/dynamic/model/dashboard-samples';
import { Select, SelectItem } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { JsonEditor } from './JsonEditor';
import { DynamicRefreshSettings } from './RefreshSettings';
import { DashboardPushPanel } from './DashboardPushPanel';
import { DashboardLayoutEditor } from './DashboardLayoutEditor';
import { parseDashboardTemplate, parseJsonRecord } from '@/features/dynamic/model/json-parse';
import type { DynamicConfigChange } from '@/features/dynamic/model/config-types';
import { useJsonDraftWithEcho } from '@/features/dynamic/hooks/useJsonDraftWithEcho';

const CUSTOM_DASHBOARD_TEMPLATE_VALUE = 'custom';
const DASHBOARD_SYSTEM_TEMPLATE_OPTIONS = catalog.dashboardTemplates;

export function DashboardConfigPanel({
  config,
  onChange,
  dashboardData,
  onDashboardDataChange,
  dataLabel = onDashboardDataChange ? '初始数据 JSON' : '当前数据 JSON',
  contentId,
  pushAuth,
}: {
  config: DynamicConfig;
  onChange: DynamicConfigChange;
  dashboardData: Record<string, unknown>;
  onDashboardDataChange?: (data: Record<string, unknown>) => void;
  dataLabel?: string;
  contentId?: string;
  pushAuth?: ContentDynamic['pushAuth'];
}) {
  const ref = config.template;
  const [editJson, setEditJson] = useState(false);
  const templateSelection =
    ref?.kind === 'system' && ref.id ? ref.id : CUSTOM_DASHBOARD_TEMPLATE_VALUE;
  const customTemplate = ref?.kind === 'custom' ? (ref.template ?? null) : null;
  const activeDescription =
    ref?.kind === 'system'
      ? (systemTemplate(ref.id)?.description ?? '')
      : '区块可用 color 设置颜色，矩形用 fill 和 strokeColor。支持 black、white、yellow、red，进度条可用 warningAt 和 criticalAt 设置黄、红阈值（%）。';
  const updateCustomTemplate = useCallback(
    (template: DashboardTemplate) => {
      onChange({ ...config, template: { kind: 'custom', template } });
    },
    [config, onChange]
  );
  const updateDashboardData = useCallback(
    (data: Record<string, unknown>) => {
      onDashboardDataChange?.(data);
    },
    [onDashboardDataChange]
  );
  const templateDraft = useJsonDraftWithEcho({
    value: customTemplate,
    fallback: catalog.dashboardStarter,
    parse: parseDashboardTemplateDraft,
    onValidChange: updateCustomTemplate,
  });
  const dashboardDataDraft = useJsonDraftWithEcho({
    value: dashboardData,
    fallback: DASHBOARD_CUSTOM_STARTER_SAMPLE_DATA,
    parse: parseJsonRecord,
    onValidChange: updateDashboardData,
  });

  return (
    <div className="space-y-4">
      <div>
        <p className="font-mono text-[10px] text-stone uppercase tracking-[0.18em] mb-1.5">模板</p>
        <Select
          value={templateSelection}
          onValueChange={(value) => {
            if (value === CUSTOM_DASHBOARD_TEMPLATE_VALUE) {
              const parsed = parseDashboardTemplate(templateDraft.text);
              const template = parsed.ok ? parsed.template : catalog.dashboardStarter;
              onChange({
                ...config,
                template: { kind: 'custom', template },
              });
              if (ref?.kind !== 'custom') {
                onDashboardDataChange?.({ ...DASHBOARD_CUSTOM_STARTER_SAMPLE_DATA });
              }
              templateDraft.setError(parsed.ok ? null : parsed.error);
            } else {
              if (!systemTemplate(value)) return;
              const id = value;
              onChange({
                ...config,
                template: { kind: 'system', id },
              });
              onDashboardDataChange?.({ ...DASHBOARD_SYSTEM_TEMPLATE_SAMPLE_DATA[id] });
              templateDraft.setError(null);
            }
          }}
        >
          <SelectItem value={CUSTOM_DASHBOARD_TEMPLATE_VALUE} hint="JSON">
            自定义模板
          </SelectItem>
          {DASHBOARD_SYSTEM_TEMPLATE_OPTIONS.map((item) => (
            <SelectItem key={item.id} value={item.id} hint="内置">
              {item.label}
            </SelectItem>
          ))}
        </Select>
        <p className="mt-2 font-sans text-[11px] text-stone leading-snug">{activeDescription}</p>
      </div>

      <DynamicRefreshSettings config={config} onChange={onChange} />

      {templateSelection === CUSTOM_DASHBOARD_TEMPLATE_VALUE && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="模板编辑方式">
            <Button
              size="sm"
              aria-pressed={!editJson}
              variant={editJson ? 'soft' : 'primary'}
              disabled={!!templateDraft.error}
              onClick={() => setEditJson(false)}
            >
              区块编辑
            </Button>
            <Button
              size="sm"
              aria-pressed={editJson}
              variant={editJson ? 'primary' : 'soft'}
              onClick={() => setEditJson(true)}
            >
              JSON
            </Button>
          </div>
          {editJson ? (
            <JsonEditor
              label="自定义模板 JSON"
              value={templateDraft.text}
              error={templateDraft.error}
              minRows={8}
              onChange={templateDraft.updateDraft}
            />
          ) : (
            <DashboardLayoutEditor
              template={customTemplate ?? catalog.dashboardStarter}
              data={dashboardData}
              onChange={updateCustomTemplate}
            />
          )}
        </div>
      )}

      <JsonEditor
        label={dataLabel}
        value={dashboardDataDraft.text}
        error={dashboardDataDraft.error}
        minRows={6}
        onChange={onDashboardDataChange ? dashboardDataDraft.updateDraft : undefined}
        readOnly={!onDashboardDataChange}
      />

      {contentId && pushAuth && (
        <DashboardPushPanel
          key={contentId}
          contentId={contentId}
          auth={pushAuth}
          data={dashboardData}
        />
      )}
    </div>
  );
}

function parseDashboardTemplateDraft(
  text: string
): { ok: true; data: DashboardTemplate } | { ok: false; error: string } {
  const parsed = parseDashboardTemplate(text);
  return parsed.ok ? { ok: true, data: parsed.template } : parsed;
}
