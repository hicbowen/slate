import { describe, expect, it } from 'bun:test';
import { CountdownProvider } from './countdown.provider';

describe('CountdownProvider', () => {
  const provider = new CountdownProvider();

  it('按配置时区的自然日计算剩余天数', async () => {
    const data = await provider.fetchData(
      {
        type: 'countdown',
        tz: 'Asia/Shanghai',
        goal: '期末考试周',
        target_date: '2026-06-18',
      },
      { now: new Date('2026-06-15T15:59:59.000Z') }
    );

    expect(data.remainingDays).toBe(3);
  });

  it('跨过目标日后保持为零', async () => {
    const config = {
      type: 'countdown' as const,
      tz: 'Asia/Shanghai',
      goal: '项目上线',
      target_date: '2026-06-18',
    };

    expect(
      (await provider.fetchData(config, { now: new Date('2026-06-17T16:00:00.000Z') }))
        .remainingDays
    ).toBe(0);
    expect(
      (await provider.fetchData(config, { now: new Date('2026-06-20T00:00:00.000Z') }))
        .remainingDays
    ).toBe(0);
  });

  it('拒绝不存在的目标日期', () => {
    expect(() =>
      provider.validateConfig({
        type: 'countdown',
        tz: 'Asia/Shanghai',
        goal: '无效日期',
        target_date: '2026-02-31',
      })
    ).toThrow();
  });
});
