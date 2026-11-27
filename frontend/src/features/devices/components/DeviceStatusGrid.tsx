import { Wifi } from 'lucide-react';
import type { Device, DeviceSyncStatus } from '@/api';
import { rssiLabel } from '@/features/devices/lib/rssi';
import { BatteryLevelIcon } from './BatteryLevelIcon';
import { DeviceMetaCard } from './DeviceMetaCard';

export function DeviceStatusGrid({
  device,
  online,
  lastSeenAgo,
}: {
  device: Device;
  online: boolean;
  lastSeenAgo: string;
}) {
  const battery = device.batteryPct;

  return (
    <section>
      <h3 className="font-sans text-[12px] uppercase tracking-wide text-stone mb-2">状态</h3>
      <div className="grid grid-cols-2 gap-3">
        <DeviceMetaCard
          icon={<BatteryLevelIcon level={battery} size={16} />}
          label="最近上报电量"
          value={battery != null ? `${battery}%` : '—'}
          warn={online && battery != null && battery < 20}
          stale={!online}
        />
        <DeviceMetaCard
          icon={<Wifi size={16} />}
          label="最近上报信号"
          value={device.rssiDbm != null ? `${device.rssiDbm} dBm` : '—'}
          hint={device.rssiDbm != null ? rssiLabel(device.rssiDbm) : undefined}
          stale={!online}
        />
        <DeviceMetaCard label="固件" value={device.fwVersion ?? '—'} mono />
        <DeviceMetaCard label="最近联系" value={lastSeenAgo} />
        {device.syncStatus && (
          <SyncDetails status={device.syncStatus} hasGroup={!!device.groupId} />
        )}
      </div>
    </section>
  );
}

const syncResults: Record<string, string> = {
  ok: '成功',
  network: '网络或服务端不可达',
  cache_full: '设备缓存空间不足',
  apply_failed: '缓存下载或应用失败',
};

function SyncDetails({ status, hasGroup }: { status: DeviceSyncStatus; hasGroup: boolean }) {
  const { expectedVersion, appliedVersion, screenVersion, nextRefreshAt, lastResult } = status;
  const downloaded = !!expectedVersion && appliedVersion === expectedVersion;
  const displayed = !!expectedVersion && screenVersion === expectedVersion;
  return (
    <>
      <DeviceMetaCard
        label="内容缓存"
        value={
          !hasGroup
            ? '未选组'
            : !expectedVersion
              ? '正在读取状态'
              : downloaded
                ? '已缓存当前版本'
                : '等待同步当前版本'
        }
      />
      <DeviceMetaCard
        label="最近确认上屏"
        value={
          displayed
            ? '当前版本'
            : screenVersion
              ? expectedVersion
                ? '其他版本'
                : screenVersion.slice(0, 8)
              : '尚未确认'
        }
      />
      <DeviceMetaCard
        label="设备上报的同步结果"
        value={syncResults[lastResult] ?? '尚未上报'}
        warn={!!syncResults[lastResult] && lastResult !== 'ok'}
      />
      <DeviceMetaCard
        label="上报时预计刷新"
        value={nextRefreshAt > 0 ? new Date(nextRefreshAt * 1000).toLocaleString() : '—'}
      />
    </>
  );
}
