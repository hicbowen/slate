// Mono Press 颜色常量，与 global.css 中的 design tokens 保持同步。
//
// Canvas 渲染无法使用 CSS 变量，因此需要硬编码 RGB 值。
// 修改颜色时请同步更新 global.css 中的 --color-paper 和 --color-ink。

/** 纸本底色 #f5f3ed */
export const PAPER_RGB = [0xf5, 0xf3, 0xed] as const;

/** 墨色 #14110d */
export const INK_RGB = [0x14, 0x11, 0x0d] as const;

/** Note4C 红色墨水的管理端模拟色 */
export const RED_RGB = [0xb9, 0x2b, 0x27] as const;

/** Note4C 黄色墨水的管理端模拟色 */
export const YELLOW_RGB = [0xd9, 0xa5, 0x00] as const;

/** 纸本底色 CSS 字符串 */
export const PAPER_HEX = '#f5f3ed';

/** 墨色 CSS 字符串 */
export const INK_HEX = '#14110d';
