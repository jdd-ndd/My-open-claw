/**
 * Markdown 处理工具
 *
 * [占位] Mermaid 图表渲染尚未实现，当前仅做纯文本 Markdown 渲染。
 * [占位] 自定义 Markdown 组件（如 Thinking 动画）尚未实现。
 */

/** 简单检测文本是否包含代码块 */
export function hasCodeBlock(text: string): boolean {
  return /```[\s\S]*?```/.test(text);
}

/** 提取代码块语言 */
export function extractCodeLanguage(text: string): string | undefined {
  const match = text.match(/```(\w+)/);
  return match ? match[1] : undefined;
}
