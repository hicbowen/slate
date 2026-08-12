import { FRAME_HEIGHT, FRAME_WIDTH } from 'shared';
import { BitmapCanvas, PIXEL_BLACK } from './bitmap-canvas';
import type { DynamicRenderContext } from './dynamic-render-context';
import type { FrameDrawKit } from './frame-draw-kit';
import type { FontSet } from './fonts/dynamic-frame-font.service';
import { pickText, readInt } from './helpers/frame-value-utils';

export const COUNTDOWN_FRAME = {
  outerX: 12,
  outerY: 30,
  outerW: FRAME_WIDTH - 24,
  outerH: FRAME_HEIGHT - 38,
  headerDateX: 300,
  headerY: 42,
  headerW: 76,
  headerH: 18,
  titleRuleX: 136,
  titleRuleY: 119,
  titleRuleW: 128,
  numberTop: 126,
  numberHeight: 98,
} as const;

export function renderCountdownFrame(
  c: BitmapCanvas,
  fonts: FontSet,
  ctx: DynamicRenderContext,
  draw: FrameDrawKit
): void {
  const goal = pickText(ctx.config.goal, '重要的日子');
  const targetDate = pickText(ctx.config.target_date, '---- -- --');
  const remainingDays = readInt(ctx.data?.remainingDays, 0, 0, 9_999_999);
  const goalFont = fonts.catalog.zfull_gb_18 ?? fonts.sans16;
  const shortTargetDate = targetDate.slice(5).replace('-', '/');

  c.strokeRect(
    COUNTDOWN_FRAME.outerX,
    COUNTDOWN_FRAME.outerY,
    COUNTDOWN_FRAME.outerW,
    COUNTDOWN_FRAME.outerH,
    PIXEL_BLACK
  );
  draw.drawText(c, fonts.sans12, '倒数日', 24, COUNTDOWN_FRAME.headerY, {
    maxWidth: 80,
  });
  draw.drawText(c, fonts.metric12, shortTargetDate, 376, COUNTDOWN_FRAME.headerY, {
    align: 'right',
    maxWidth: COUNTDOWN_FRAME.headerW,
  });

  drawGoal(c, fonts, goalFont, goal, draw);
  draw.drawRule(
    c,
    COUNTDOWN_FRAME.titleRuleX,
    COUNTDOWN_FRAME.titleRuleY,
    COUNTDOWN_FRAME.titleRuleW,
    'solid'
  );

  const dayText = String(remainingDays);
  const numberScale = dayText.length <= 4 ? 2 : 1;
  const numberWidth = draw.textWidth(fonts.displayLarge, dayText) * numberScale;
  const numberLeft = Math.round((FRAME_WIDTH - numberWidth) / 2);
  const numberCenterY = 180;
  const numberLineTop = numberCenterY - 33 * numberScale;
  const numberBaseline =
    numberLineTop + (fonts.displayLarge.lineHeight - fonts.displayLarge.baseLine) * numberScale;
  c.drawTextScaled(
    fonts.displayLarge,
    dayText,
    numberLeft,
    numberBaseline,
    numberScale,
    PIXEL_BLACK
  );

  draw.drawText(c, fonts.sans16, '天', FRAME_WIDTH / 2, 226, {
    align: 'center',
    maxWidth: 40,
  });
  draw.drawText(c, fonts.sans16, `目标日 · ${targetDate}`, FRAME_WIDTH / 2, 257, {
    align: 'center',
    maxWidth: 280,
  });
}

function drawGoal(
  c: BitmapCanvas,
  fonts: FontSet,
  goalFont: FontSet['sans16'],
  goal: string,
  draw: FrameDrawKit
): void {
  const canScale =
    [...goal].every((char) => goalFont.glyphs.has(char.codePointAt(0)!)) &&
    draw.textWidth(goalFont, goal) * 2 <= 316;
  if (!canScale) {
    draw.drawStrongText(c, fonts.sans16, goal, FRAME_WIDTH / 2, 78, {
      align: 'center',
      maxWidth: 320,
      ellipsis: true,
    });
    return;
  }

  const scale = 2;
  const width = draw.textWidth(goalFont, goal) * scale;
  const lineTop = 70;
  const baseline = lineTop + (goalFont.lineHeight - goalFont.baseLine) * scale;
  c.drawTextScaled(goalFont, goal, Math.round((FRAME_WIDTH - width) / 2), baseline, scale);
}
