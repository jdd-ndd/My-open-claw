# 项目内 PPT 制作能力集成方案

## 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│  客户端 (Web / TUI / CLI)                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Web 工作台   │  │ TUI 命令     │  │ CLI 命令     │     │
│  │ PptStudio.tsx│  │ /ppt 面板    │  │ myopenclaw   │     │
│  │              │  │              │  │ ppt make     │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│         └─────────────────┼─────────────────┘              │
│                           │ HTTP / WebSocket                 │
└───────────────────────────┼─────────────────────────────────┘
                            ▼
┌───────────────────────────────────────────────────────────────┐
│  Gateway 服务端 (server/src/modules/ppt/)                      │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐  │
│  │ /api/ppt/      │  │ /api/ppt/      │  │ /api/ppt/      │  │
│  │ templates      │  │ make           │  │ themes         │  │
│  └───────┬────────┘  └────────┬───────┘  └────────┬───────┘  │
│          └────────────────────┼────────────────────┘          │
│                               ▼                                │
│                  ┌────────────────────────┐                    │
│                  │ PptGenerator (pptxgenjs)│                    │
│                  └────────┬───────────────┘                    │
│                           ▼                                    │
│                  ┌────────────────────────┐                    │
│                  │ 文件存储 (.pptx 二进制) │                    │
│                  └────────────────────────┘                    │
└───────────────────────────────────────────────────────────────┘
```

## 第一步：服务端注册 PPT 模块

文件: `server/src/modules/ppt/index.ts`

```typescript
/**
 * PPT 制作能力模块
 *
 * 集成 pptxgenjs 提供服务端 PPT 制作能力，
 * 与 Tools/Skills 体系对齐，通过 /api/ppt/* 端点暴露。
 */
import PptxGenJS from 'pptxgenjs';
import { registerRoutes } from './routes';
import { listThemes } from './themes';
import { listTemplates } from './templates';

export interface PptModule {
  /** 生成 PPT 文件，返回二进制 Buffer */
  generatePptx(spec: PptSpec): Promise<Buffer>;
  /** 列出所有可用主题 */
  listThemes(): Promise<ThemeMeta[]>;
  /** 列出所有可用模板（封面 / 目录 / 内容 / 结尾） */
  listTemplates(): Promise<TemplateMeta[]>;
}

export interface PptSpec {
  /** 主题 ID，如 'warm-kitchen' / 'midnight-executive' */
  theme: string;
  /** 幻灯片数据，按顺序排列 */
  slides: SlideSpec[];
  /** 文件名（不含扩展名） */
  filename?: string;
}

export interface SlideSpec {
  /** 模板类型：cover / toc / content / divider / summary */
  template: 'cover' | 'toc' | 'content' | 'divider' | 'summary';
  /** 标题 */
  title: string;
  /** 副标题（可选） */
  subtitle?: string;
  /** 模板数据，按 template 类型不同 */
  data: Record<string, unknown>;
}

export interface ThemeMeta {
  id: string;
  name: string;
  /** 主色 / 辅色 / 强调色（十六进制） */
  primary: string;
  secondary: string;
  accent: string;
  /** 字体配对 */
  headerFont: string;
  bodyFont: string;
}

export interface TemplateMeta {
  id: string;
  type: SlideSpec['template'];
  name: string;
  description: string;
  /** 必填字段 schema */
  schema: Record<string, string>;
}

export async function createPptModule(): Promise<PptModule> {
  return {
    async generatePptx(spec) {
      const pptx = new PptxGenJS();
      // 设置主题色与字体
      const theme = await resolveTheme(spec.theme);
      pptx.author = 'MyOpenClaw';
      pptx.company = 'MyOpenClaw';

      for (const slide of spec.slides) {
        await renderSlide(pptx, theme, slide);
      }

      const filename = (spec.filename || 'presentation') + '.pptx';
      return (await pptx.write({ outputType: 'arraybuffer' })) as ArrayBuffer
        .then((buf) => Buffer.from(new Uint8Array(buf as ArrayBuffer)));
    },
    listThemes,
    listTemplates,
  };
}

/** 内部：根据 theme id 加载主题元数据 */
async function resolveTheme(themeId: string): Promise<ThemeMeta> {
  const themes = await listThemes();
  const theme = themes.find((t) => t.id === themeId);
  if (!theme) throw new Error(`Unknown theme: ${themeId}`);
  return theme;
}

/** 内部：分发到不同的模板渲染器 */
async function renderSlide(
  pptx: PptxGenJS,
  theme: ThemeMeta,
  slide: SlideSpec,
): Promise<void> {
  switch (slide.template) {
    case 'cover':
      return renderCoverSlide(pptx, theme, slide);
    case 'toc':
      return renderTocSlide(pptx, theme, slide);
    case 'content':
      return renderContentSlide(pptx, theme, slide);
    case 'divider':
      return renderDividerSlide(pptx, theme, slide);
    case 'summary':
      return renderSummarySlide(pptx, theme, slide);
    default:
      throw new Error(`Unknown slide template: ${slide.template}`);
  }
}

/* ---------- 各模板渲染实现 ---------- */

function renderCoverSlide(pptx: PptxGenJS, theme: ThemeMeta, slide: SlideSpec) {
  const s = pptx.addSlide();
  s.background = { color: theme.primary };
  s.addText(slide.title, {
    x: 0.5, y: 2.0, w: 9.0, h: 1.5,
    fontSize: 44, bold: true, color: 'FFFFFF',
    fontFace: theme.headerFont, align: 'left',
  });
  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: 0.5, y: 3.5, w: 9.0, h: 0.8,
      fontSize: 20, color: theme.secondary,
      fontFace: theme.bodyFont, align: 'left',
    });
  }
}

function renderTocSlide(pptx: PptxGenJS, theme: ThemeMeta, slide: SlideSpec) {
  const s = pptx.addSlide();
  s.background = { color: 'FFFFFF' };
  s.addText(slide.title, {
    x: 0.5, y: 0.4, w: 9.0, h: 0.7,
    fontSize: 32, bold: true, color: theme.primary,
    fontFace: theme.headerFont,
  });
  const items = (slide.data.items as Array<{ num: string; title: string }>) || [];
  items.forEach((item, idx) => {
    s.addText(item.num, {
      x: 0.8, y: 1.5 + idx * 0.7, w: 0.8, h: 0.5,
      fontSize: 24, bold: true, color: theme.accent,
    });
    s.addText(item.title, {
      x: 1.8, y: 1.5 + idx * 0.7, w: 7.0, h: 0.5,
      fontSize: 18, color: '333333',
      fontFace: theme.bodyFont,
    });
  });
}

function renderContentSlide(pptx: PptxGenJS, theme: ThemeMeta, slide: SlideSpec) {
  const s = pptx.addSlide();
  s.background = { color: 'FFFFFF' };
  s.addText(slide.title, {
    x: 0.5, y: 0.4, w: 9.0, h: 0.7,
    fontSize: 28, bold: true, color: theme.primary,
    fontFace: theme.headerFont,
  });
  // 子内容：左右两栏（食材 | 步骤）
  const data = slide.data as {
    ingredients: string[];
    steps: string[];
  };
  s.addText('食材', {
    x: 0.5, y: 1.4, w: 4.0, h: 0.5,
    fontSize: 18, bold: true, color: theme.accent,
  });
  s.addText(
    data.ingredients.map((t) => ({ text: '• ' + t, options: {} })),
    { x: 0.5, y: 2.0, w: 4.0, h: 4.5, fontSize: 14, color: '333333' },
  );
  s.addText('步骤', {
    x: 5.0, y: 1.4, w: 4.5, h: 0.5,
    fontSize: 18, bold: true, color: theme.accent,
  });
  s.addText(
    data.steps.map((t, i) => ({
      text: `${i + 1}. ${t}\n`,
      options: {},
    })),
    { x: 5.0, y: 2.0, w: 4.5, h: 4.5, fontSize: 14, color: '333333' },
  );
}

function renderDividerSlide(pptx: PptxGenJS, theme: ThemeMeta, slide: SlideSpec) {
  const s = pptx.addSlide();
  s.background = { color: theme.secondary };
  s.addText(slide.title, {
    x: 0.5, y: 3.0, w: 9.0, h: 1.5,
    fontSize: 48, bold: true, color: theme.primary,
    align: 'center', fontFace: theme.headerFont,
  });
}

function renderSummarySlide(pptx: PptxGenJS, theme: ThemeMeta, slide: SlideSpec) {
  const s = pptx.addSlide();
  s.background = { color: theme.primary };
  s.addText(slide.title, {
    x: 0.5, y: 2.0, w: 9.0, h: 1.5,
    fontSize: 36, bold: true, color: 'FFFFFF',
    fontFace: theme.headerFont, align: 'center',
  });
  s.addText(slide.subtitle || '', {
    x: 0.5, y: 3.5, w: 9.0, h: 0.8,
    fontSize: 18, color: theme.secondary, align: 'center',
  });
}
```

文件: `server/src/modules/ppt/routes.ts`

```typescript
/**
 * PPT 模块 HTTP 路由注册
 *
 * 端点：
 *   GET  /api/ppt/themes       - 列出所有主题
 *   GET  /api/ppt/templates    - 列出所有模板
 *   POST /api/ppt/make         - 生成 PPT，返回 pptx 二进制（application/vnd.openxmlformats）
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PptModule, PptSpec } from './index';

export function registerPptRoutes(app: FastifyInstance, module: PptModule) {
  app.get('/api/ppt/themes', async () => {
    return { ok: true, data: { themes: await module.listThemes() } };
  });

  app.get('/api/ppt/templates', async () => {
    return { ok: true, data: { templates: await module.listTemplates() } };
  });

  app.post('/api/ppt/make', async (req: FastifyRequest, reply: FastifyReply) => {
    const spec = req.body as PptSpec;
    if (!spec || !Array.isArray(spec.slides)) {
      return reply.code(400).send({ ok: false, error: 'Invalid spec' });
    }
    const buffer = await module.generatePptx(spec);
    return reply
      .code(200)
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
      .header('Content-Disposition', `attachment; filename="${spec.filename || 'presentation'}.pptx"`)
      .send(buffer);
  });
}
```

文件: `server/src/modules/ppt/themes.ts`

```typescript
/**
 * 预置主题库（与 pptx 技能对齐）
 */
import { ThemeMeta } from './index';

export async function listThemes(): Promise<ThemeMeta[]> {
  return [
    {
      id: 'warm-kitchen',
      name: 'Warm Kitchen 暖厨房',
      primary: 'B85042', secondary: 'E7E8D1', accent: 'A7BEAE',
      headerFont: 'Georgia', bodyFont: 'Calibri',
    },
    {
      id: 'midnight-executive',
      name: 'Midnight Executive 午夜蓝',
      primary: '1E2761', secondary: 'CADCFC', accent: 'FFFFFF',
      headerFont: 'Arial Black', bodyFont: 'Arial',
    },
    {
      id: 'forest-moss',
      name: 'Forest & Moss 森林苔藓',
      primary: '2C5F2D', secondary: '97BC62', accent: 'F5F5F5',
      headerFont: 'Cambria', bodyFont: 'Calibri',
    },
    {
      id: 'coral-energy',
      name: 'Coral Energy 珊瑚活力',
      primary: 'F96167', secondary: 'F9E795', accent: '2F3C7E',
      headerFont: 'Trebuchet MS', bodyFont: 'Calibri',
    },
  ];
}
```

文件: `server/src/modules/ppt/templates.ts`

```typescript
/**
 * PPT 模板类型注册
 */
import { TemplateMeta } from './index';

export async function listTemplates(): Promise<TemplateMeta[]> {
  return [
    {
      id: 'cover-classic',
      type: 'cover',
      name: '经典封面',
      description: '主色背景 + 大标题 + 副标题',
      schema: { title: 'string', subtitle: 'string?' },
    },
    {
      id: 'toc-numbered',
      type: 'toc',
      name: '编号目录',
      description: '章节编号 + 标题列表',
      schema: { items: 'Array<{num: string, title: string}>' },
    },
    {
      id: 'content-recipe',
      type: 'content',
      name: '菜谱内容（食材 + 步骤）',
      description: '左栏食材、右栏步骤',
      schema: { ingredients: 'string[]', steps: 'string[]' },
    },
    {
      id: 'divider-section',
      type: 'divider',
      name: '章节分隔',
      description: '辅色背景 + 大标题',
      schema: { title: 'string' },
    },
    {
      id: 'summary-close',
      type: 'summary',
      name: '结尾页',
      description: '主色背景 + 总结标题 + 副标题',
      schema: { title: 'string', subtitle: 'string?' },
    },
  ];
}
```

### 3. 注册到 Gateway

文件: `server/src/gateway/server/http-routes.ts` 中追加：

```typescript
import { createPptModule } from '../../modules/ppt/index';
import { registerPptRoutes } from '../../modules/ppt/routes';

export async function registerPptCapability(app: FastifyInstance) {
  const pptModule = await createPptModule();
  registerPptRoutes(app, pptModule);
  console.log('[ppt] module registered: /api/ppt/{themes,templates,make}');
}
```

并在 `app.ts` 启动时调用 `await registerPptCapability(app)`。

## 第二步：Web 端工作台

文件: `clients/web/src/views/PptStudio.tsx`

```tsx
/**
 * Web 端 PPT 制作工作台
 *
 * 流程：选主题 → 选模板 → 填内容 → 一键生成下载
 */
import { useState, useEffect } from 'react';
import { http } from '../api/http';

interface Theme { id: string; name: string; primary: string; secondary: string; accent: string; }
interface Template { id: string; type: string; name: string; description: string; schema: Record<string, string>; }

export function PptStudio() {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [themeId, setThemeId] = useState('warm-kitchen');
  const [slides, setSlides] = useState<any[]>([
    { template: 'cover', title: '我的菜谱', subtitle: '精选 3 道家常菜', data: {} },
  ]);

  useEffect(() => {
    http.get('/api/ppt/themes').then((r) => setThemes(r.data.data.themes));
    http.get('/api/ppt/templates').then((r) => setTemplates(r.data.data.templates));
  }, []);

  const generatePpt = async () => {
    const res = await http.post('/api/ppt/make', {
      theme: themeId,
      slides,
      filename: 'recipes',
    }, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url; a.download = 'recipes.pptx'; a.click();
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">PPT 工作台</h1>
      <div className="grid grid-cols-3 gap-4">
        {/* 主题选择器 */}
        <select value={themeId} onChange={(e) => setThemeId(e.target.value)}>
          {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {/* 模板选择器 */}
        <select>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button onClick={generatePpt} className="bg-orange-500 text-white px-4 py-2 rounded">
          生成 PPT
        </button>
      </div>
      {/* 幻灯片编辑区 */}
      <div className="mt-4">
        {slides.map((s, i) => (
          <div key={i} className="border p-3 mb-2 rounded">
            <span className="font-mono text-sm">{s.template}</span>
            <input
              className="ml-2 border-b"
              value={s.title}
              onChange={(e) => {
                const next = [...slides]; next[i].title = e.target.value; setSlides(next);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
```

## 第三步：CLI 端命令

文件: `clients/cli/src/commands/ppt.ts`

```typescript
/**
 * CLI: myopenclaw ppt make
 *
 * 用法:
 *   myopenclaw ppt make --theme warm-kitchen --out recipes.pptx
 *   myopenclaw ppt themes                    # 列出主题
 *   myopenclaw ppt templates                 # 列出模板
 */
import { Command } from 'commander';
import * as fs from 'fs/promises';
import { gateway } from '../api/gateway';

export const pptCommand = new Command('ppt')
  .description('PPT 制作命令')
  .addCommand(
    new Command('make')
      .requiredOption('-t, --theme <id>', '主题 ID')
      .requiredOption('-o, --out <path>', '输出文件')
      .requiredOption('-s, --spec <path>', '幻灯片 JSON 文件')
      .action(async (opts) => {
        const spec = JSON.parse(await fs.readFile(opts.spec, 'utf-8'));
        const buf = await gateway.post('/api/ppt/make', { ...spec, theme: opts.theme });
        await fs.writeFile(opts.out, buf);
        console.log(`✓ 已生成 ${opts.out}`);
      }),
  )
  .addCommand(new Command('themes').action(async () => {
    const r = await gateway.get('/api/ppt/themes');
    console.table(r.data.data.themes);
  }))
  .addCommand(new Command('templates').action(async () => {
    const r = await gateway.get('/api/ppt/templates');
    console.table(r.data.data.templates);
  }));
```

## 第四步：复用现有菜单/Tools 体系

把 PPT 模块挂到 `/api/tools` 能力列表中，让 TUI Slash 面板和 Web 工具栏能直接调用：

```typescript
// server/src/tools/system/ppt/index.ts
export const PptTool = {
  name: 'system/ppt',
  description: '生成 PPT 文件',
  category: 'system',
  risk: 'low',
  parameters: {
    type: 'object',
    properties: {
      theme: { type: 'string', description: '主题 ID' },
      slides: { type: 'array', description: '幻灯片数据' },
    },
  },
  builtin: true,
};
```

这样在 TUI 端输入 `/tool/ppt` 即可触发 PPT 工具调用（基于之前实现的动态拉取架构）。

## 第五步：测试

```typescript
// server/src/modules/ppt/__tests__/ppt.test.ts
import { createPptModule } from '../index';

describe('PPT module', () => {
  it('生成 3 页 PPT', async () => {
    const m = await createPptModule();
    const buf = await m.generatePptx({
      theme: 'warm-kitchen',
      slides: [
        { template: 'cover', title: '测试', subtitle: '副标题', data: {} },
        { template: 'toc', title: '目录', data: { items: [{ num: '01', title: 'A' }] } },
        { template: 'content', title: '内容', data: { ingredients: ['x'], steps: ['y'] } },
      ],
    });
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.slice(0, 2).toString('hex')).toBe('504b0304'); // ZIP 头 = pptx
  });
});
```

## 总结

| 层级 | 文件 | 作用 |
|------|------|------|
| 服务端 | `server/src/modules/ppt/{index,routes,themes,templates}.ts` | PPT 核心生成能力 |
| 注册 | `server/src/gateway/server/http-routes.ts` | 挂载 `/api/ppt/*` |
| 工具 | `server/src/tools/system/ppt/index.ts` | 暴露为通用工具 |
| Web | `clients/web/src/views/PptStudio.tsx` | 可视化工作台 |
| CLI | `clients/cli/src/commands/ppt.ts` | 命令行工具 |
| TUI | 复用现有 `/tool/ppt` Slash | 无需额外代码 |

**关键设计**：
1. 与 Tools/Skills 体系对齐，PPT 本身就是一种"工具"，通过 `/api/tools` 自然暴露
2. 服务端用 `pptxgenjs` 统一生成，多端共享同一 API
3. 主题/模板解耦，前端只负责"选+填"，降低 Web/TUI 重复实现
4. 二进制流直接通过 HTTP 返回，前端无需复杂解析

**下一步建议**：先实现 `server/src/modules/ppt/` 三件套（index/routes/themes），跑通 `POST /api/ppt/make` 端到端，再做 Web 工作台 UI。
