/**
 * 配置文件加载器
 *
 * 实现多源配置的加载、合并和持久化功能，支持：
 * - 从多个路径查找配置文件（使用 cosmiconfig）
 * - 环境变量覆盖
 * - 配置文件的读取和写入
 * - 配置的验证和缓存
 *
 * 配置优先级（高 → 低）：
 * 1. 命令行参数
 * 2. 环境变量
 * 3. 项目级配置文件（当前目录）
 * 4. 用户级配置文件（主目录）
 * 5. 内置默认值
 *
 * @module cli/config
 */

import { cosmiconfig, type CosmiconfigResult } from 'cosmiconfig';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { ConfigSchema, type MyOpenClawConfig } from './schema.js';
import { DEFAULT_CONFIG, CONFIG_SEARCH_PATHS } from './defaults.js';

/** 配置缓存，避免重复加载 */
let cachedConfig: MyOpenClawConfig | null = null;

/** cosmiconfig 实例，用于查找和加载配置文件 */
const explorer = cosmiconfig('myopenclaw', {
  searchPlaces: [
    CONFIG_SEARCH_PATHS.RC_FILE,
    path.join(CONFIG_SEARCH_PATHS.CONFIG_DIR, CONFIG_SEARCH_PATHS.CONFIG_FILE_NAME),
    path.join(os.homedir(), CONFIG_SEARCH_PATHS.RC_FILE),
    path.join(os.homedir(), CONFIG_SEARCH_PATHS.SYSTEM_CONFIG_PATH),
  ],
});

/**
 * 从环境变量加载配置覆盖
 *
 * 检查预定义的环境变量，提取可覆盖默认配置的值。
 * 环境变量优先级低于命令行参数，高于配置文件。
 *
 * @returns 从环境变量中提取的部分配置对象
 */
function loadEnvOverrides(): Partial<MyOpenClawConfig> {
  const overrides: Partial<MyOpenClawConfig> = {};

  // Gateway URL 环境变量
  const gatewayUrl = process.env[CONFIG_SEARCH_PATHS.ENV_GATEWAY_URL];
  if (gatewayUrl) {
    overrides.gateway = {
      ...DEFAULT_CONFIG.gateway,
      url: gatewayUrl,
    };
  }

  // 默认模型环境变量
  const defaultModel = process.env[CONFIG_SEARCH_PATHS.ENV_DEFAULT_MODEL];
  if (defaultModel) {
    overrides.model = {
      ...DEFAULT_CONFIG.model,
      default: defaultModel,
    };
  }

  return overrides;
}

/**
 * 从配置文件加载配置
 *
 * 使用 cosmiconfig 在多个路径中查找配置文件，
 * 支持 JSON、YAML、JavaScript 等多种格式。
 *
 * @param configPath - 可选的指定配置文件路径（来自 --config 参数）
 * @returns 加载的配置对象和配置文件路径
 */
async function loadFromFile(
  configPath?: string
): Promise<{ config: Partial<MyOpenClawConfig>; filePath: string | null }> {
  let result: CosmiconfigResult;

  if (configPath) {
    // 使用指定的配置文件路径
    result = await explorer.load(configPath);
  } else {
    // 在默认路径中搜索配置文件
    result = await explorer.search();
  }

  if (result && !result.isEmpty) {
    return {
      config: result.config as Partial<MyOpenClawConfig>,
      filePath: result.filepath,
    };
  }

  return { config: {}, filePath: null };
}

/**
 * 深度合并配置对象
 *
 * 递归合并两个配置对象，高优先级的配置覆盖低优先级的配置。
 * 仅合并对象类型的字段，原始类型字段直接替换。
 *
 * @param base - 基础配置（低优先级）
 * @param override - 覆盖配置（高优先级）
 * @returns 合并后的配置
 */
function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const result = { ...base };

  for (const key of Object.keys(override) as Array<keyof T>) {
    const baseValue = result[key];
    const overrideValue = override[key];

    if (
      typeof baseValue === 'object' &&
      baseValue !== null &&
      typeof overrideValue === 'object' &&
      overrideValue !== null &&
      !Array.isArray(baseValue) &&
      !Array.isArray(overrideValue)
    ) {
      // 递归合并嵌套对象
      result[key] = deepMerge(
        baseValue as Record<string, unknown>,
        overrideValue as Record<string, unknown>
      ) as T[keyof T];
    } else if (overrideValue !== undefined) {
      // 直接覆盖原始类型字段
      result[key] = overrideValue as T[keyof T];
    }
  }

  return result;
}

/**
 * 加载完整配置
 *
 * 按优先级依次加载和合并配置：
 * 1. 从配置文件加载
 * 2. 合并环境变量覆盖
 * 3. 使用 Zod Schema 校验并填充默认值
 *
 * @param options - 加载选项
 * @param options.configPath - 指定的配置文件路径
 * @param options.useCache - 是否使用缓存（默认 true）
 * @returns 完整的、经过校验的配置对象
 */
export async function loadConfig(options?: {
  configPath?: string;
  useCache?: boolean;
}): Promise<MyOpenClawConfig> {
  // 检查缓存
  if (options?.useCache !== false && cachedConfig) {
    return cachedConfig;
  }

  // 1. 从配置文件加载
  const { config: fileConfig } = await loadFromFile(options?.configPath);

  // 2. 加载环境变量覆盖
  const envConfig = loadEnvOverrides();

  // 3. 合并配置（优先级：env > file > defaults）
  const mergedConfig = deepMerge(
    deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, fileConfig as Record<string, unknown>),
    envConfig as Record<string, unknown>
  );

  // 4. 使用 Zod 校验并填充默认值
  const validatedConfig = ConfigSchema.parse(mergedConfig);

  // 5. 缓存结果
  cachedConfig = validatedConfig;

  return validatedConfig;
}

/**
 * 保存配置到文件
 *
 * 将当前配置写入用户主目录下的配置文件。
 * 默认保存路径：~/.myopenclawrc（JSON 格式）
 *
 * @param config - 要保存的配置对象
 * @param savePath - 可选的保存路径（默认使用用户主目录）
 */
export async function saveConfig(
  config: Partial<MyOpenClawConfig>,
  savePath?: string
): Promise<string> {
  // 获取完整配置用于保存
  const fullConfig = cachedConfig
    ? deepMerge(cachedConfig as unknown as Record<string, unknown>, config as Record<string, unknown>)
    : deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, config as Record<string, unknown>);

  // 使用 Zod 校验
  const validated = ConfigSchema.parse(fullConfig);

  // 确定保存路径
  const targetPath = savePath || getDefaultConfigPath();

  // 确保目录存在
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  // 写入配置文件（JSON 格式，便于阅读和修改）
  await fs.writeFile(targetPath, JSON.stringify(validated, null, 2), 'utf-8');

  // 更新缓存
  cachedConfig = validated;

  return targetPath;
}

/**
 * 获取默认配置文件路径
 *
 * 返回用户主目录下的配置文件路径。
 *
 * @returns 配置文件的绝对路径
 */
export function getDefaultConfigPath(): string {
  return path.join(os.homedir(), CONFIG_SEARCH_PATHS.RC_FILE);
}

/**
 * 获取当前配置文件路径
 *
 * 尝试查找当前实际使用的配置文件路径。
 * 如果没有找到配置文件，返回默认保存路径。
 *
 * @returns 当前配置文件路径
 */
export async function getConfigPath(): Promise<string> {
  try {
    const result = await explorer.search();
    if (result && !result.isEmpty && result.filepath) {
      return result.filepath;
    }
  } catch {
    // 忽略查找错误
  }
  return getDefaultConfigPath();
}

/**
 * 清除配置缓存
 *
 * 在配置文件被外部修改后调用此方法，
 * 确保下次加载时重新读取配置文件。
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}

/**
 * 从配置对象中获取指定键的值
 *
 * 支持点号分隔的嵌套键路径（如 "gateway.url"）。
 *
 * @param config - 配置对象
 * @param key - 点号分隔的键路径
 * @returns 键对应的值，如果不存在则返回 undefined
 */
export function getConfigValue(config: MyOpenClawConfig, key: string): unknown {
  const keys = key.split('.');
  let value: unknown = config;

  for (const k of keys) {
    if (value && typeof value === 'object' && k in (value as Record<string, unknown>)) {
      value = (value as Record<string, unknown>)[k];
    } else {
      return undefined;
    }
  }

  return value;
}

/**
 * 在配置对象中设置指定键的值
 *
 * 支持点号分隔的嵌套键路径（如 "gateway.url"）。
 * 会自动创建不存在的中间对象。
 *
 * @param config - 配置对象（会被修改）
 * @param key - 点号分隔的键路径
 * @param value - 要设置的值
 */
export function setConfigValue(
  config: Record<string, unknown>,
  key: string,
  value: unknown
): void {
  const keys = key.split('.');
  let target = config;

  // 遍历到倒数第二个键
  for (let i = 0; i < keys.length - 1; i++) {
    const currentKey = keys[i];
    if (!target[currentKey] || typeof target[currentKey] !== 'object') {
      target[currentKey] = {};
    }
    target = target[currentKey] as Record<string, unknown>;
  }

  // 设置最终键的值
  target[keys[keys.length - 1]] = value;
}

/**
 * 将字符串值解析为合适的类型
 *
 * 尝试将命令行参数的字符串值转换为正确的类型：
 * - "true"/"false" → 布尔值
 * - 数字字符串 → 数字
 * - 其他 → 保持字符串
 *
 * @param value - 原始字符串值
 * @returns 解析后的值
 */
export function parseConfigValue(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (!isNaN(Number(value))) return Number(value);
  return value;
}
