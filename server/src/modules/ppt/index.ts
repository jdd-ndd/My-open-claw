/**
 * PPT 制作能力模块
 *
 * 集成 pptxgenjs 提供服务端 PPT 制作能力：
 *   - /api/ppt/themes      GET  列出可用主题
 *   - /api/ppt/templates   GET  列出可用模板
 *   - /api/ppt/make        POST 生成 PPT（返回 application/vnd.openxmlformats-officedocument.presentationml.presentation）
 *
 * 设计要点：
 *   1. 与 Tools/Skills 体系对齐：未来可作为 system/ppt 工具暴露给 Agent
 *   2. 服务端统一生成，多端（Web/TUI/CLI）共享同一 API
 *   3. 主题/模板解耦：前端只负责"选+填"，渲染细节由服务端管控
 *   4. 错误统一封装为 PptError，路由层做 HTTP 状态映射
 *
 * @module @myopenclaw/server/modules/ppt
 */

// pptxgenjs v4 在 ESM 运行时导出嵌套 default（_pkg.default.default 为构造函数）
// 兼容 tsx 与 node ESM 双运行时
import { default as _pptxDefault } from 'pptxgenjs';

// 提取构造函数类型（避开变量名与类型名冲突）
type PptxGenCtor = (new () => PptxInstance) & typeof _pptxDefault;
interface PptxInstance {
  addSlide(): PptxSlide;
  author: string;
  company: string;
  title: string;
  write(opts: { outputType: 'arraybuffer' | 'nodebuffer' | 'base64' | 'binarystring' | 'uint8array' | 'blob' | 'stream' }): Promise<unknown>;
}
interface PptxSlide {
  background?: { color: string };
  /**
   * addText 接受 string 或 文本片段数组（TextProps[]）
   * 文本片段格式：{ text: string; options?: Record<string, unknown> }
   */
  addText(text: string | Array<{ text: string; options?: Record<string, unknown> }>, opts: Record<string, unknown>): void;
}

const PptxGenJS = ((_pptxDefault as unknown as { default?: PptxGenCtor }).default
  ?? (_pptxDefault as unknown as PptxGenCtor));
import { listThemes, resolveTheme } from './themes.js';
import { listTemplates } from './templates.js';
import type {
  PptSpec,
  SlideSpec,
  ThemeMeta,
  TemplateMeta,
} from './types.js';

/**
 * PPT 模块对外暴露的接口
 *
 * 实现类见 createPptModule()，便于在测试中注入 mock。
 */
export interface PptModule {
  /** 生成 PPT 文件，返回二进制 Buffer */
  generatePptx(spec: PptSpec): Promise<Buffer>;
  /** 列出所有可用主题 */
  listThemes(): Promise<ThemeMeta[]>;
  /** 列出所有可用模板 */
  listTemplates(): Promise<TemplateMeta[]>;
}

/**
 * PPT 错误
 *
 * 派生自 Error，路由层通过 instanceof 检测并转换为 HTTP 400/500 响应。
 */
export class PptError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'PPT_INVALID_SPEC'
      | 'PPT_UNKNOWN_THEME'
      | 'PPT_UNKNOWN_TEMPLATE'
      | 'PPT_GENERATION_FAILED',
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'PptError';
  }
}

/**
 * 创建 PPT 模块实例
 *
 * 工厂方法：把所有依赖（themes/templates）注入到闭包，
 * 便于将来替换为数据库/配置文件驱动的实现。
 */
export async function createPptModule(): Promise<PptModule> {
  return {
    generatePptx: (spec) => generatePptx(spec),
    listThemes,
    listTemplates,
  };
}

/* ============================================================
 * 核心：PPT 生成
 * ============================================================ */

/**
 * 生成 PPT 二进制
 *
 * 流程：
 *   1. 校验 spec 合法性
 *   2. 解析主题
 *   3. 遍历 slides 调用对应 renderXxxSlide()
 *   4. 调用 pptx.write() 输出 Buffer
 *
 * @param spec PPT 制作请求
 * @returns PPTX 二进制 Buffer
 * @throws PptError 当 spec 非法、主题不存在、生成失败时
 */
export async function generatePptx(spec: PptSpec): Promise<Buffer> {
  // 1. 基础校验
  if (!spec || !Array.isArray(spec.slides) || spec.slides.length === 0) {
    throw new PptError(
      'PptSpec.slides must be a non-empty array',
      'PPT_INVALID_SPEC',
    );
  }

  // 2. 解析主题（找不到则抛错）
  let theme: ThemeMeta;
  try {
    theme = await resolveTheme(spec.theme);
  } catch (err) {
    throw new PptError(
      err instanceof Error ? err.message : 'Theme resolution failed',
      'PPT_UNKNOWN_THEME',
    );
  }

  // 3. 创建 PptxGenJS 实例并设置元数据
  const pptx = new PptxGenJS();
  pptx.author = 'MyOpenClaw';
  pptx.company = 'MyOpenClaw';
  pptx.title = spec.filename || 'Presentation';

  // 4. 遍历幻灯片
  for (let idx = 0; idx < spec.slides.length; idx++) {
    const slide = spec.slides[idx];
    try {
      renderSlide(pptx, theme, slide);
    } catch (err) {
      throw new PptError(
        `Failed to render slide ${idx + 1}: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
        'PPT_GENERATION_FAILED',
        true,
      );
    }
  }

  // 5. 输出 Buffer
  try {
    const arrayBuffer = await pptx.write({ outputType: 'arraybuffer' });
    return Buffer.from(new Uint8Array(arrayBuffer as ArrayBuffer));
  } catch (err) {
    throw new PptError(
      `pptxgenjs write failed: ${
        err instanceof Error ? err.message : 'unknown'
      }`,
      'PPT_GENERATION_FAILED',
      true,
    );
  }
}

/**
 * 派发到具体模板的渲染函数
 *
 * 类似"策略模式"：每种 SlideTemplate 对应一个 render* 函数。
 * 新增模板时只需在此处加一个 case + 实现函数。
 */
function renderSlide(
  pptx: PptxInstance,
  theme: ThemeMeta,
  slide: SlideSpec,
): void {
  switch (slide.template) {
    case 'cover':
      renderCoverSlide(pptx, theme, slide);
      return;
    case 'toc':
      renderTocSlide(pptx, theme, slide);
      return;
    case 'content':
      renderContentSlide(pptx, theme, slide);
      return;
    case 'divider':
      renderDividerSlide(pptx, theme, slide);
      return;
    case 'summary':
      renderSummarySlide(pptx, theme, slide);
      return;
    default: {
      // 编译期禁止，但运行时仍兜底
      const exhaustive: never = slide.template;
      throw new PptError(
        `Unknown slide template: ${String(exhaustive)}`,
        'PPT_UNKNOWN_TEMPLATE',
      );
    }
  }
}

/* ============================================================
 * 模板渲染实现
 *
 * 布局约定（16:9 英寸, 10" x 5.625"）：
 *   - 左/右安全边距 0.5"
 *   - 标题区纵向 0.4-1.2"
 *   - 内容区纵向 1.4-5.4"
 * ============================================================ */

/** 封面：主色背景 + 大标题 + 副标题 */
function renderCoverSlide(
  pptx: PptxInstance,
  theme: ThemeMeta,
  slide: SlideSpec,
): void {
  const s = pptx.addSlide();
  s.background = { color: theme.primary };

  s.addText(slide.title, {
    x: 0.5,
    y: 2.0,
    w: 9.0,
    h: 1.5,
    fontSize: 44,
    bold: true,
    color: 'FFFFFF',
    fontFace: theme.headerFont,
    align: 'left',
  });

  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: 0.5,
      y: 3.5,
      w: 9.0,
      h: 0.8,
      fontSize: 20,
      color: theme.secondary,
      fontFace: theme.bodyFont,
      align: 'left',
    });
  }
}

/** 目录：白底 + 编号 + 标题列表 */
function renderTocSlide(
  pptx: PptxInstance,
  theme: ThemeMeta,
  slide: SlideSpec,
): void {
  const s = pptx.addSlide();
  s.background = { color: 'FFFFFF' };

  s.addText(slide.title, {
    x: 0.5,
    y: 0.4,
    w: 9.0,
    h: 0.7,
    fontSize: 32,
    bold: true,
    color: theme.primary,
    fontFace: theme.headerFont,
  });

  const items = (slide.data?.items as
    | Array<{ num: string; title: string }>
    | undefined) ?? [];

  items.forEach((item, idx) => {
    s.addText(item.num, {
      x: 0.8,
      y: 1.5 + idx * 0.7,
      w: 0.8,
      h: 0.5,
      fontSize: 24,
      bold: true,
      color: theme.accent,
      fontFace: theme.headerFont,
    });
    s.addText(item.title, {
      x: 1.8,
      y: 1.5 + idx * 0.7,
      w: 7.0,
      h: 0.5,
      fontSize: 18,
      color: '333333',
      fontFace: theme.bodyFont,
    });
  });
}

/**
 * 内容页：通用两栏 / 单栏布局
 *
 * 自动识别 data 中包含的字段：
 *   - ingredients + steps → 左栏食材 + 右栏步骤（菜谱布局）
 *   - bullets            → 单栏 bullet 列表
 *   - paragraphs         → 单栏段落
 *   - 其它               → 降级为 JSON 文本（调试用）
 */
function renderContentSlide(
  pptx: PptxInstance,
  theme: ThemeMeta,
  slide: SlideSpec,
): void {
  const s = pptx.addSlide();
  s.background = { color: 'FFFFFF' };

  s.addText(slide.title, {
    x: 0.5,
    y: 0.4,
    w: 9.0,
    h: 0.7,
    fontSize: 28,
    bold: true,
    color: theme.primary,
    fontFace: theme.headerFont,
  });

  const data = slide.data ?? {};

  // 菜谱布局：左食材 + 右步骤
  if (Array.isArray(data.ingredients) || Array.isArray(data.steps)) {
    const ingredients = (data.ingredients as string[] | undefined) ?? [];
    const steps = (data.steps as string[] | undefined) ?? [];

    s.addText('食材', {
      x: 0.5, y: 1.4, w: 4.0, h: 0.5,
      fontSize: 18, bold: true, color: theme.accent,
      fontFace: theme.headerFont,
    });
    s.addText(
      ingredients.map((t) => ({ text: '• ' + t, options: {} })),
      {
        x: 0.5, y: 2.0, w: 4.0, h: 3.5,
        fontSize: 14, color: '333333',
        fontFace: theme.bodyFont,
      },
    );

    s.addText('步骤', {
      x: 5.0, y: 1.4, w: 4.5, h: 0.5,
      fontSize: 18, bold: true, color: theme.accent,
      fontFace: theme.headerFont,
    });
    s.addText(
      steps.map((t, i) => ({ text: `${i + 1}. ${t}\n`, options: {} })),
      {
        x: 5.0, y: 2.0, w: 4.5, h: 3.5,
        fontSize: 14, color: '333333',
        fontFace: theme.bodyFont,
      },
    );
    return;
  }

  // 单栏 bullet 列表
  if (Array.isArray(data.bullets)) {
    const bullets = data.bullets as string[];
    s.addText(
      bullets.map((t) => ({ text: '• ' + t, options: {} })),
      {
        x: 0.5, y: 1.4, w: 9.0, h: 4.0,
        fontSize: 16, color: '333333',
        fontFace: theme.bodyFont,
      },
    );
    return;
  }

  // 单栏段落
  if (Array.isArray(data.paragraphs)) {
    const paragraphs = data.paragraphs as string[];
    s.addText(
      paragraphs.map((p) => ({ text: p + '\n\n', options: {} })),
      {
        x: 0.5, y: 1.4, w: 9.0, h: 4.0,
        fontSize: 14, color: '333333',
        fontFace: theme.bodyFont,
      },
    );
    return;
  }

  // 兜底：把 data 序列化为 JSON 字符串（调试时方便）
  s.addText(JSON.stringify(data, null, 2), {
    x: 0.5, y: 1.4, w: 9.0, h: 4.0,
    fontSize: 12, color: '666666',
    fontFace: 'Consolas',
  });
}

/** 分隔页：辅色背景 + 居中大标题 */
function renderDividerSlide(
  pptx: PptxInstance,
  theme: ThemeMeta,
  slide: SlideSpec,
): void {
  const s = pptx.addSlide();
  s.background = { color: theme.secondary };

  s.addText(slide.title, {
    x: 0.5,
    y: 2.2,
    w: 9.0,
    h: 1.5,
    fontSize: 48,
    bold: true,
    color: theme.primary,
    fontFace: theme.headerFont,
    align: 'center',
  });
}

/** 结尾：主色背景 + 标题 + 副标题 */
function renderSummarySlide(
  pptx: PptxInstance,
  theme: ThemeMeta,
  slide: SlideSpec,
): void {
  const s = pptx.addSlide();
  s.background = { color: theme.primary };

  s.addText(slide.title, {
    x: 0.5,
    y: 2.0,
    w: 9.0,
    h: 1.5,
    fontSize: 40,
    bold: true,
    color: 'FFFFFF',
    fontFace: theme.headerFont,
    align: 'center',
  });

  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: 0.5,
      y: 3.5,
      w: 9.0,
      h: 0.8,
      fontSize: 18,
      color: theme.secondary,
      fontFace: theme.bodyFont,
      align: 'center',
    });
  }
}
