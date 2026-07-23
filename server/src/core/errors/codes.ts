/**
 * 错误码常量定义
 *
 * MyOpenClaw 采用 6 位数字错误码，按模块分段：
 * - 100xxx: 通用错误（未知、内部、超时等）
 * - 200xxx: 校验错误（Schema 校验失败、格式/字段/类型错误）
 * - 300xxx: 鉴权错误（未认证、无权限、Token 过期/无效）
 * - 400xxx: 限流错误（频率超限、配额超限、并发超限）
 * - 500xxx: 会话/消息/任务错误（未找到、已关闭、已过期）
 * - 600xxx: 工具错误（未找到、执行失败、超时、未授权）
 * - 700xxx: LLM 错误（调用失败、超时、限流、无效响应）
 * - 800xxx: 记忆错误（读写失败、存储满）
 * - 900xxx: 渠道错误（断开、异常）
 *
 * @module @myopenclaw/server/core/errors
 */

export const ErrorCode = {
  // 通用错误 (100xxx)
  /** 未知错误 — 未捕获的异常 */
  UNKNOWN: 100000,
  /** 内部错误 — 内部逻辑异常 */
  INTERNAL: 100001,
  /** 功能未实现 — 调用未实现的接口 */
  NOT_IMPLEMENTED: 100002,
  /** 服务不可用 — 模块未启动或过载 */
  SERVICE_UNAVAILABLE: 100003,
  /** 超时 — 请求或操作超时 */
  TIMEOUT: 100004,

  // 校验错误 (200xxx)
  /** 数据校验失败 — Schema 校验不通过 */
  VALIDATION: 200001,
  /** 格式错误 — 字段格式不符合要求 */
  INVALID_FORMAT: 200002,
  /** 缺少必填字段 — 请求缺少必填参数 */
  MISSING_FIELD: 200003,
  /** 类型错误 — 字段类型不匹配 */
  INVALID_TYPE: 200004,
  /** 配置错误 — 配置项非法 */
  CONFIG: 200005,

  // 鉴权错误 (300xxx)
  /** 未认证 — 缺少或无效的 Token */
  UNAUTHORIZED: 300001,
  /** 无权限 — 权限不足 */
  FORBIDDEN: 300002,
  /** Token 过期 */
  TOKEN_EXPIRED: 300003,
  /** Token 无效 — 签名错误或格式错误 */
  TOKEN_INVALID: 300004,

  // 限流错误 (400xxx)
  /** 超过请求频率限制 */
  RATE_LIMIT: 400001,
  /** 超过调用配额 */
  QUOTA_EXCEEDED: 400002,
  /** 超过并发会话数 */
  CONCURRENT_LIMIT: 400003,

  // 会话/消息/任务错误 (500xxx)
  /** 会话不存在 */
  SESSION_NOT_FOUND: 500001,
  /** 会话已关闭 — 对已关闭会话操作 */
  SESSION_CLOSED: 500002,
  /** 会话已过期 — 超过最大存活时间 */
  SESSION_EXPIRED: 500003,
  /** 消息不存在 — 引用不存在的消息 */
  MESSAGE_NOT_FOUND: 500004,
  /** 任务不存在 */
  TASK_NOT_FOUND: 500005,

  // 工具错误 (600xxx)
  /** 工具不存在 — 调用未注册的工具 */
  TOOL_NOT_FOUND: 600001,
  /** 工具执行失败 — 工具内部异常 */
  TOOL_EXECUTION_FAILED: 600002,
  /** 工具执行超时 */
  TOOL_TIMEOUT: 600003,
  /** 工具未授权 — 会话未授权该工具 */
  TOOL_NOT_ALLOWED: 600004,

  // LLM 错误 (700xxx)
  /** LLM 调用错误 */
  LLM_ERROR: 700001,
  /** LLM 调用超时 */
  LLM_TIMEOUT: 700002,
  /** LLM 限流 */
  LLM_RATE_LIMIT: 700003,
  /** LLM 响应无效 — 返回无法解析的内容 */
  LLM_INVALID_RESPONSE: 700004,

  // 记忆错误 (800xxx)
  /** 记忆模块错误 — 读写异常 */
  MEMORY_ERROR: 800001,
  /** 记忆存储已满 — 向量存储空间不足 */
  MEMORY_FULL: 800002,

  // 渠道错误 (900xxx)
  /** 渠道错误 — 渠道层异常 */
  CHANNEL_ERROR: 900001,
  /** 渠道断开 — 连接断开 */
  CHANNEL_DISCONNECTED: 900002,
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];
