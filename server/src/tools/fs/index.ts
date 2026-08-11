/**
 * 文件操作工具集（对齐文档 §4.1）
 *
 * 提供本地文件系统的读取、写入、删除、遍历能力。
 * 所有文件操作受路径白名单约束。
 *
 * @module @myopenclaw/server/tools/fs
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createLogger } from '../../core/utils/logger.js';
import type { Tool, ToolResult, InvokeContext, JSONSchema } from '../../core/types/index.js';

const log = createLogger('tools:fs');

/** Buffer 编码类型 */
type BufferEncoding = 'utf-8' | 'base64' | 'hex' | 'ascii';

// ═══════════════════════════════════════════════════════════════
// fs/read_file —— 读取文件（对齐文档 §4.1.1）
// ═══════════════════════════════════════════════════════════════

export class FsReadFileTool implements Tool {
  readonly name = 'fs/read_file';
  readonly description = '读取本地文件内容。支持文本和二进制文件，可指定编码格式。';
  readonly category = 'fs';
  readonly risk: 'low' | 'medium' | 'high' = 'low';
  readonly builtin = true;

  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件绝对路径' },
      encoding: {
        type: 'string',
        description: '文件编码，默认 utf-8。二进制文件使用 base64',
        enum: ['utf-8', 'base64', 'hex', 'ascii'],
        default: 'utf-8',
      },
      maxSize: {
        type: 'number',
        description: '最大读取字节数，默认 10MB。超过则截断',
        default: 10485760,
      },
    },
    required: ['path'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startTime = Date.now();
    const path = String(params.path);
    const encoding = (params.encoding as string) ?? 'utf-8';
    const maxSize = (params.maxSize as number) ?? 10485760;

    try {
      const resolved = resolve(path);
      if (!existsSync(resolved)) {
        return {
          success: false,
          status: 'error',
          error: `文件不存在: ${resolved}`,
          errorCode: 'FILE_NOT_FOUND',
          metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
        };
      }

      const stat = statSync(resolved);
      if (!stat.isFile()) {
        return {
          success: false,
          status: 'error',
          error: `路径不是文件: ${resolved}`,
          errorCode: 'NOT_A_FILE',
          metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
        };
      }

      let content: string;
      const enc = encoding as BufferEncoding;
      if (enc === 'base64' || enc === 'hex') {
        const buffer = readFileSync(resolved);
        content = buffer.toString(enc).slice(0, maxSize);
      } else {
        content = readFileSync(resolved, { encoding: enc as BufferEncoding }).slice(0, maxSize);
      }

      log.info({ path: resolved, encoding, size: content.length }, '文件读取成功');

      return {
        success: true,
        status: 'success',
        data: content,
        metadata: {
          durationMs: Date.now() - startTime,
          sideEffects: [],
          resources: { size: content.length, path: resolved },
        },
      };
    } catch (err) {
      log.error({ path, err: (err as Error).message }, '文件读取失败');
      return {
        success: false,
        status: 'error',
        error: `文件读取失败: ${(err as Error).message}`,
        errorCode: 'FS_READ_ERROR',
        metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// fs/write_file —— 写入文件（对齐文档 §4.1.2）
// ═══════════════════════════════════════════════════════════════

export class FsWriteFileTool implements Tool {
  readonly name = 'fs/write_file';
  readonly description = '将内容写入本地文件。文件不存在时自动创建，存在时默认覆盖。';
  readonly category = 'fs';
  readonly risk: 'low' | 'medium' | 'high' = 'medium';
  readonly builtin = true;

  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件绝对路径' },
      content: { type: 'string', description: '文件内容' },
      encoding: {
        type: 'string',
        description: '内容编码，默认 utf-8',
        default: 'utf-8',
      },
      append: {
        type: 'boolean',
        description: '是否追加模式（false 为覆盖，true 为追加）',
        default: false,
      },
      createDirs: {
        type: 'boolean',
        description: '是否自动创建不存在的父目录',
        default: true,
      },
    },
    required: ['path', 'content'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startTime = Date.now();
    const path = String(params.path);
    const content = String(params.content);
    const encoding = (params.encoding as string) ?? 'utf-8';
    const append = (params.append as boolean) ?? false;
    const createDirs = (params.createDirs as boolean) ?? true;

    try {
      const resolved = resolve(path);

      // 自动创建父目录
      if (createDirs) {
        const dir = dirname(resolved);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
          log.info({ dir }, '自动创建父目录');
        }
      }

      if (append) {
        // 追加模式
        const enc = encoding as BufferEncoding;
        const existing = existsSync(resolved) ? readFileSync(resolved, { encoding: enc as BufferEncoding }) : '';
        writeFileSync(resolved, existing + content, { encoding: enc as BufferEncoding });
      } else {
        const enc = encoding as BufferEncoding;
        writeFileSync(resolved, content, { encoding: enc as BufferEncoding });
      }

      const writtenSize = Buffer.byteLength(content, encoding as BufferEncoding);

      log.info({ path: resolved, append, size: writtenSize }, '文件写入成功');

      return {
        success: true,
        status: 'success',
        data: { path: resolved, bytesWritten: writtenSize },
        metadata: {
          durationMs: Date.now() - startTime,
          sideEffects: ['file_modified'],
          resources: { size: writtenSize, path: resolved },
        },
      };
    } catch (err) {
      log.error({ path, err: (err as Error).message }, '文件写入失败');
      return {
        success: false,
        status: 'error',
        error: `文件写入失败: ${(err as Error).message}`,
        errorCode: 'FS_WRITE_ERROR',
        metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// fs/delete —— 删除文件（对齐文档 §4.1.3）
// ═══════════════════════════════════════════════════════════════

export class FsDeleteTool implements Tool {
  readonly name = 'fs/delete';
  readonly description = '删除文件或目录。删除目录时递归删除其下所有内容。此操作不可逆。';
  readonly category = 'fs';
  readonly risk: 'low' | 'medium' | 'high' = 'high';
  readonly builtin = true;

  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: '要删除的文件或目录绝对路径' },
      recursive: {
        type: 'boolean',
        description: '是否递归删除目录（删除目录时必须为 true）',
        default: false,
      },
    },
    required: ['path'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startTime = Date.now();
    const path = String(params.path);
    const recursive = (params.recursive as boolean) ?? false;

    try {
      const resolved = resolve(path);

      if (!existsSync(resolved)) {
        return {
          success: false,
          status: 'error',
          error: `路径不存在: ${resolved}`,
          errorCode: 'NOT_FOUND',
          metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
        };
      }

      const stat = statSync(resolved);
      if (stat.isDirectory()) {
        if (!recursive) {
          return {
            success: false,
            status: 'error',
            error: '删除目录需要设置 recursive: true',
            errorCode: 'RECURSIVE_REQUIRED',
            metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
          };
        }
        rmSync(resolved, { recursive: true, force: true });
        log.warn({ path: resolved, recursive: true }, '目录已删除');
      } else {
        unlinkSync(resolved);
        log.warn({ path: resolved }, '文件已删除');
      }

      return {
        success: true,
        status: 'success',
        data: { deleted: resolved },
        metadata: {
          durationMs: Date.now() - startTime,
          sideEffects: ['file_deleted'],
          resources: { path: resolved },
        },
      };
    } catch (err) {
      log.error({ path, err: (err as Error).message }, '文件删除失败');
      return {
        success: false,
        status: 'error',
        error: `删除失败: ${(err as Error).message}`,
        errorCode: 'FS_DELETE_ERROR',
        metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// fs/list_dir —— 遍历目录（对齐文档 §4.1.4）
// ═══════════════════════════════════════════════════════════════

export class FsListDirTool implements Tool {
  readonly name = 'fs/list_dir';
  readonly description = '列出指定目录下的文件和子目录，支持递归遍历和模式过滤。';
  readonly category = 'fs';
  readonly risk: 'low' | 'medium' | 'high' = 'low';
  readonly builtin = true;

  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: '目录绝对路径' },
      recursive: {
        type: 'boolean',
        description: '是否递归遍历子目录',
        default: false,
      },
      pattern: {
        type: 'string',
        description: '文件名过滤模式（glob 语法，如 *.md）',
      },
      includeHidden: {
        type: 'boolean',
        description: '是否包含隐藏文件（以 . 开头的文件）',
        default: false,
      },
    },
    required: ['path'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startTime = Date.now();
    const path = String(params.path);
    const recursive = (params.recursive as boolean) ?? false;
    const pattern = params.pattern as string | undefined;
    const includeHidden = (params.includeHidden as boolean) ?? false;

    try {
      const resolved = resolve(path);

      if (!existsSync(resolved)) {
        return {
          success: false,
          status: 'error',
          error: `目录不存在: ${resolved}`,
          errorCode: 'DIR_NOT_FOUND',
          metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
        };
      }

      const stat = statSync(resolved);
      if (!stat.isDirectory()) {
        return {
          success: false,
          status: 'error',
          error: `路径不是目录: ${resolved}`,
          errorCode: 'NOT_A_DIRECTORY',
          metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
        };
      }

      const entries = this.listDir(resolved, recursive, pattern, includeHidden);

      log.info({ path: resolved, count: entries.length, recursive }, '目录遍历完成');

      return {
        success: true,
        status: 'success',
        data: entries,
        metadata: {
          durationMs: Date.now() - startTime,
          sideEffects: [],
          resources: { itemCount: entries.length, path: resolved },
        },
      };
    } catch (err) {
      log.error({ path, err: (err as Error).message }, '目录遍历失败');
      return {
        success: false,
        status: 'error',
        error: `目录遍历失败: ${(err as Error).message}`,
        errorCode: 'FS_LIST_ERROR',
        metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
      };
    }
  }

  /**
   * 递归遍历目录
   */
  private listDir(
    dirPath: string,
    recursive: boolean,
    pattern?: string,
    includeHidden = false,
  ): Array<{ name: string; type: 'file' | 'directory'; size: number; path: string }> {
    const entries: Array<{ name: string; type: 'file' | 'directory'; size: number; path: string }> = [];
    const items = readdirSync(dirPath);

    for (const item of items) {
      // 过滤隐藏文件
      if (!includeHidden && item.startsWith('.')) continue;

      const fullPath = resolve(dirPath, item);
      let itemStat: ReturnType<typeof statSync>;
      try {
        itemStat = statSync(fullPath);
      } catch {
        continue;
      }

      const entry = {
        name: item,
        type: itemStat.isDirectory() ? 'directory' as const : 'file' as const,
        size: itemStat.size,
        path: fullPath,
      };

      // 模式过滤
      if (pattern && entry.type === 'file') {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
        if (!regex.test(item)) continue;
      }

      entries.push(entry);

      // 递归子目录
      if (recursive && entry.type === 'directory') {
        entries.push(...this.listDir(fullPath, recursive, pattern, includeHidden));
      }
    }

    return entries;
  }
}

// ═══════════════════════════════════════════════════════════════
// 旧版 FsTool（向后兼容，逐步废弃）
// ═══════════════════════════════════════════════════════════════

/**
 * 旧版文件操作工具（兼容接口）
 *
 * @deprecated 请使用独立的 FsReadFileTool / FsWriteFileTool / FsDeleteTool / FsListDirTool
 */
export class FsTool implements Tool {
  readonly name = 'fs';
  readonly description = '文件系统操作（读取、写入、列出目录、删除等）—— 已废弃，请使用独立子工具';
  readonly category = 'fs';
  readonly risk: 'low' | 'medium' | 'high' = 'medium';
  readonly builtin = true;

  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      operation: { type: 'string', description: '操作: read | write | list | delete', enum: ['read', 'write', 'list', 'delete'] },
      path: { type: 'string', description: '文件/目录路径' },
      content: { type: 'string', description: '写入内容（write 操作时使用）' },
    },
    required: ['operation', 'path'],
  };

  async execute(params: Record<string, unknown>, context: InvokeContext): Promise<ToolResult> {
    const startTime = Date.now();
    const operation = String(params.operation);
    const path = String(params.path);

    try {
      switch (operation) {
        case 'read': {
          const delegate = new FsReadFileTool();
          return delegate.execute({ path }, context);
        }
        case 'write': {
          const delegate = new FsWriteFileTool();
          return delegate.execute({ path, content: params.content ?? '' }, context);
        }
        case 'list': {
          const delegate = new FsListDirTool();
          return delegate.execute({ path }, context);
        }
        case 'delete': {
          const delegate = new FsDeleteTool();
          return delegate.execute({ path }, context);
        }
        default:
          return {
            success: false,
            status: 'error',
            error: `不支持的操作: ${operation}`,
            errorCode: 'INVALID_OPERATION',
            metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
          };
      }
    } catch (err) {
      return {
        success: false,
        status: 'error',
        error: `文件操作失败: ${(err as Error).message}`,
        errorCode: 'FS_ERROR',
        metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
      };
    }
  }
}
