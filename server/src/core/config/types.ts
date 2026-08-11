/**
 * MyOpenClaw 配置类型(从 Zod schema 推导)
 *
 * 单向依赖: types.ts <- schema.ts
 * 任何对 schema 的修改会自动反映到这里的类型。
 *
 * @module @myopenclaw/server/core/config
 */

export type {
  // 顶层
  MyOpenClawConfig,
  // 子模块
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
} from './schema.js';

// 常量枚举(供外部使用,比如 agent-runtime-adapter 检查 provider 是否支持)
export { LLM_PROVIDERS, EMBEDDING_PROVIDERS } from './schema.js';
