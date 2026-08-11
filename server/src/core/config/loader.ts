/**
 * 配置加载器(组合 yaml/json/merger/validator)
 *
 * 公开 API 保持不变 (向后兼容):
 * - loadConfig(): 加载并合并所有源,缓存
 * - loadAgentConfig(agentId): 加载 agent 配置(YAML)
 * - getConfig<T>(path, default): dot-path 读
 * - clearConfigCache(): 清除缓存(测试用)
 *
 * 加载顺序(后者覆盖前者):
 * 1. 默认配置 (defaults.ts)
 * 2. 项目 config/config.yaml + includes (yaml-loader.ts)
 * 3. ~/.myopenclaw/config.json (json-loader.ts,可选)
 * 4. MYOC_* 环境变量 (merger.applyEnvOverrides)
 * 5. 启动期校验 (validator.ts)
 *
 * @module @myopenclaw/server/core/config
 */

import { deepMerge, applyEnvOverrides } from './merger.js';
import { loadYamlConfig, resolveEnvVars } from './yaml-loader.js';
import { loadJsonConfig } from './json-loader.js';
import { getDefaultConfig } from './defaults.js';
import { validateStartupConfig } from './validator.js';
import { ConfigFatalError } from './errors.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { createLogger } from '../utils/logger.js';

const log = createLogger('config:loader');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** 项目根目录 (config/ 的父目录) */
const ROOT_DIR = join(__dirname, '..', '..', '..', '..');

let cachedConfig: Record<string, unknown> | null = null;

/**
 * 加载并缓存完整配置
 *
 * 优先级链: defaults < yaml < json < env
 * 启动期校验: 必填缺失 / 跨字段冲突 / 占位符拒绝
 *
 * @throws ConfigFatalError 启动期致命问题
 */
export function loadConfig(): Record<string, unknown> {
  if (cachedConfig) return cachedConfig;

  // 1. 默认配置
  const defaults = getDefaultConfig() as unknown as Record<string, unknown>;
  let merged = deepMerge({}, defaults);

  // 2. 项目 YAML
  const yamlConfig = loadYamlConfig();
  if (Object.keys(yamlConfig).length > 0) {
    // 解析 ${VAR} 引用
    const resolved = resolveEnvVars(yamlConfig);
    merged = deepMerge(merged, resolved);
    log.debug('已合并项目 YAML 配置');
  }

  // 3. 用户 JSON (可选)
  try {
    const jsonConfig = loadJsonConfig();
    if (jsonConfig) {
      merged = deepMerge(merged, jsonConfig as unknown as Record<string, unknown>);
      log.debug('已合并用户 JSON 配置');
    }
  } catch (err) {
    if (err instanceof ConfigFatalError) {
      // JSON 配置致命问题:直接抛(不静默降级,因为用户显式提供了)
      throw err;
    }
    throw err;
  }

  // 4. 环境变量
  applyEnvOverrides(merged);
  log.debug('已应用 MYOC_* 环境变量');

  // 5. 启动期校验
  try {
    validateStartupConfig(merged as unknown as Parameters<typeof validateStartupConfig>[0]);
  } catch (err) {
    if (err instanceof ConfigFatalError) {
      // 输出到 stderr(启动期 logger 可能未初始化)
      process.stderr.write(err.format() + '\n');
      throw err;
    }
    throw err;
  }

  cachedConfig = merged;
  return cachedConfig;
}

/**
 * 加载指定 Agent 的配置(从 config/agents/*.yaml 查找)
 *
 * 保留旧行为,只读 YAML,不读 JSON(agent-specific 配置)。
 * 支持 ${VAR_NAME} 环境变量引用。
 */
export function loadAgentConfig(agentId: string = 'default'): Record<string, unknown> | null {
  const config = loadConfig();

  // 先从合并后的主配置中查找(若有 agents 数组)
  const agents = config.agents as Record<string, unknown>[] | undefined;
  if (agents && Array.isArray(agents)) {
    for (const agent of agents) {
      if ((agent.id as string) === agentId) {
        return resolveEnvVars(agent);
      }
    }
  }

  // 兜底: 直接读 agents/default.yaml
  const agentConfigPath = join(ROOT_DIR, 'config', 'agents', 'default.yaml');
  if (existsSync(agentConfigPath)) {
    try {
      const raw = readFileSync(agentConfigPath, 'utf-8');
      const parsed = (parseYaml(raw) as Record<string, unknown>) ?? {};
      const agentList = parsed.agents as Record<string, unknown>[] | undefined;
      if (agentList && Array.isArray(agentList)) {
        for (const agent of agentList) {
          if ((agent.id as string) === agentId) {
            return resolveEnvVars(agent);
          }
        }
      }
      // 若指定 id 未找到,返回第一个启用的 agent
      if (agentList && agentList.length > 0) {
        for (const agent of agentList) {
          if (agent.enabled !== false) {
            return resolveEnvVars(agent);
          }
        }
        return resolveEnvVars(agentList[0]!);
      }
    } catch (err) {
      log.warn(
        { err: (err as Error).message },
        'Agent 配置加载失败',
      );
    }
  }

  return null;
}

/**
 * 按 dot-path 获取配置值
 *
 * @example getConfig<number>('network.ws.port', 18780)
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

/** 清除缓存(测试用) */
export function clearConfigCache(): void {
  cachedConfig = null;
}
