/**
 * 浏览器自动化工具集（对齐文档 §4.3）
 *
 * 提供网页打开、点击、表单填写、内容抓取等浏览器自动化能力。
 * 基于原生 fetch + 简单解析实现（轻量级，不依赖 Playwright/Puppeteer）。
 *
 * @module @myopenclaw/server/tools/browser
 */

import { createLogger } from '../../core/utils/logger.js';
import type { Tool, ToolResult, InvokeContext, JSONSchema } from '../../core/types/index.js';

const log = createLogger('tools:browser');

// ═══════════════════════════════════════════════════════════════
// 工具函数：HTTP 请求与 HTML 解析
// ═══════════════════════════════════════════════════════════════

/**
 * 获取网页内容
 */
async function fetchPage(url: string, timeoutMs = 30000): Promise<{ html: string; title: string; finalUrl: string; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'MyOpenClaw-Browser/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });

    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim() ?? '无标题';

    return {
      html,
      title,
      finalUrl: response.url,
      status: response.status,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 从 HTML 中提取纯文本内容（简单实现）
 */
function extractText(html: string, maxLength = 50000): string {
  // 移除 script 和 style 标签内容
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  // 移除 HTML 标签
  text = text.replace(/<[^>]+>/g, ' ');
  // 压缩空白
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text.substring(0, maxLength);
}

/**
 * 按 CSS 选择器简单匹配提取（简化版）
 */
function extractBySelector(html: string, selector: string): string[] {
  const results: string[] = [];
  // 简单的标签名匹配
  const tagMatch = selector.match(/^([a-zA-Z]+)/);
  if (tagMatch) {
    const tag = tagMatch[1];
    const tagRegex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    let match;
    while ((match = tagRegex.exec(html)) !== null) {
      const innerHtml = match[1];
      results.push(extractText(innerHtml, 10000));
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════
// browser/open —— 打开页面（对齐文档 §4.3.1）
// ═══════════════════════════════════════════════════════════════

export class BrowserOpenTool implements Tool {
  readonly name = 'browser/open';
  readonly description = '在无头浏览器中打开指定 URL，返回页面标题、URL 和文本内容快照。';
  readonly category = 'browser';
  readonly risk: 'low' | 'medium' | 'high' = 'low';
  readonly builtin = true;

  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      url: { type: 'string', description: '要打开的页面 URL' },
      timeout: {
        type: 'number',
        description: '页面加载超时（毫秒），默认 30000',
        default: 30000,
      },
    },
    required: ['url'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startTime = Date.now();
    const url = String(params.url);
    const timeout = (params.timeout as number) ?? 30000;

    try {
      const page = await fetchPage(url, timeout);
      const textContent = extractText(page.html);

      log.info({ url, title: page.title, size: textContent.length }, '页面打开成功');

      return {
        success: true,
        status: 'success',
        data: {
          title: page.title,
          url: page.finalUrl,
          statusCode: page.status,
          textContent,
        },
        metadata: {
          durationMs: Date.now() - startTime,
          sideEffects: [],
          resources: { contentLength: textContent.length },
        },
      };
    } catch (err) {
      log.error({ url, err: (err as Error).message }, '页面打开失败');
      return {
        success: false,
        status: 'error',
        error: `页面打开失败: ${(err as Error).message}`,
        errorCode: 'BROWSER_OPEN_ERROR',
        metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// browser/click —— 点击元素（对齐文档 §4.3.2）
// ═══════════════════════════════════════════════════════════════

export class BrowserClickTool implements Tool {
  readonly name = 'browser/click';
  readonly description = '在浏览器页面中点击指定元素。支持 CSS 选择器定位。注：轻量实现，不执行实际浏览器点击。';
  readonly category = 'browser';
  readonly risk: 'low' | 'medium' | 'high' = 'low';
  readonly builtin = true;

  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      selector: { type: 'string', description: '元素选择器（CSS 或 XPath）' },
    },
    required: ['selector'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startTime = Date.now();
    const selector = String(params.selector);

    log.info({ selector }, '浏览器点击（轻量模拟）');

    return {
      success: true,
      status: 'success',
      data: {
        clicked: selector,
        note: '轻量级实现，未执行真实浏览器点击。建议使用 browser/scrape 直接提取数据。',
      },
      metadata: {
        durationMs: Date.now() - startTime,
        sideEffects: [],
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// browser/fill_form —— 表单填写（对齐文档 §4.3.3）
// ═══════════════════════════════════════════════════════════════

export class BrowserFillFormTool implements Tool {
  readonly name = 'browser/fill_form';
  readonly description = '在当前页面的表单中填写数据。支持批量填充多个字段。注：轻量实现，不执行真实浏览器表单提交。';
  readonly category = 'browser';
  readonly risk: 'low' | 'medium' | 'high' = 'medium';
  readonly builtin = true;

  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      fields: {
        type: 'array',
        description: '要填写的表单字段列表',
        items: {
          type: 'object',
          properties: {
            selector: { type: 'string', description: '字段选择器' },
            value: { type: 'string', description: '填写的值' },
          },
          required: ['selector', 'value'],
        },
      },
    },
    required: ['fields'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startTime = Date.now();
    const fields = params.fields as Array<{ selector: string; value: string }>;

    log.info({ fieldCount: fields.length }, '表单填写（轻量模拟）');

    return {
      success: true,
      status: 'success',
      data: {
        filledFields: fields.length,
        note: '轻量级实现，未执行真实表单填写。建议使用 http/request 直接发送数据。',
      },
      metadata: {
        durationMs: Date.now() - startTime,
        sideEffects: [],
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// browser/scrape —— 网页抓取（对齐文档 §4.3.4）
// ═══════════════════════════════════════════════════════════════

export class BrowserScrapeTool implements Tool {
  readonly name = 'browser/scrape';
  readonly description = '从网页中提取内容。支持按 CSS 选择器提取特定元素，或提取全文内容。';
  readonly category = 'browser';
  readonly risk: 'low' | 'medium' | 'high' = 'low';
  readonly builtin = true;

  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      url: { type: 'string', description: '要抓取的 URL' },
      selectors: {
        type: 'array',
        description: '要提取的元素选择器列表（不填则提取全文）',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '字段名' },
            selector: { type: 'string', description: 'CSS 选择器' },
          },
          required: ['name', 'selector'],
        },
      },
      format: {
        type: 'string',
        description: '输出格式',
        enum: ['text', 'html', 'markdown'],
        default: 'text',
      },
    },
    required: ['url'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startTime = Date.now();
    const url = String(params.url);
    const selectors = params.selectors as Array<{ name: string; selector: string }> | undefined;
    const format = (params.format as string) ?? 'text';
    const timeout = (params.timeout as number) ?? 30000;

    try {
      const page = await fetchPage(url, timeout);

      if (selectors && selectors.length > 0) {
        // 按选择器提取
        const results: Record<string, string[]> = {};
        for (const sel of selectors) {
          results[sel.name] = extractBySelector(page.html, sel.selector);
        }

        log.info({ url, selectorCount: selectors.length }, '结构化数据提取完成');

        return {
          success: true,
          status: 'success',
          data: { title: page.title, url: page.finalUrl, fields: results },
          metadata: {
            durationMs: Date.now() - startTime,
            sideEffects: [],
            resources: { selectorCount: selectors.length },
          },
        };
      }

      // 提取全文
      const content = format === 'html'
        ? page.html.substring(0, 100000)
        : extractText(page.html);

      log.info({ url, contentLength: content.length, format }, '网页内容抓取完成');

      return {
        success: true,
        status: 'success',
        data: {
          title: page.title,
          url: page.finalUrl,
          content,
          format,
        },
        metadata: {
          durationMs: Date.now() - startTime,
          sideEffects: [],
          resources: { contentLength: content.length },
        },
      };
    } catch (err) {
      log.error({ url, err: (err as Error).message }, '网页抓取失败');
      return {
        success: false,
        status: 'error',
        error: `网页抓取失败: ${(err as Error).message}`,
        errorCode: 'SCRAPE_ERROR',
        metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 旧版 BrowserTool（向后兼容）
// ═══════════════════════════════════════════════════════════════

/**
 * 旧版浏览器工具（兼容接口）
 *
 * @deprecated 请使用独立子工具替代
 */
export class BrowserTool implements Tool {
  readonly name = 'browser';
  readonly description = '自动化浏览器操作（导航、点击、截图等）—— 已废弃，请使用独立子工具';
  readonly category = 'browser';
  readonly risk: 'low' | 'medium' | 'high' = 'low';
  readonly builtin = true;

  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      action: { type: 'string', description: '操作类型: navigate | click | screenshot', enum: ['navigate', 'click', 'screenshot'] },
      url: { type: 'string', description: '目标 URL' },
    },
    required: ['action'],
  };

  async execute(params: Record<string, unknown>, context: InvokeContext): Promise<ToolResult> {
    const action = String(params.action);
    if (action === 'navigate' && params.url) {
      const delegate = new BrowserOpenTool();
      return delegate.execute({ url: params.url }, context);
    }
    const startTime = Date.now();
    return {
      success: true,
      status: 'success',
      data: { action, message: '轻量实现，请使用 browser/open browser/scrape 等独立工具' },
      metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
    };
  }
}
