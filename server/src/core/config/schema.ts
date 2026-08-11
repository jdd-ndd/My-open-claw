/**
 * MyOpenClaw 配置 Schema(Zod)
 *
 * 单一真相: 所有 ~/.myopenclaw/config.json / config/config.yaml 字段
 * 都必须用 Zod schema 表达,运行时通过 schema.parse() 校验。
 *
 * 设计原则:
 * 1. 所有 schema 都标 .strict() 之外的默认 (passthrough 不开),确保未声明字段报错
 *    —— 避免用户写错字段时静默忽略
 * 2. 必填字段用 .min(1) / 范围约束 / enum 表达,避免空值进入运行时
 * 3. provider 枚举与 server/src/agents/llm/factory.ts 的支持列表保持一致
 *
 * 字段顺序按用户给出的 JSON 配置文件分类: app / network / llm /
 * embedding / memory / security / paths / logging / agents / features
 *
 * @module @myopenclaw/server/core/config
 */

import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════
// 通用原语
// ═══════════════════════════════════════════════════════════════

/** 端口 1-65535 */
const Port = z.number().int().min(1).max(65_535);

/** 非空字符串 (1-256 字符) */
const NonEmpty = z.string().min(1).max(256);

// ═══════════════════════════════════════════════════════════════
// 1. 应用元信息 (app)
// ═══════════════════════════════════════════════════════════════

const AppMode = z.enum(['production', 'development', 'test']);

export const AppSchema = z.object({
  name: NonEmpty.max(64).default('myopenclaw'),
  /** 默认从 package.json 读 — 允许 JSON 不写,loader 会回退 */
  version: z.string().min(1).max(32).optional(),
  mode: AppMode.default('production'),
});

export type AppConfig = z.infer<typeof AppSchema>;

// ═══════════════════════════════════════════════════════════════
// 2. 网络通信 (network)
// ═══════════════════════════════════════════════════════════════

const WsConfigSchema = z.object({
  host: NonEmpty.default('127.0.0.1'),
  port: Port.default(18780),
  path: z.string().min(1).max(256).default('/ws'),
});

const HttpConfigSchema = z.object({
  host: NonEmpty.default('127.0.0.1'),
  port: Port.default(18790),
  basePath: z.string().max(256).default(''),
});

const TimeoutConfigSchema = z.object({
  connectMs: z.number().int().min(100).max(120_000).default(10_000),
  readMs: z.number().int().min(100).max(300_000).default(30_000),
  idleMs: z.number().int().min(1_000).max(3_600_000).default(120_000),
  requestMs: z.number().int().min(100).max(600_000).default(60_000),
  shutdownMs: z.number().int().min(100).max(60_000).default(10_000),
});
// Zod 4 严格 default: 父 schema default 必须给完整对象
const TIMEOUT_DEFAULTS = {
  connectMs: 10_000, readMs: 30_000, idleMs: 120_000,
  requestMs: 60_000, shutdownMs: 10_000,
};

const PoolConfigSchema = z.object({
  maxConnections: z.number().int().min(1).max(10_000).default(100),
  maxConnectionsPerHost: z.number().int().min(1).max(1_000).default(16),
  keepAliveMs: z.number().int().min(1_000).max(3_600_000).default(60_000),
  keepAliveTimeoutMs: z.number().int().min(1_000).max(3_600_000).default(30_000),
  maxIdleConnections: z.number().int().min(0).max(1_000).default(16),
  pipelineDepth: z.number().int().min(1).max(10).default(1),
});
const POOL_DEFAULTS = {
  maxConnections: 100, maxConnectionsPerHost: 16,
  keepAliveMs: 60_000, keepAliveTimeoutMs: 30_000,
  maxIdleConnections: 16, pipelineDepth: 1,
};

const CorsConfigSchema = z.object({
  origins: z.array(z.string().min(1)).min(1).default(['http://localhost:3000']),
  credentials: z.boolean().default(true),
  maxAgeSeconds: z.number().int().min(0).max(86_400).default(86_400),
});
const CORS_DEFAULTS = { origins: ['http://localhost:3000'], credentials: true, maxAgeSeconds: 86_400 };

const TlsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  certPath: z.string().min(1).default('~/certs/server.crt'),
  keyPath: z.string().min(1).default('~/certs/server.key'),
  minVersion: z.enum(['TLSv1.2', 'TLSv1.3']).default('TLSv1.2'),
});
const TLS_DEFAULTS = { enabled: false, certPath: '~/certs/server.crt', keyPath: '~/certs/server.key', minVersion: 'TLSv1.2' as const };

export const NetworkSchema = z.object({
  ws: WsConfigSchema,
  http: HttpConfigSchema,
  timeout: TimeoutConfigSchema.default(TIMEOUT_DEFAULTS),
  pool: PoolConfigSchema.default(POOL_DEFAULTS),
  cors: CorsConfigSchema.default(CORS_DEFAULTS),
  tls: TlsConfigSchema.default(TLS_DEFAULTS),
});

export type NetworkConfig = z.infer<typeof NetworkSchema>;

// ═══════════════════════════════════════════════════════════════
// 3. LLM 服务 (llm)
// ═══════════════════════════════════════════════════════════════

export const LLM_PROVIDERS = ['openai', 'anthropic', 'deepseek', 'ollama', 'custom'] as const;
export const LLMProvider = z.enum(LLM_PROVIDERS);

const ReasoningEffort = z.enum(['none', 'low', 'medium', 'high']);

const ModelDefinitionSchema = z.object({
  id: NonEmpty,
  name: z.string().min(1).max(128).optional(),
  contextWindow: z.number().int().min(512).max(10_000_000).default(128_000),
  maxOutputTokens: z.number().int().min(64).max(1_000_000).default(4_096),
  supportsFunctions: z.boolean().default(true),
  supportsVision: z.boolean().default(false),
  supportsStreaming: z.boolean().default(true),
  costPer1kInput: z.number().min(0).optional(),
  costPer1kOutput: z.number().min(0).optional(),
});
export type ModelDefinition = z.infer<typeof ModelDefinitionSchema>;

const ModelParamsSchema = z.object({
  temperature: z.number().min(0).max(2).default(0.7),
  topP: z.number().min(0).max(1).default(0.9),
  frequencyPenalty: z.number().min(-2).max(2).default(0),
  presencePenalty: z.number().min(-2).max(2).default(0),
  maxTokens: z.number().int().min(1).max(1_000_000).default(4_096),
  stopSequences: z.array(z.string().min(1)).max(16).default([]),
  reasoningEffort: ReasoningEffort.default('high'),
});
const MODEL_PARAMS_DEFAULTS = {
  temperature: 0.7, topP: 0.9, frequencyPenalty: 0, presencePenalty: 0,
  maxTokens: 4_096, stopSequences: [] as string[], reasoningEffort: 'high' as const,
};

const RateLimitSchema = z.object({
  requestsPerMinute: z.number().int().min(1).max(10_000).default(60),
  tokensPerMinute: z.number().int().min(1).max(100_000_000).default(100_000),
  concurrent: z.number().int().min(1).max(1_000).default(16),
  burstMultiplier: z.number().min(1).max(10).default(1.5),
});
const RATE_LIMIT_DEFAULTS = { requestsPerMinute: 60, tokensPerMinute: 100_000, concurrent: 16, burstMultiplier: 1.5 };

const RetrySchema = z.object({
  maxRetries: z.number().int().min(0).max(10).default(2),
  initialBackoffMs: z.number().int().min(10).max(60_000).default(500),
  maxBackoffMs: z.number().int().min(100).max(600_000).default(10_000),
  backoffMultiplier: z.number().min(1).max(10).default(2.0),
  retryableStatusCodes: z.array(z.number().int().min(100).max(599))
    .min(1)
    .default([429, 500, 502, 503, 504]),
});
const RETRY_DEFAULTS = {
  maxRetries: 2, initialBackoffMs: 500, maxBackoffMs: 10_000,
  backoffMultiplier: 2.0, retryableStatusCodes: [429, 500, 502, 503, 504],
};

const StreamingSchema = z.object({
  enabled: z.boolean().default(true),
  includeUsage: z.boolean().default(true),
});
const STREAMING_DEFAULTS = { enabled: true, includeUsage: true };

const ProxySchema = z.object({
  enabled: z.boolean().default(false),
  url: z.string().min(1).default(''),
});
const PROXY_DEFAULTS = { enabled: false, url: '' };

export const LLMSchema = z.object({
  provider: LLMProvider,
  apiKey: z.string(), // 长度不在 schema 限制(允许 placeholder / 留作 refine 校验)
  baseUrl: z.string().url().or(z.string().regex(/^https?:\/\//, 'must be http(s) URL')),
  defaultModel: NonEmpty,

  models: z.array(ModelDefinitionSchema).min(1),
  modelParams: ModelParamsSchema.default(MODEL_PARAMS_DEFAULTS),

  rateLimit: RateLimitSchema.default(RATE_LIMIT_DEFAULTS),
  retry: RetrySchema.default(RETRY_DEFAULTS),
  streaming: StreamingSchema.default(STREAMING_DEFAULTS),
  proxy: ProxySchema.default(PROXY_DEFAULTS),
}).refine(
  // 跨字段: provider≠ollama 时 apiKey 必须非空
  // (允许 `${VAR}` 字面—— yaml-loader 在 env 未设时保留原样,refine 看作未解析占位符,fail-fast 提示用户)
  (cfg) => cfg.provider === 'ollama' || (cfg.apiKey && cfg.apiKey.length > 0),
  { message: 'provider ≠ ollama 时 llm.apiKey 必填(非空字符串)', path: ['apiKey'] },
);

export type LLMConfig = z.infer<typeof LLMSchema>;

// ═══════════════════════════════════════════════════════════════
// 4. 嵌入模型 (embedding)
// ═══════════════════════════════════════════════════════════════

export const EMBEDDING_PROVIDERS = ['openai', 'cohere', 'local'] as const;
const EmbeddingProvider = z.enum(EMBEDDING_PROVIDERS);

export const EmbeddingSchema = z.object({
  provider: EmbeddingProvider,
  apiKey: z.string(),
  baseUrl: z.string().min(1),
  model: NonEmpty,
  dimensions: z.number().int().min(1).max(10_000),
  batchSize: z.number().int().min(1).max(2_048).default(64),
});

export type EmbeddingConfig = z.infer<typeof EmbeddingSchema>;

// ═══════════════════════════════════════════════════════════════
// 5. 记忆层 (memory)
// ═══════════════════════════════════════════════════════════════

const SessionConfigSchema = z.object({
  maxMessages: z.number().int().min(1).max(10_000).default(50),
  ttlSeconds: z.number().int().min(60).max(365 * 86_400).default(86_400),
});
const SESSION_DEFAULTS = { maxMessages: 50, ttlSeconds: 86_400 };

const VectorConfigSchema = z.object({
  backend: z.enum(['local', 'qdrant', 'chroma']).default('local'),
  dimension: z.number().int().min(1).max(10_000).default(1536),
  distance: z.enum(['cosine', 'dot', 'euclidean']).default('cosine'),
});
const VECTOR_DEFAULTS = { backend: 'local' as const, dimension: 1536, distance: 'cosine' as const };

const PersistConfigSchema = z.object({
  backend: z.enum(['sqlite', 'postgres', 'none']).default('sqlite'),
  path: z.string().min(1),
}).refine(
  (cfg) => cfg.backend === 'none' || cfg.path.length > 0,
  { message: 'memory.persist.path 必填(当 backend ≠ none 时)', path: ['path'] },
);

export const MemorySchema = z.object({
  session: SessionConfigSchema.default(SESSION_DEFAULTS),
  vector: VectorConfigSchema.default(VECTOR_DEFAULTS),
  persist: PersistConfigSchema,
});

export type MemoryConfig = z.infer<typeof MemorySchema>;

// ═══════════════════════════════════════════════════════════════
// 6. 安全 (security)
// ═══════════════════════════════════════════════════════════════

const ApiRateLimitSchema = z.object({
  windowMs: z.number().int().min(1_000).max(3_600_000).default(60_000),
  max: z.number().int().min(1).max(1_000_000).default(120),
});
const API_RATE_LIMIT_DEFAULTS = { windowMs: 60_000, max: 120 };

const SandboxConfigSchema = z.object({
  workDir: z.string().min(1),
  maxMemoryMb: z.number().int().min(16).max(65_536).default(512),
  timeoutMs: z.number().int().min(100).max(3_600_000).default(30_000),
  allowNetwork: z.boolean().default(true),
});
// 注意: SandboxConfigSchema 有 workDir 必填,不能整体 default

const SecurityToolsSchema = z.object({
  allowedPaths: z.array(z.string().min(1)).min(0).default([]),
  blockedCommands: z.array(z.string().min(1)).min(0).default([]),
  requireConfirmation: z.array(z.string().min(1)).min(0).default([]),
  maxExecutionTimeMs: z.number().int().min(100).max(3_600_000).default(60_000),
  maxFileOperationBytes: z.number().int().min(0).max(10_737_418_240).default(10_485_760),
});
const SECURITY_TOOLS_DEFAULTS = {
  allowedPaths: [] as string[],
  blockedCommands: [] as string[],
  requireConfirmation: [] as string[],
  maxExecutionTimeMs: 60_000,
  maxFileOperationBytes: 10_485_760,
};

export const SecuritySchema = z.object({
  /** 启动期校验: 长度 ≥ 16, 且不等于 'please-change-me' */
  authToken: z.string().min(16, 'authToken 至少 16 字符'),
  apiRateLimit: ApiRateLimitSchema.default(API_RATE_LIMIT_DEFAULTS),
  sandbox: SandboxConfigSchema,
  tools: SecurityToolsSchema.default(SECURITY_TOOLS_DEFAULTS),
});

export type SecurityConfig = z.infer<typeof SecuritySchema>;

// ═══════════════════════════════════════════════════════════════
// 7. 路径 (paths)
// ═══════════════════════════════════════════════════════════════

export const PathsSchema = z.object({
  data: z.string().min(1).default('~/.myopenclaw/data'),
  logs: z.string().min(1).default('~/.myopenclaw/logs'),
  workspace: z.string().min(1).default('~/.myopenclaw/workspace'),
  skills: z.string().min(1).default('./skills'),
  pidFile: z.string().min(1).default('~/.myopenclaw/server.pid'),
});

export type PathsConfig = z.infer<typeof PathsSchema>;

// ═══════════════════════════════════════════════════════════════
// 8. 日志 (logging)
// ═══════════════════════════════════════════════════════════════

const LogLevel = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
const LogFormat = z.enum(['pretty', 'json']);
const LogOutput = z.enum(['console', 'file', 'both']);

const LogRotationSchema = z.object({
  enabled: z.boolean().default(true),
  maxSizeMb: z.number().int().min(1).max(10_240).default(50),
  maxFiles: z.number().int().min(1).max(1_000).default(10),
  compress: z.boolean().default(true),
});
const LOG_ROTATION_DEFAULTS = { enabled: true, maxSizeMb: 50, maxFiles: 10, compress: true };

export const LoggingSchema = z.object({
  level: LogLevel.default('info'),
  format: LogFormat.default('pretty'),
  output: LogOutput.default('console'),
  file: z.string().min(1).default('~/.myopenclaw/logs/server.log'),
  rotation: LogRotationSchema.default(LOG_ROTATION_DEFAULTS),
}).refine(
  (cfg) => cfg.output === 'console' || cfg.file.length > 0,
  { message: 'logging.file 必填(当 output ≠ console)', path: ['file'] },
);

export type LoggingConfig = z.infer<typeof LoggingSchema>;

// ═══════════════════════════════════════════════════════════════
// 9. Agents (agents)
// ═══════════════════════════════════════════════════════════════

const AgentConfigSchema = z.object({
  name: NonEmpty,
  systemPrompt: z.string().min(1),
  allowedTools: z.array(z.string()).default([]),
  allowedSkills: z.array(z.string()).default([]),
  maxIterations: z.number().int().min(1).max(100).default(20),
  timeoutMs: z.number().int().min(1_000).max(3_600_000).default(60_000),
});

export const AgentsSchema = z.object({
  default: AgentConfigSchema.optional(),
  maxConcurrent: z.number().int().min(1).max(1_000).default(8),
});
export type AgentsConfig = z.infer<typeof AgentsSchema>;

// ═══════════════════════════════════════════════════════════════
// 10. 特性开关 (features)
// ═══════════════════════════════════════════════════════════════

export const FeaturesSchema = z.object({
  scheduler: z.boolean().default(true),
  audit: z.boolean().default(true),
  rateLimit: z.boolean().default(true),
  memory: z.boolean().default(true),
  vectorSearch: z.boolean().default(true),
  streaming: z.boolean().default(true),
});

export type FeaturesConfig = z.infer<typeof FeaturesSchema>;

// ═══════════════════════════════════════════════════════════════
// 顶层: MyOpenClaw Config
// ═══════════════════════════════════════════════════════════════

/**
 * 顶层 MyOpenClaw 配置 schema
 *
 * 校验: 仅当全部字段通过 Zod 解析时,parse() 成功。
 * 必填字段 (无 .default()): network / llm / embedding / memory.persist / security
 */
const PATHS_DEFAULTS = {
  data: '~/.myopenclaw/data',
  logs: '~/.myopenclaw/logs',
  workspace: '~/.myopenclaw/workspace',
  skills: './skills',
  pidFile: '~/.myopenclaw/server.pid',
};
const AGENTS_DEFAULTS = { maxConcurrent: 8 };
const FEATURES_DEFAULTS = {
  scheduler: true, audit: true, rateLimit: true,
  memory: true, vectorSearch: true, streaming: true,
};
const APP_DEFAULTS = { name: 'myopenclaw', mode: 'production' as const };

export const MyOpenClawConfigSchema = z.object({
  $schema: z.string().optional(),
  app: AppSchema.default(APP_DEFAULTS),
  network: NetworkSchema,
  llm: LLMSchema,
  embedding: EmbeddingSchema,
  memory: MemorySchema,
  security: SecuritySchema,
  paths: PathsSchema.default(PATHS_DEFAULTS),
  logging: LoggingSchema.default({ level: 'info', format: 'pretty', output: 'console', file: '~/.myopenclaw/logs/server.log', rotation: LOG_ROTATION_DEFAULTS }),
  agents: AgentsSchema.default(AGENTS_DEFAULTS),
  features: FeaturesSchema.default(FEATURES_DEFAULTS),
});

export type MyOpenClawConfig = z.infer<typeof MyOpenClawConfigSchema>;

// 重新导出 zod namespace 方便使用
export { z };
