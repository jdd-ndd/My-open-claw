/**
 * PPT 模块类型定义
 *
 * 集中导出 PptSpec / SlideSpec / ThemeMeta / TemplateMeta 等核心类型，
 * 便于 index.ts / routes.ts / themes.ts / templates.ts 共享。
 *
 * @module @myopenclaw/server/modules/ppt/types
 */

/** 模板类型枚举：cover / toc / content / divider / summary */
export type SlideTemplate =
  | 'cover'
  | 'toc'
  | 'content'
  | 'divider'
  | 'summary';

/** 完整 PPT 制作请求 */
export interface PptSpec {
  /** 主题 ID，如 'warm-kitchen' / 'midnight-executive' */
  theme: string;
  /** 幻灯片数据，按顺序排列 */
  slides: SlideSpec[];
  /** 文件名（不含扩展名），可选，默认 'presentation' */
  filename?: string;
}

/** 单张幻灯片规格 */
export interface SlideSpec {
  /** 模板类型 */
  template: SlideTemplate;
  /** 标题 */
  title: string;
  /** 副标题（可选） */
  subtitle?: string;
  /** 模板数据，按 template 类型不同采用不同字段；cover/divider/summary 可省略 */
  data?: Record<string, unknown>;
}

/** 主题元数据 */
export interface ThemeMeta {
  id: string;
  name: string;
  /** 主色（十六进制，不含 #） */
  primary: string;
  /** 辅色 */
  secondary: string;
  /** 强调色 */
  accent: string;
  /** 标题字体 */
  headerFont: string;
  /** 正文字体 */
  bodyFont: string;
}

/** 模板元数据 */
export interface TemplateMeta {
  id: string;
  type: SlideTemplate;
  name: string;
  description: string;
  /** 必填字段 schema（字段名 -> 类型描述） */
  schema: Record<string, string>;
}

/**
 * 模板对应的 data 字段类型（按 template 分支）
 *
 * - cover:   无 data，title/subtitle 由 SlideSpec 顶层承载
 * - toc:     { items: Array<{ num: string; title: string }> }
 * - content: { ingredients?: string[]; steps?: string[]; bullets?: string[]; ... }
 * - divider: 无 data
 * - summary: 无 data，title/subtitle 由 SlideSpec 顶层承载
 *
 * 在 routes 层做运行时校验，避免渲染阶段才发现缺字段。
 */
export type SlideData =
  | Record<string, never>
  | { items: Array<{ num: string; title: string }> }
  | {
      ingredients?: string[];
      steps?: string[];
      bullets?: string[];
      paragraphs?: string[];
      [key: string]: unknown;
    };
