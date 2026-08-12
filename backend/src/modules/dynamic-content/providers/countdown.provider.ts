import { Injectable } from '@nestjs/common';
import { CountdownConfig, type CountdownConfigT } from 'shared';
import type { DataProvider, DynamicContentFetchCtx } from '../dynamic-content.types';
import { datePartsInTz } from '../timezone';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CountdownProviderData {
  remainingDays: number;
}

@Injectable()
export class CountdownProvider implements DataProvider<CountdownConfigT, CountdownProviderData> {
  readonly type = 'countdown';

  validateConfig(raw: unknown): CountdownConfigT {
    return CountdownConfig.parse(raw);
  }

  fetchData(config: CountdownConfigT, ctx: DynamicContentFetchCtx): Promise<CountdownProviderData> {
    const today = datePartsInTz(ctx.now, config.tz);
    const [targetYear, targetMonth, targetDay] = config.target_date.split('-').map(Number);
    const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
    const targetUtc = Date.UTC(targetYear!, targetMonth! - 1, targetDay!);
    const remainingDays = Math.max(0, Math.round((targetUtc - todayUtc) / DAY_MS));

    return Promise.resolve({ remainingDays });
  }
}
