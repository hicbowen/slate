import { Injectable } from '@nestjs/common';
import { FRAME_BYTES, FRAME_BYTES_BWRY2, FRAME_HEIGHT, FRAME_WIDTH } from 'shared';
import { BitmapCanvas, PIXEL_RED, PIXEL_WHITE, PIXEL_YELLOW } from './bitmap-canvas';
import {
  renderDailyCalendarFrame,
  renderHistoryTodayFrame,
  renderMonthCalendarFrame,
} from './calendar-frame-renderer';
import { renderDashboardFrame } from './dashboard-frame-renderer';
import type { DynamicRenderContext } from './dynamic-render-context';
import { renderEarthquakeReportFrame } from './earthquake-frame-renderer';
import { FrameDrawKit } from './frame-draw-kit';
import { STATUS_BAR_H } from './frame-renderer-layout';
import { DynamicFrameFontService, type FontSet } from './fonts/dynamic-frame-font.service';
import { renderFontTestFrame } from './font-test-frame-renderer';
import { renderHotListFrame } from './hot-list-frame-renderer';
import { renderWeatherAlertFrame, renderWeatherFrame } from './weather-frame-renderer';

export type { DynamicRenderContext } from './dynamic-render-context';

export interface DynamicFrameRenditions {
  mono1: Buffer;
  bwry2: Buffer;
}

@Injectable()
export class DynamicFrameRendererService {
  private readonly drawKit: FrameDrawKit;

  constructor(private readonly fontService: DynamicFrameFontService) {
    this.drawKit = new FrameDrawKit(fontService);
  }

  async render(ctx: DynamicRenderContext): Promise<Buffer> {
    return (await this.renderRenditions(ctx)).mono1;
  }

  async renderRenditions(ctx: DynamicRenderContext): Promise<DynamicFrameRenditions> {
    const fonts = await this.fontService.getFonts();
    const c = new BitmapCanvas(FRAME_WIDTH, FRAME_HEIGHT);
    c.clear(PIXEL_WHITE);
    this.clearSystemStatusArea(c);

    switch (ctx.type) {
      case 'daily_calendar':
        renderDailyCalendarFrame(c, fonts, ctx, this.drawKit);
        break;
      case 'month_calendar':
        renderMonthCalendarFrame(c, fonts, ctx, this.drawKit);
        break;
      case 'weather':
        await renderWeatherFrame(c, fonts, ctx, this.drawKit);
        break;
      case 'history_today':
        renderHistoryTodayFrame(c, fonts, ctx, this.drawKit);
        break;
      case 'weather_alert':
        renderWeatherAlertFrame(c, fonts, ctx, this.drawKit);
        break;
      case 'earthquake_report':
        renderEarthquakeReportFrame(c, fonts, ctx, this.drawKit);
        break;
      case 'dashboard':
        renderDashboardFrame(c, fonts, ctx, this.drawKit);
        break;
      case 'font_test':
        renderFontTestFrame(c, fonts, ctx, this.drawKit);
        break;
      case 'hot_list':
        renderHotListFrame(c, fonts, ctx, this.drawKit);
        break;
      default:
        this.renderFallback(c, fonts, `未知动态类型 ${ctx.type}`);
        break;
    }

    this.applySemanticAccent(c, ctx.type);
    const mono1 = c.toRaw1bpp();
    const bwry2 = c.toRaw2bpp();
    if (mono1.byteLength !== FRAME_BYTES || bwry2.byteLength !== FRAME_BYTES_BWRY2) {
      throw new Error(
        `dynamic frame size mismatch: ${mono1.byteLength}/${bwry2.byteLength} vs ${FRAME_BYTES}/${FRAME_BYTES_BWRY2}`
      );
    }
    return { mono1, bwry2 };
  }

  private clearSystemStatusArea(c: BitmapCanvas): void {
    c.fillRect(0, 0, FRAME_WIDTH, STATUS_BAR_H, PIXEL_WHITE);
  }

  private renderFallback(c: BitmapCanvas, fonts: FontSet, message: string): void {
    this.drawKit.drawText(c, fonts.sans16, message, 200, 140, {
      align: 'center',
      maxWidth: 320,
      maxLines: 2,
      ellipsis: true,
    });
  }

  private applySemanticAccent(c: BitmapCanvas, type: string): void {
    // 彩色只承担低频语义提示，不改变黑白版的信息结构。
    if (type === 'weather_alert' || type === 'earthquake_report') {
      c.fillRect(0, STATUS_BAR_H, 4, FRAME_HEIGHT - STATUS_BAR_H, PIXEL_RED);
    } else if (type === 'daily_calendar' || type === 'month_calendar' || type === 'weather') {
      c.fillRect(0, STATUS_BAR_H, 4, FRAME_HEIGHT - STATUS_BAR_H, PIXEL_YELLOW);
    }
  }
}
