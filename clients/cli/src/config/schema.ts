/**
 * 配置校验 Schema
 *
 * 使用 Zod 进行运行时配置数据校验和类型推导，
 * 确保从配置文件、环境变量、命令行参数加载的配置数据合法有效。
 *
 * @module cli/config
 */

import { z } from 'zod';

/**
 * Gateway 连接配置 Schema
 */
const GatewayConfigSchema = z.object({
  /** Gateway HTTP API 基础地址 */
  url: z
    .string()
    .url('Gateway URL 必须是合法的 HTTP/HTTPS URL')
    .default('http://localhost:18780'),
  /** Gateway WebSocket 地址 */
  websocketUrl: z
    .string()
    .url('WebSocket URL 必须是合法的 WS/WSS URL')
    .default('ws://localhost:18780/ws'),
});

/**
 * 模型配置 Schema
 */
const ModelConfigSchema = z.object({
  /** 默认 LLM 模型名称 */
  default: z.string().min(1, '默认模型名称不能为空').default('gpt-4o'),
  /** 温度参数（0-2，控制输出随机性） */
  temperature: z
    .number()
    .min(0, '温度参数不能小于 0')
    .max(2, '温度参数不能大于 2')
    .default(0.7),
  /** 最大 Token 数量 */
  maxTokens: z
    .number()
    .int()
    .min(1, '最大 Token 数必须大于 0')
    .max(128000, '最大 Token 数不能超过 128000')
    .default(4096),
});

/**
 * 渠道配置 Schema
 */
const ChannelConfigSchema = z.object({
  /** 默认渠道 ID（myopenclaw = 三端共享渠道，与 web/tui_python 保持一致以实现跨端同步） */
  default: z.string().min(1, '默认渠道不能为空').default('myopenclaw'),
});

/**
 * CLI 行为配置 Schema
 */
const CliBehaviorConfigSchema = z.object({
  /** 输出格式：文本、JSON、表格 */
  outputFormat: z
    .enum(['text', 'json', 'table'])
    .default('text'),
  /** HTTP 请求超时时间（秒） */
  timeout: z
    .number()
    .int()
    .min(1, '超时时间不能小于 1 秒')
    .default(60),
  /** 历史对话记录大小限制 */
  historySize: z
    .number()
    .int()
    .min(0, '历史记录大小不能为负数')
    .default(100),
  /** 是否启用终端颜色输出 */
  enableColors: z.boolean().default(true),
});

/**
 * 完整配置 Schema
 *
 * 使用 Zod 进行运行时校验和默认值填充。
 * 各部分配置均有合理的默认值，确保 CLI 在无配置文件时也能正常运行。
 */
export const ConfigSchema = z.object({
  /** Gateway 连接配置 */
  gateway: GatewayConfigSchema.default({}),
  /** LLM 模型配置 */
  model: ModelConfigSchema.default({}),
  /** 渠道配置 */
  channel: ChannelConfigSchema.default({}),
  /** CLI 行为配置 */
  cli: CliBehaviorConfigSchema.default({}),
});

/**
 * 配置类型（从 Schema 自动推导）
 *
 * 使用 Zod 的 infer 方法自动推导配置对象的 TypeScript 类型，
 * 保持类型定义与 Schema 定义的一致性，避免手动维护类型。
 */
export type MyOpenClawConfig = z.infer<typeof ConfigSchema>;

/**
 * 配置校验结果类型
 */
export type ConfigValidationResult =
  | { success: true; data: MyOpenClawConfig }
  | { success: false; errors: z.ZodIssue[] };

/**
 * 校验配置对象
 *
 * @param config - 待校验的配置对象（可能是部分配置）
 * @returns 校验结果，包含合法的完整配置或错误信息
 */
export function validateConfig(config: unknown): ConfigValidationResult {
  const result = ConfigSchema.safeParse(config);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: result.error.issues };
}

/**
 * 校验部分配置（用于 update 操作）
 *
 * @param partial - 部分配置对象
 * @returns 校验结果
 */
export function validatePartialConfig(
  partial: Partial<MyOpenClawConfig>
): ConfigValidationResult {
  // 先获取默认配置
  const defaults = ConfigSchema.parse({});
  // 合并部分配置与默认值
  const merged = { ...defaults, ...partial };
  // 校验合并后的完整配置
  return validateConfig(merged);
}
