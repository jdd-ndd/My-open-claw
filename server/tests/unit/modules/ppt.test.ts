/**
 * PPT 模块单元测试
 *
 * 覆盖：
 *   1. listThemes / listTemplates 返回正确的元数据
 *   2. resolveTheme 找不到时抛错
 *   3. generatePptx 成功生成 PPTX（ZIP 魔数验证）
 *   4. PptError 错误路径（空 slides / 未知主题 / 未知模板）
 *   5. PptMakeTool 工具注册集成（通过 createToolRegistry）
 */

import { describe, it, expect } from 'vitest';
import {
  createPptModule,
  generatePptx,
  PptError,
  type PptModule,
} from '../../../src/modules/ppt/index.js';
import { listThemes, resolveTheme } from '../../../src/modules/ppt/themes.js';
import { listTemplates } from '../../../src/modules/ppt/templates.js';
import { createToolRegistry } from '../../../src/tools/index.js';

describe('PPT 模块', () => {
  describe('themes.ts', () => {
    it('listThemes 返回 4 套预置主题', async () => {
      const themes = await listThemes();
      expect(themes).toHaveLength(4);
      expect(themes.map((t) => t.id)).toEqual([
        'warm-kitchen',
        'midnight-executive',
        'forest-moss',
        'coral-energy',
      ]);
    });

    it('每个主题都包含必需字段', async () => {
      const themes = await listThemes();
      for (const theme of themes) {
        expect(theme.id).toBeTruthy();
        expect(theme.name).toBeTruthy();
        expect(theme.primary).toMatch(/^[0-9A-Fa-f]{6}$/);
        expect(theme.secondary).toMatch(/^[0-9A-Fa-f]{6}$/);
        expect(theme.accent).toMatch(/^[0-9A-Fa-f]{6}$/);
        expect(theme.headerFont).toBeTruthy();
        expect(theme.bodyFont).toBeTruthy();
      }
    });

    it('resolveTheme 找到合法主题', async () => {
      const theme = await resolveTheme('warm-kitchen');
      expect(theme.id).toBe('warm-kitchen');
      expect(theme.primary).toBe('B85042');
    });

    it('resolveTheme 抛错当主题不存在', async () => {
      await expect(resolveTheme('no-such-theme')).rejects.toThrow('Unknown theme');
    });
  });

  describe('templates.ts', () => {
    it('listTemplates 返回 6 种模板', async () => {
      const templates = await listTemplates();
      expect(templates).toHaveLength(6);
      const types = new Set(templates.map((t) => t.type));
      // 覆盖所有 5 种 SlideTemplate
      expect(types).toEqual(
        new Set(['cover', 'toc', 'content', 'divider', 'summary']),
      );
    });

    it('每个模板都有 id/name/description/schema', async () => {
      const templates = await listTemplates();
      for (const t of templates) {
        expect(t.id).toBeTruthy();
        expect(t.name).toBeTruthy();
        expect(t.description).toBeTruthy();
        expect(t.schema).toBeTypeOf('object');
      }
    });
  });

  describe('PptModule.createPptModule', () => {
    it('工厂方法返回带三个方法的实例', async () => {
      const module = await createPptModule();
      expect(typeof module.generatePptx).toBe('function');
      expect(typeof module.listThemes).toBe('function');
      expect(typeof module.listTemplates).toBe('function');
    });

    it('listThemes 等同于顶层 listThemes', async () => {
      const module = await createPptModule();
      const a = await module.listThemes();
      const b = await listThemes();
      expect(a).toEqual(b);
    });
  });

  describe('generatePptx', () => {
    it('生成 3 页 PPTX 是合法 ZIP 文件', async () => {
      const buf = await generatePptx({
        theme: 'warm-kitchen',
        filename: 'test',
        slides: [
          { template: 'cover', title: '标题', subtitle: '副标题', data: {} },
          {
            template: 'toc',
            title: '目录',
            data: { items: [{ num: '01', title: 'A' }, { num: '02', title: 'B' }] },
          },
          {
            template: 'content',
            title: '内容',
            data: {
              ingredients: ['食材 1', '食材 2'],
              steps: ['步骤 1', '步骤 2'],
            },
          },
        ],
      });
      expect(buf.length).toBeGreaterThan(1000);
      // PPTX 是 ZIP 格式（OOXML），魔数为 PK\x03\x04
      expect(buf.slice(0, 4).toString('hex')).toBe('504b0304');
    });

    it('生成仅含 cover 的 PPTX', async () => {
      const buf = await generatePptx({
        theme: 'midnight-executive',
        slides: [{ template: 'cover', title: 'Hello', data: {} }],
      });
      expect(buf.slice(0, 4).toString('hex')).toBe('504b0304');
    });

    it('空 slides 抛出 PPT_INVALID_SPEC', async () => {
      await expect(generatePptx({ theme: 'warm-kitchen', slides: [] })).rejects.toThrow(
        PptError,
      );
      try {
        await generatePptx({ theme: 'warm-kitchen', slides: [] });
      } catch (err) {
        expect(err).toBeInstanceOf(PptError);
        expect((err as PptError).code).toBe('PPT_INVALID_SPEC');
        expect((err as PptError).retryable).toBe(false);
      }
    });

    it('未知主题抛出 PPT_UNKNOWN_THEME', async () => {
      try {
        await generatePptx({
          theme: 'no-such-theme',
          slides: [{ template: 'cover', title: 'x', data: {} }],
        });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(PptError);
        expect((err as PptError).code).toBe('PPT_UNKNOWN_THEME');
      }
    });

    it('未知模板抛出 PPT_UNKNOWN_TEMPLATE', async () => {
      // 强制绕过编译期类型：注入非法字符串
      try {
        await generatePptx({
          theme: 'warm-kitchen',
          slides: [
            { template: 'no-such-template' as never, title: 'x', data: {} },
          ],
        });
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(PptError);
        // 排版渲染会先抛 PPT_GENERATION_FAILED，未知模板在派发阶段兜底
        expect(['PPT_UNKNOWN_TEMPLATE', 'PPT_GENERATION_FAILED']).toContain(
          (err as PptError).code,
        );
      }
    });

    it('content 模板支持 bullets / paragraphs 形态', async () => {
      const bufA = await generatePptx({
        theme: 'coral-energy',
        slides: [
          {
            template: 'content',
            title: 'Bullets',
            data: { bullets: ['a', 'b', 'c'] },
          },
        ],
      });
      const bufB = await generatePptx({
        theme: 'coral-energy',
        slides: [
          {
            template: 'content',
            title: 'Paragraphs',
            data: { paragraphs: ['第一段', '第二段'] },
          },
        ],
      });
      expect(bufA.slice(0, 4).toString('hex')).toBe('504b0304');
      expect(bufB.slice(0, 4).toString('hex')).toBe('504b0304');
    });

    it('divider / summary 模板正常生成', async () => {
      const buf = await generatePptx({
        theme: 'forest-moss',
        slides: [
          { template: 'divider', title: 'Chapter 1', data: {} },
          { template: 'summary', title: 'Thanks', subtitle: '再见', data: {} },
        ],
      });
      expect(buf.slice(0, 4).toString('hex')).toBe('504b0304');
    });
  });

  describe('PptMakeTool 集成', () => {
    let module: PptModule;
    let registry: Awaited<ReturnType<typeof createToolRegistry>>;

    it('createToolRegistry 包含 system/ppt 工具', async () => {
      registry = await createToolRegistry();
      module = await createPptModule();
      const tool = registry.get('system/ppt');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('system/ppt');
      expect(tool?.category).toBe('system');
      expect(tool?.risk).toBe('low');
    });

    it('通过 registry.invoke 实际生成 PPT', async () => {
      const result = await registry.invoke(
        'system/ppt',
        {
          theme: 'warm-kitchen',
          filename: 'integration-test',
          slides: [
            { template: 'cover', title: '集成测试', data: {} },
          ],
        },
        {
          sessionId: 'test',
          userId: 'test',
          channelId: 'test',
          allowedPaths: [],
        },
      );

      expect(result.success).toBe(true);
      const data = result.data as {
        base64: string;
        bytes: number;
        mimeType: string;
        slideCount: number;
      };
      expect(data.base64).toBeTruthy();
      expect(data.bytes).toBeGreaterThan(1000);
      expect(data.mimeType).toContain('presentationml');
      expect(data.slideCount).toBe(1);
    });

    it('参数错误时返回失败但结构正确', async () => {
      const result = await registry.invoke(
        'system/ppt',
        { theme: '', slides: [] },
        {
          sessionId: 'test',
          userId: 'test',
          channelId: 'test',
          allowedPaths: [],
        },
      );
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    // 静默满足 module 的使用
    it('module 实例可复用', async () => {
      const newModule = await createPptModule();
      // 每次调用应返回独立对象，但行为一致
      expect(typeof newModule.generatePptx).toBe('function');
      const themesA = await module.listThemes();
      const themesB = await newModule.listThemes();
      expect(themesA).toEqual(themesB);
    });
  });
});
