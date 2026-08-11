/**
 * 颜色与样式常量
 * Ink 支持的色名: black red green yellow blue magenta cyan white gray
 */

export const color = {
  primary: 'cyan',
  muted: 'gray',
  success: 'green',
  warning: 'yellow',
  danger: 'red',
  highlight: 'white',
  accent: 'magenta',
  info: 'blue',
} as const;

export type ColorToken = keyof typeof color;
