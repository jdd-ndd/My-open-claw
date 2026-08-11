/**
 * 配置合并器
 *
 * 职责:
 * - deepMerge: 递归合并两个对象(source 覆盖 target,数组整体替换)
 * - applyEnvOverrides: 应用 MYOC_* 环境变量覆盖
 *
 * 优先级: 数组替换(不拼接),对象递归,标量覆盖
 *
 * @module @myopenclaw/server/core/config
 */

export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const t = result[key];
    if (
      value && typeof value === 'object' && !Array.isArray(value) &&
      t && typeof t === 'object' && !Array.isArray(t)
    ) {
      result[key] = deepMerge(t as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      // 数组 / 标量 / null 整体覆盖
      result[key] = value;
    }
  }
  return result;
}

function coerceValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  if (/^\d+\.\d+$/.test(raw)) return Number(raw);
  return raw;
}

function setConfigByPath(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    if (!current[k] || typeof current[k] !== 'object') {
      current[k] = {};
    }
    current = current[k] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]!] = value;
}

/**
 * MYOC_SEGMENT_SEGMENT → segment.segment.path
 *
 * 例:
 *   MYOC_NETWORK_WS_PORT     → "network.ws.port"
 *   MYOC_FEATURES_SCHEDULER  → "features.scheduler"
 *   MYOC_LLM_API_KEY         → "llm.api_key" (无映射时按字面小写)
 *
 * 注意: explicitMappings 优先,用于保留 camelCase (apiKey, baseUrl 等)
 */
function myocEnvToPath(envKey: string): string {
  const stripped = envKey.replace(/^MYOC_/, '');
  return stripped.toLowerCase().replaceAll('_', '.');
}

/**
 * 应用 MYOC_* 前缀环境变量覆盖
 *
 * 显式映射(保留 camelCase): MYOC_LLM_API_KEY → llm.apiKey
 * 自动转换(全小写 + 点分隔): MYOC_NETWORK_WS_PORT → network.ws.port
 */
export function applyEnvOverrides(config: Record<string, unknown>, prefix = ''): void {
  const explicitMappings: Record<string, string> = {
    MYOC_LLM_API_KEY: 'llm.apiKey',
    MYOC_LLM_APIKEY: 'llm.apiKey',  // 兼容无下划线写法
    MYOC_LLM_PROVIDER: 'llm.provider',
    MYOC_LLM_BASE_URL: 'llm.baseUrl',
    MYOC_LLM_BASEURL: 'llm.baseUrl',
    MYOC_LLM_DEFAULT_MODEL: 'llm.defaultModel',
    MYOC_LLM_DEFAULTMODEL: 'llm.defaultModel',
    MYOC_EMBEDDING_API_KEY: 'embedding.apiKey',
    MYOC_EMBEDDING_APIKEY: 'embedding.apiKey',
    MYOC_EMBEDDING_PROVIDER: 'embedding.provider',
    MYOC_EMBEDDING_BASE_URL: 'embedding.baseUrl',
    MYOC_EMBEDDING_BASEURL: 'embedding.baseUrl',
    MYOC_EMBEDDING_MODEL: 'embedding.model',
    MYOC_EMBEDDING_DIMENSIONS: 'embedding.dimensions',
    MYOC_SECURITY_AUTHTOKEN: 'security.authToken',
    MYOC_PATHS_DATA: 'paths.data',
    MYOC_PATHS_LOGS: 'paths.logs',
    MYOC_PATHS_WORKSPACE: 'paths.workspace',
    MYOC_LOGGING_LEVEL: 'logging.level',
    MYOC_LOGGING_FORMAT: 'logging.format',
    MYOC_LOGGING_OUTPUT: 'logging.output',
    MYOC_LOGGING_FILE: 'logging.file',
  };
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('MYOC_')) continue;
    const explicitPath = explicitMappings[key];
    const autoPath = myocEnvToPath(key);
    const path = explicitPath ?? autoPath;
    const fullPath = prefix ? `${prefix}.${path}` : path;
    setConfigByPath(config, fullPath, coerceValue(value ?? ''));
  }
}
