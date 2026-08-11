/**
 * PPT 主题库
 *
 * 预置的视觉主题，每个主题包含：
 *   - primary / secondary / accent : 三色搭配（沿用 pptx 技能色卡）
 *   - headerFont / bodyFont       : 标题与正文字体配对
 *
 * 与 TUI/Web 端一致：暖厨房 / 午夜蓝 / 森林苔藓 / 珊瑚活力 四套基础主题。
 * 未来可通过配置文件扩展（参考 services/calculator.ts 模式）。
 *
 * @module @myopenclaw/server/modules/ppt/themes
 */

import type { ThemeMeta } from './types.js';

/**
 * 列出所有预置主题
 *
 * 调用方：/api/ppt/themes 端点 + PptGenerator.resolveTheme()
 *
 * @returns 主题元数据列表（顺序即 UI 展示顺序）
 */
export async function listThemes(): Promise<ThemeMeta[]> {
  return [
    {
      id: 'warm-kitchen',
      name: 'Warm Kitchen 暖厨房',
      primary: 'B85042',
      secondary: 'E7E8D1',
      accent: 'A7BEAE',
      headerFont: 'Georgia',
      bodyFont: 'Calibri',
    },
    {
      id: 'midnight-executive',
      name: 'Midnight Executive 午夜蓝',
      primary: '1E2761',
      secondary: 'CADCFC',
      accent: 'FFFFFF',
      headerFont: 'Arial Black',
      bodyFont: 'Arial',
    },
    {
      id: 'forest-moss',
      name: 'Forest & Moss 森林苔藓',
      primary: '2C5F2D',
      secondary: '97BC62',
      accent: 'F5F5F5',
      headerFont: 'Cambria',
      bodyFont: 'Calibri',
    },
    {
      id: 'coral-energy',
      name: 'Coral Energy 珊瑚活力',
      primary: 'F96167',
      secondary: 'F9E795',
      accent: '2F3C7E',
      headerFont: 'Trebuchet MS',
      bodyFont: 'Calibri',
    },
  ];
}

/**
 * 根据主题 ID 解析主题元数据
 *
 * 内部使用，供 PptGenerator 根据用户传入的 themeId 加载具体配色与字体。
 * 找不到时抛出 PptError，让上层路由统一捕获并返回 400。
 *
 * @param themeId 主题 ID，如 'warm-kitchen'
 * @returns 主题元数据
 * @throws Error 当 themeId 不存在时
 */
export async function resolveTheme(themeId: string): Promise<ThemeMeta> {
  const themes = await listThemes();
  const theme = themes.find((t) => t.id === themeId);
  if (!theme) {
    throw new Error(`Unknown theme: ${themeId}`);
  }
  return theme;
}
