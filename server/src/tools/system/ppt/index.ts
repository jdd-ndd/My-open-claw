/**
 * PPT 制作工具
 *
 * 暴露为内置工具 system/ppt：
 *   - 出现在 /api/tools 列表
 *   - TUI 端通过 /tool/ppt Slash 命令直接调用
 *   - Web 端工具栏自动可见
 *
 * 内部委托 PptModule 生成 PPT，返回 base64 编码 + 文件元数据，
 * 便于 Agent 在对话中直接引用内容。
 *
 * @module @myopenclaw/server/tools/system/ppt
 */

import type { InvokeContext, JSONSchema, Tool, ToolResult } from '../../../core/types/index.js';
import { createPptModule, PptError, type PptModule } from '../../../modules/ppt/index.js';
import type { PptSpec } from '../../../modules/ppt/types.js';

export class PptMakeTool implements Tool {
  readonly name = 'system/ppt';
  readonly description = '根据指定的 PPT 规格（主题 + 幻灯片数组）生成 PPTX 文件，返回 base64 编码与文件元数据。';
  readonly category = 'system';
  readonly risk: 'low' | 'medium' | 'high' = 'low';
  readonly builtin = true;

  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      theme: {
        type: 'string',
        description: 'PPT 主题 ID（如 warm-kitchen / midnight-executive / forest-moss / coral-energy）',
      },
      filename: {
        type: 'string',
        description: '生成文件名（不含扩展名），可选，默认 presentation',
      },
      slides: {
        type: 'array',
        description: '幻灯片数据，按顺序排列（非空数组）',
        items: {
          type: 'object',
          properties: {
            template: {
              type: 'string',
              enum: ['cover', 'toc', 'content', 'divider', 'summary'],
            },
            title: { type: 'string' },
            subtitle: { type: 'string' },
            data: { type: 'object' },
          },
          required: ['template', 'title'],
        },
      },
    },
    required: ['theme', 'slides'],
  };

  private module: PptModule | null = null;

  /** 懒加载 PptModule（避免循环依赖） */
  private async getModule(): Promise<PptModule> {
    if (this.module) return this.module;
    this.module = await createPptModule();
    return this.module;
  }

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startedAt = Date.now();
    const theme = typeof params.theme === 'string' ? params.theme.trim() : '';
    const filename = typeof params.filename === 'string' ? params.filename.trim() : '';
    const slides = Array.isArray(params.slides) ? params.slides : [];

    if (!theme) {
      return this.fail('theme must be a non-empty string', 'PPT_INVALID_SPEC', startedAt, false);
    }
    if (slides.length === 0) {
      return this.fail('slides must be a non-empty array', 'PPT_INVALID_SPEC', startedAt, false);
    }

    const spec: PptSpec = {
      theme,
      filename: filename || undefined,
      slides: slides as PptSpec['slides'],
    };

    try {
      const module = await this.getModule();
      const buf = await module.generatePptx(spec);
      return {
        success: true,
        status: 'success',
        data: {
          filename: filename || 'presentation',
          base64: buf.toString('base64'),
          bytes: buf.length,
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          slideCount: slides.length,
          theme,
        },
        metadata: {
          durationMs: Date.now() - startedAt,
          sideEffects: [],
        },
      };
    } catch (err) {
      if (err instanceof PptError) {
        return this.fail(err.message, err.code, startedAt, err.retryable);
      }
      return this.fail(
        err instanceof Error ? err.message : 'Unknown PPT error',
        'PPT_GENERATION_FAILED',
        startedAt,
        true,
      );
    }
  }

  private fail(
    message: string,
    code: string,
    startedAt: number,
    retryable: boolean,
  ): ToolResult {
    return {
      success: false,
      status: 'error',
      error: message,
      errorCode: code,
      metadata: {
        durationMs: Date.now() - startedAt,
        sideEffects: [],
      },
      retryable,
    } as ToolResult & { retryable: boolean };
  }
}
