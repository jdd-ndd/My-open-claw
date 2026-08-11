/**
 * JSON 配置加载器
 *
 * 加载 ~/.myopenclaw/config.json 并用 MyOpenClawConfigSchema 校验。
 *
 * 行为:
 * - 文件不存在 → 返回 null (info 级,降级到项目 YAML)
 * - 文件存在但解析失败 → 抛 ConfigFatalError (启动期终止)
 * - 解析成功但 schema 校验失败 → 抛 ConfigFatalError (详细列出每个字段错误)
 * - 校验通过 → 返回配置对象
 *
 * @module @myopenclaw/server/core/config
 */

import { existsSync, readFileSync } from 'node:fs';
import { MyOpenClawConfigSchema, type MyOpenClawConfig } from './schema.js';
import { resolveUserConfigPath } from './paths.js';
import { ConfigFatalError, zodToIssues } from './errors.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('config:json');

/**
 * 加载并校验 ~/.myopenclaw/config.json
 *
 * @returns 成功返回 MyOpenClawConfig 对象;文件不存在返回 null
 * @throws  ConfigFatalError 解析或 schema 校验失败
 */
export function loadJsonConfig(): MyOpenClawConfig | null {
  const path = resolveUserConfigPath();
  if (!path) return null;

  if (!existsSync(path)) {
    log.info({ path }, 'JSON 配置文件不存在,使用项目 YAML 配置');
    return null;
  }

  log.info({ path }, '加载 JSON 配置');

  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    throw new ConfigFatalError(
      [{
        level: 'fatal',
        path,
        message: `无法读取文件: ${(err as Error).message}`,
        hint: '检查文件权限和路径是否正确',
      }],
      `JSON 配置文件读取失败: ${path}`,
    );
  }

  // 解析 JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = (err as Error).message;
    // 尝试定位行号(简单的多行 JSON 错误信息解析)
    const lineMatch = msg.match(/line (\d+)/);
    const colMatch = msg.match(/column (\d+)/);
    const location = lineMatch ? `第 ${lineMatch[1]} 行${colMatch ? ` 第 ${colMatch[1]} 列` : ''}` : '';
    throw new ConfigFatalError(
      [{
        level: 'fatal',
        path,
        message: `JSON 格式错误: ${msg}${location ? ` (${location})` : ''}`,
        hint: '运行 `npx jsonlint <file>` 验证 JSON 语法',
      }],
      `JSON 配置文件解析失败: ${path}`,
    );
  }

  // Schema 校验
  const result = MyOpenClawConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = zodToIssues(result.error, path);
    throw new ConfigFatalError(issues, `JSON 配置 schema 校验失败: ${path}`);
  }

  return result.data;
}
