/**
 * 工具相关类型定义（完整版 v1.0.2）
 *
 * 对齐文档：docs/06-Tools工具与技能模块.md §3.1 §3.2
 * 包含工具接口、执行结果、调用上下文、注册选项等完整类型体系。
 *
 * @module @myopenclaw/server/core/types
 */

// ═══════════════════════════════════════════════════════════════
// JSON Schema 类型定义
// ═══════════════════════════════════════════════════════════════

/** JSON Schema 类型（简化定义，供工具参数校验和注入 LLM 使用） */
export interface JSONSchema {
  type: 'object';
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

/** JSON Schema 属性定义 */
export interface JSONSchemaProperty {
  type: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  items?: JSONSchema;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean | Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// 工具接口（对齐文档 §3.2）
// ═══════════════════════════════════════════════════════════════

/** 工具统一接口 —— 所有工具都必须实现此接口 */
export interface Tool {
  /** 工具唯一名称（命名空间/动作，如 fs/read_file） */
  readonly name: string;

  /** 工具描述（供 LLM 理解工具用途） */
  readonly description: string;

  /** 工具分类（如 fs、exec、browser、memory_search、http） */
  readonly category: string;

  /** 参数 Schema（JSON Schema 格式，供校验和注入 LLM） */
  readonly parameters: JSONSchema;

  /** 风险等级：low（只读）/ medium（可逆写）/ high（不可逆写） */
  readonly risk: 'low' | 'medium' | 'high';

  /** 是否为内置工具（内置工具不可被注销） */
  readonly builtin: boolean;

  /**
   * 执行工具
   *
   * @param params 经过校验的参数
   * @param context 调用上下文（会话 ID、用户权限等）
   * @returns 执行结果
   */
  execute(
    params: Record<string, unknown>,
    context: InvokeContext,
  ): Promise<ToolResult>;
}

// ═══════════════════════════════════════════════════════════════
// 工具执行结果（对齐文档 §3.2）
// ═══════════════════════════════════════════════════════════════

/** 工具执行结果 */
export interface ToolResult {
  /** 执行是否成功 */
  success: boolean;
  /** 执行状态 */
  status: 'success' | 'error' | 'timeout';
  /** 输出数据（成功时） */
  data?: unknown;
  /** 输出数据别名（兼容旧接口） */
  result?: unknown;
  /** 错误信息（失败时） */
  error?: string;
  /** 错误码（失败时） */
  errorCode?: string;
  /** 执行元信息 */
  metadata?: {
    /** 执行耗时（毫秒） */
    durationMs: number;
    /** 产生副作用标记（如是否修改了文件系统） */
    sideEffects?: string[];
    /** 资源使用信息 */
    resources?: Record<string, unknown>;
  };
}

// ═══════════════════════════════════════════════════════════════
// 调用上下文（对齐文档 §3.1）
// ═══════════════════════════════════════════════════════════════

/** 工具调用上下文 */
export interface InvokeContext {
  /** 会话 ID */
  sessionId: string;
  /** 用户 ID */
  userId: string;
  /** 渠道 ID */
  channelId: string;
  /** 用户权限信息 */
  permissions?: UserPermissions;
  /** 允许的工作目录列表（文件操作白名单） */
  allowedPaths?: string[];
  /** 调用超时时间（毫秒） */
  timeoutMs?: number;
  /** 通用配置 */
  config?: Record<string, unknown>;
}

/** 用户权限信息 */
export interface UserPermissions {
  /** 允许的操作类别 */
  allowedCategories?: string[];
  /** 最大风险等级允许自动执行 */
  maxAutoRisk?: 'low' | 'medium' | 'high';
  /** 是否需要所有危险操作确认 */
  requireConfirmationForAll?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 注册相关类型（对齐文档 §3.1）
// ═══════════════════════════════════════════════════════════════

/** 注册选项 */
export interface RegisterOptions {
  /** 是否覆盖同名工具（默认 false） */
  force?: boolean;
  /** 是否为内置工具（内置工具不可注销） */
  builtin?: boolean;
}

/** 工具过滤条件 */
export interface ToolFilter {
  /** 按命名空间过滤（如 fs、exec、browser） */
  namespace?: string;
  /** 按风险等级过滤 */
  risk?: 'low' | 'medium' | 'high';
  /** 是否只返回内置工具 */
  builtinOnly?: boolean;
  /** 按分类过滤 */
  category?: string;
}

/** 工具描述符 */
export interface ToolDescriptor {
  /** 工具名（唯一标识） */
  name: string;
  /** 工具描述 */
  description: string;
  /** 参数 Schema（JSON Schema 格式） */
  parameters: JSONSchema;
  /** 风险等级 */
  risk: 'low' | 'medium' | 'high';
  /** 是否为内置工具 */
  builtin: boolean;
  /** 工具分类 */
  category: string;
}

/** 注册中心变更事件 */
export interface RegistryChangeEvent {
  /** 事件类型：注册 / 注销 */
  type: 'register' | 'unregister';
  /** 受影响的工具名 */
  toolName: string;
  /** 时间戳 */
  timestamp: number;
}

/** 单次工具调用 */
export interface ToolCall {
  /** 工具名 */
  name: string;
  /** 调用参数 */
  params: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// 兼容旧版 ToolContext（保持向后兼容）
// ═══════════════════════════════════════════════════════════════

/**
 * 旧版工具执行上下文（兼容接口，逐步迁移至 InvokeContext）
 *
 * @deprecated 请使用 InvokeContext 替代
 */
export interface ToolContext {
  sessionId: string;
  userId: string;
  channelId: string;
  config: Record<string, unknown>;
}
