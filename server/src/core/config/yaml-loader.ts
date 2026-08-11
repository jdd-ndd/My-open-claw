/**
 * YAML 配置加载器
 *
 * 从 config/config.yaml 加载项目级配置(向后兼容,保留旧行为):
 * - 支持 include 指令
 * - 支持 ${VAR_NAME} 环境变量引用
 * - 支持 MYOC_* 前缀环境变量覆盖
 *
 * @module @myopenclaw/server/core/config
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { deepMerge, applyEnvOverrides } from './merger.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('config:yaml');

/**
 * 加载并解析项目 YAML 配置
 *
 * 路径解析: 默认 process.cwd() + 'config/config.yaml',
 *          可被 MYOC_PROJECT_CONFIG_DIR 环境变量覆盖(用于测试和自定义部署)。
 *
 * 优先级: include 子配置 < 主 config.yaml(后加载覆盖前加载)
 *
 * @returns 成功返回配置对象;YAML 不存在返回 {}
 */
export function loadYamlConfig(): Record<string, unknown> {
  // 解析 config 目录(支持 MYOC_PROJECT_CONFIG_DIR 覆盖,便于测试)
  const projectDir = process.env.MYOC_PROJECT_CONFIG_DIR
    ? resolve(process.env.MYOC_PROJECT_CONFIG_DIR)
    : process.cwd();
  const configDir = join(projectDir, 'config');
  const configPath = join(configDir, 'config.yaml');

  let fileConfig: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      fileConfig = (parseYaml(raw) as Record<string, unknown>) ?? {};

      // 处理 include 指令
      if (Array.isArray(fileConfig.include)) {
        const includes = fileConfig.include as string[];
        delete fileConfig.include;

        for (const includePath of includes) {
          const resolvedPath = resolve(configDir, includePath);
          if (existsSync(resolvedPath)) {
            try {
              const includeRaw = readFileSync(resolvedPath, 'utf-8');
              const includeConfig = (parseYaml(includeRaw) as Record<string, unknown>) ?? {};
              fileConfig = deepMerge(fileConfig, includeConfig);
            } catch (err) {
              log.warn(
                { path: includePath, err: (err as Error).message },
                'include 文件解析失败',
              );
            }
          } else {
            log.warn({ path: resolvedPath }, 'include 文件不存在');
          }
        }
      }
    } catch (err) {
      log.warn(
        { path: configPath, err: (err as Error).message },
        'YAML 配置解析失败,使用空对象',
      );
    }
  } else {
    log.info({ path: configPath }, '项目 YAML 配置不存在,跳过');
  }

  return fileConfig;
}

/** 解析 YAML 字符串中的 ${VAR_NAME} 占位符
 *
 * 设计: env var 未设置时**保留 `${VAR}` 字面**而非替换为空串。
 * 原因:
 * - 空串会触发 schema/validator 拒绝,丢失原始语义(让用户能区分"未配置" vs "解析失败")
 * - 保留字面后,用户 / 运维在日志中能看到 "${DEEPSEEK_API_KEY}",便于发现未设置
 * - schema 的 .refine() 会在 parse 时再校验,失败抛 ConfigFatalError 提示明确
 */
export function resolveEnvVars<T>(obj: T): T {
  if (typeof obj === 'string') {
    const match = obj.match(/^\$\{(\w+)\}$/);
    if (match) {
      const v = process.env[match[1]];
      // 未设值时返回原样(保留 ${VAR} 字面)
      return (v !== undefined ? v : obj) as unknown as T;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => resolveEnvVars(item)) as unknown as T;
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = resolveEnvVars(value);
    }
    return result as T;
  }
  return obj;
}

/** 强制把 YAML 加载结果中的 ${VAR} 解析成实际值 */
export function applyYamlEnvResolution(config: Record<string, unknown>): Record<string, unknown> {
  return resolveEnvVars(config);
}

/** 应用 MYOC_* 环境变量覆盖(供 loader.ts 复用) */
export { applyEnvOverrides };
