import { FRAME_HEIGHT, FRAME_WIDTH } from 'shared';
import { daysInMonth, timezoneFromConfig } from '../timezone';
import { BitmapCanvas, PIXEL_BLACK, PIXEL_RED, PIXEL_WHITE, PIXEL_YELLOW } from './bitmap-canvas';
import type { DynamicRenderContext } from './dynamic-render-context';
import { CONTENT_SAFE_BOTTOM, CONTENT_SAFE_TOP, STATUS_BAR_H } from './frame-renderer-layout';
import { dateParts, weekdayFor } from './helpers/frame-date-utils';
import { isRecord } from './helpers/frame-value-utils';

/**
 * 只在 bwry2 副本上叠加语义色。调用前 mono1 已经导出，因此这里可以安全地
 * 调整反白文字等细节，而不会改变 Note4 的任何像素。
 */
export function applyFourColorAccents(c: BitmapCanvas, ctx: DynamicRenderContext): void {
  switch (ctx.type) {
    case 'daily_calendar':
      applyDailyCalendar(c);
      break;
    case 'month_calendar':
      applyMonthCalendar(c, ctx);
      break;
    case 'weather':
      applyWeather(c);
      break;
    case 'history_today':
      applyHistoryToday(c);
      break;
    case 'weather_alert':
      applyWeatherAlert(c, ctx);
      break;
    case 'earthquake_report':
      applyEarthquake(c);
      break;
    case 'hot_list':
      applyHotList(c, ctx);
      break;
  }
}

function applyDailyCalendar(c: BitmapCanvas): void {
  const ruleY = Math.round((CONTENT_SAFE_TOP + CONTENT_SAFE_BOTTOM) / 2);
  c.replaceColorInRect(
    18,
    CONTENT_SAFE_TOP,
    176,
    ruleY - CONTENT_SAFE_TOP,
    PIXEL_BLACK,
    PIXEL_YELLOW
  );
  c.replaceColorInRect(20, ruleY + 56, 24, 22, PIXEL_BLACK, PIXEL_YELLOW);
  c.replaceColorInRect(20, ruleY + 98, 24, 22, PIXEL_BLACK, PIXEL_RED);
}

function applyMonthCalendar(c: BitmapCanvas, ctx: DynamicRenderContext): void {
  const tz = timezoneFromConfig(ctx.config);
  const parts = dateParts(ctx.renderedAt, tz);
  const first = weekdayFor(parts.year, parts.month, 1);
  const total = daysInMonth(parts.year, parts.month);
  const x0 = 14;
  const y0 = 32;
  const colW = Math.floor((FRAME_WIDTH - 28) / 7);
  const headerH = 24;
  const weekRows = Math.ceil((first + total) / 7);
  const rowH =
    weekRows > 1 ? Math.floor((FRAME_HEIGHT - (y0 + headerH) - 38) / (weekRows - 1)) : 42;
  const pos = first + parts.day - 1;
  const x = x0 + (pos % 7) * colW + Math.floor(colW / 2) - 11;
  const y = y0 + headerH + Math.floor(pos / 7) * rowH + 1;

  c.replaceColorInRect(x0, y0, colW, headerH, PIXEL_BLACK, PIXEL_RED);
  c.replaceColorInRect(x0 + colW * 6, y0, colW, headerH, PIXEL_BLACK, PIXEL_YELLOW);
  c.replaceColorInRect(x, y, 22, 18, PIXEL_BLACK, PIXEL_YELLOW);
  c.replaceColorInRect(x, y, 22, 18, PIXEL_WHITE, PIXEL_BLACK);
}

function applyWeather(c: BitmapCanvas): void {
  const forecastTop = CONTENT_SAFE_TOP + 132;
  c.replaceColorInRect(
    20,
    CONTENT_SAFE_TOP,
    232,
    forecastTop - CONTENT_SAFE_TOP,
    PIXEL_BLACK,
    PIXEL_YELLOW
  );
  c.replaceColorInRect(20, forecastTop, 120, FRAME_HEIGHT - forecastTop, PIXEL_BLACK, PIXEL_YELLOW);
}

function applyHistoryToday(c: BitmapCanvas): void {
  c.replaceColorInRect(
    16,
    CONTENT_SAFE_TOP,
    52,
    FRAME_HEIGHT - CONTENT_SAFE_TOP,
    PIXEL_BLACK,
    PIXEL_YELLOW
  );
}

function applyWeatherAlert(c: BitmapCanvas, ctx: DynamicRenderContext): void {
  const items = Array.isArray(ctx.data?.items) ? ctx.data.items.filter(isRecord).slice(0, 9) : [];
  if (items.length === 0) return;
  const startY = STATUS_BAR_H + 7;
  const rowH = Math.min(30, Math.floor((FRAME_HEIGHT - startY - 4) / items.length));
  for (let index = 0; index < items.length; index++) {
    c.replaceColorInRect(20, startY + index * rowH, 34, rowH, PIXEL_BLACK, PIXEL_RED);
  }
}

function applyEarthquake(c: BitmapCanvas): void {
  c.replaceColorInRect(20, STATUS_BAR_H + 10, 120, 106, PIXEL_BLACK, PIXEL_RED);
}

function applyHotList(c: BitmapCanvas, ctx: DynamicRenderContext): void {
  const count = Array.isArray(ctx.data?.items) ? Math.min(ctx.data.items.length, 8) : 0;
  const listTop = STATUS_BAR_H + 10;
  const rowH = 33;
  const rankBoxH = 18;
  for (let index = 0; index < Math.min(count, 3); index++) {
    const rowCenterY = listTop + index * rowH + (rowH - 2) / 2;
    const rankY = Math.round(rowCenterY - rankBoxH / 2);
    c.replaceColorInRect(
      20,
      rankY,
      28,
      rankBoxH,
      PIXEL_BLACK,
      index === 0 ? PIXEL_RED : PIXEL_YELLOW
    );
  }
}
