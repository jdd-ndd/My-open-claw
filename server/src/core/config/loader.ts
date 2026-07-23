/**
 * 配置加载模块
 *
 * 从 config/config.yaml 读取配置，支持环境变量覆盖。
 * 配置层级：YAML 文件 < 环境变量覆盖
 *
 * @module @myopenclaw/server/core/config
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let cachedConfig: Record<string, unknown> | null = null;

/** 默认配置（兜底） */
const DEFAULT_CONFIG: Record<string, unknown> = {
  gateway: {
    host: '127.0.0.1',
    port: 18780,
    heartbeatInterval: 30_000,
    maxConnections: 1_000,
    requestTimeout: 30_000,
  },
  logging: {
    level: 'info',
  },
};

/**
 * 加载并缓存配置文件
 *
 * 优先级：环境变量 > YAML 配置 > 默认配置
 */
export function loadConfig(): Record<string, unknown> {
  if (cachedConfig) return cachedConfig;

  const configPath = resolve(__dirname, '..', '..', '..', '..', 'config', 'config.yaml');

  let fileConfig: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      fileConfig = (parseYaml(raw) as Record<string, unknown>) ?? {};
    } catch (err) {
      console.warn(`[config] YAML 配置解析失败: ${(err as Error).message}，使用默认配置`);
    }
  }

  // 深度合并：defaultConfig < fileConfig < env
  cachedConfig = deepMerge(
    structuredClone(DEFAULT_CONFIG),
    structuredClone(fileConfig),
  );

  // 环境变量覆盖
  applyEnvOverrides(cachedConfig);

  return cachedConfig;
}

/**
 * 按 dot-path 获取配置值
 *
 * @example getConfig<number>('gateway.port', 18780)
 */
export function getConfig<T = unknown>(path: string, defaultValue?: T): T {
  const config = loadConfig();
  const keys = path.split('.');
  let current: unknown = config;
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return defaultValue as T;
    current = (current as Record<string, unknown>)[key];
  }
  return (current as T) ?? (defaultValue as T);
}

/** 清除缓存（测试用） */
export function clearConfigCache(): void {
  cachedConfig = null;
}

// ── 内部工具 ────────────────────────────

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function applyEnvOverrides(config: Record<string, unknown>, prefix = ''): void {
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('MYOC_')) continue;
    const configKey = key
      .replace('MYOC_', '')
      .toLowerCase()
      .replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const path = prefix ? `${prefix}.${configKey}` : configKey;
    setConfigByPath(config, path, coerceValue(value ?? ''));
  }
}

function setConfigByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]] || typeof current[keys[i]] !== 'object') {
      current[keys[i]] = {};
    }
    current = current[keys[i]] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

function coerceValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}
