/**
 * Core Config — 聚合导出
 *
 * @module @myopenclaw/server/core/config
 */

// ── 公开 API(向后兼容) ──
export { loadConfig, getConfig, loadAgentConfig, clearConfigCache } from './loader.js';

// ── 新增 API ──
export {
  loadJsonConfig,
} from './json-loader.js';
export {
  loadYamlConfig,
  resolveEnvVars,
} from './yaml-loader.js';
export {
  getDefaultConfig,
} from './defaults.js';
export {
  validateStartupConfig,
} from './validator.js';
export {
  deepMerge as deepMergeConfig,
  applyEnvOverrides as applyConfigEnvOverrides,
} from './merger.js';
export {
  resolveUserConfigPath,
  resolveProjectConfigPath,
  userConfigExists,
  expandHome,
} from './paths.js';
export {
  ConfigFatalError,
  zodToIssues,
} from './errors.js';
export type { ConfigIssue, ConfigErrorLevel } from './errors.js';

// ── Schema + Types ──
export {
  MyOpenClawConfigSchema,
  AppSchema,
  NetworkSchema,
  LLMSchema,
  EmbeddingSchema,
  MemorySchema,
  SecuritySchema,
  PathsSchema,
  LoggingSchema,
  AgentsSchema,
  FeaturesSchema,
  LLM_PROVIDERS,
  EMBEDDING_PROVIDERS,
  z,
} from './schema.js';
export type {
  MyOpenClawConfig,
  AppConfig,
  NetworkConfig,
  LLMConfig,
  ModelDefinition,
  EmbeddingConfig,
  MemoryConfig,
  SecurityConfig,
  PathsConfig,
  LoggingConfig,
  AgentsConfig,
  FeaturesConfig,
} from './types.js';
