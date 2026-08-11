/**
 * Gateway WebSocket 消息协议类型
 * 与 server/src/gateway/types/protocol.ts 一一对齐
 *
 * 三类消息:
 * - request   : 客户端 → server (发问)
 * - response  : server → 客户端 (request 的应答,匹配结果)
 * - event     : server → 客户端 (流式/通知)
 */

export type MessageDirection = 'request' | 'response' | 'event';

export interface BaseMessage {
  type: MessageDirection;
  id: string;
  timestamp: string;
}

// ── Request ──────────────────────────────────────────────

/** 客户端请求消息(对齐 server websocket-handler) */
export interface RequestMessage extends BaseMessage {
  type: 'request';
  action: string;
  payload: Record<string, unknown>;
}

// ── Response ─────────────────────────────────────────────

/** server 响应消息(对齐 server 路由结果) */
export interface ResponseMessage extends BaseMessage {
  type: 'response';
  requestId: string;
  status: 'success' | 'error';
  payload: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
}

// ── Event ────────────────────────────────────────────────

/** server 事件消息(流式 / 通知) */
export interface EventMessage extends BaseMessage {
  type: 'event';
  event: string;
  payload: Record<string, unknown>;
}

export type GatewayMessage = RequestMessage | ResponseMessage | EventMessage;

// ── Request Actions ──────────────────────────────────────

/**
 * 客户端可发的 action 列表。
 * 对应 server 的 MessageRouter 规则。
 */
export type RequestAction =
  | 'chat.send'        // 发送聊天消息
  | 'chat.cancel'      // 取消当前生成
  | 'chat.history'     // 查询历史消息（分页）
  | 'session.create'   // 显式创建会话(可选)
  | 'system.ping';     // 客户端主动 ping

// ── Chat 事件名(由 server 推送,客户端订阅) ──────────────

/**
 * server 推送到 client 的 chat 相关 event 名
 *
 * 事件流时序(一次完整 chat 生成):
 *
 *   1. chat.delta             ← 正文(answer)逐字/逐 chunk
 *      (可选) chat.reasoning_delta  ← 思考过程(推理链)逐字/逐 chunk
 *        ↑ 上面两个事件可并行,可任意顺序,可任意多次,可在对方开始前结束
 *   2. chat.done              ← 落定,totalContent + totalReasoning 一起回传
 *   3. chat.error (任一阶段都可能)  ← 出错,带 code + message
 *
 * 协议约束:
 * - 所有 chat.* 事件 payload 都带 sessionId
 * - 同一 sessionId 的事件按 server 推送顺序处理
 * - 客户端必须按事件顺序拼接 delta
 * - 落定后(chat.done 或 chat.error)该 sessionId 不会再有后续 chat.* 事件
 */
export type ChatEventName =
  | 'chat.delta'             // 正文 answer 增量
  | 'chat.reasoning_delta'   // 思考过程(reasoning_content)增量
  | 'chat.done'              // 生成完成,落定 final message
  | 'chat.error';            // 错误

// ── Chat History ──────────────────────────────────────────

/** 历史消息查询请求 payload */
export interface ChatHistoryPayload {
  sessionId: string;
  offset?: number;
  limit?: number;
}

/** 历史消息查询响应中的单条消息 */
export interface HistoryMessage {
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/** 历史消息查询响应 payload */
export interface ChatHistoryResponsePayload {
  sessionId: string;
  messages: HistoryMessage[];
  hasMore: boolean;
  total: number;
  offset: number;
  limit: number;
}

// ── Chat 流事件 payload ──────────────────────────────────

/**
 * `chat.delta` 事件 payload —— 助手回复正文(answer)增量
 *
 * 字段语义:
 * - delta        : 本次新增的字符片段(1-N 字符,server 决定 chunk 大小)
 * - accumulated  : 截至本次事件为止的累计正文(可选,server 实现决定)
 *                  推荐给(避免客户端 O(n²) 拼接);不给则客户端用 delta 自己拼
 * - thought      : 遗留字段,语义模糊,新代码不要用 — 见 ChatReasoningDeltaPayload
 *
 * 数据流向:
 *   LLM 流式 token → server 拆 chunk → chat.delta 推送 → client 拼接
 *
 * 关键信息提取过程:
 *   1. 客户端收到事件,读 payload.delta
 *   2. 优先用 payload.accumulated(若有)
 *   3. 否则 prev + delta 拼接到 streamingContent state
 *   4. 触发 MessageList 重渲染,StreamingBubble 显示新内容
 *
 * 决策依据:
 *   accumulated 优先于 delta 是为了避免长回答时 O(n²) 字符串拼接
 */
export interface ChatDeltaPayload {
  sessionId: string;
  delta: string;
  /** 当前累计内容(可选,server 端实现决定) */
  accumulated?: string;
  /**
   * @deprecated 字段语义模糊,新代码请用 chat.reasoning_delta 事件获取思考过程
   */
  thought?: string;
}

/**
 * `chat.reasoning_delta` 事件 payload —— 模型思考过程(reasoning_content)增量
 *
 * 字段说明:
 *   reasoning_content 是"会思考"的 LLM(DeepSeek-R1 / OpenAI o1 / o3 /
 *   Claude extended thinking / Gemini thinking 等)在生成最终答案前
 *   输出的"思维链 / 推理过程"。它解释了模型是如何一步步得到答案的:
 *
 *   - 逻辑步骤:模型把问题拆解成哪些子任务
 *   - 决策依据:在多个候选路径中为什么选这条
 *   - 关键信息提取:从问题/历史/工具结果中识别了哪些要点
 *   - 结论推导方式:如何从推理得到最终 answer
 *
 * 字段语义:
 * - delta        : 本次新增的思考片段(1-N 字符,server 拆 chunk)
 * - accumulated  : 截至本次事件为止的累计思考内容
 *                  推荐给;不给则客户端用 delta 自己拼接
 *
 * 数据流向:
 *   LLM reasoning_content → server 拆 chunk → chat.reasoning_delta 推送
 *     → client 拼接到 reasoningContent state
 *     → StreamingBubble / MessageItem 展示(实时/折叠)
 *
 * 何时触发:
 *   - 仅当 LLM 实际产生 reasoning_content 时
 *   - 没有 reasoning 的模型不会触发此事件
 *   - 一次 chat 可能有多段 reasoning(链式思考 + 自我修正)
 *
 * 完整逻辑链条:
 *   chat.reasoning_delta (多次,可与 chat.delta 交错)
 *     ↓ 落定
 *   chat.done.payload.totalReasoning
 *     ↓ 持久化
 *   ChatMessage.reasoning (history 中)
 *
 * 客户端如何展示:
 *   - 流式期间:StreamingBubble 永远展开,显示 "💭 思考中 · N chars" + 实时内容
 *   - 落定后:MessageItem 折叠为 "▶ 思考过程 (按 R 展开) · Ns",按 R 展开
 */
export interface ChatReasoningDeltaPayload {
  sessionId: string;
  /**
   * 本次新增的 reasoning_content 片段
   * server 拆 chunk 推送(模拟流式体验)
   */
  delta: string;
  /**
   * 截至本次事件为止的累计 reasoning_content
   * 推荐给(避免 O(n²) 拼接);不给则客户端用 delta 拼接
   */
  accumulated?: string;
}

/**
 * `chat.done` 事件 payload —— 生成完成,落定 final message
 *
 * 字段语义:
 * - sessionId      : 哪个会话
 * - messageId      : 落定消息的全局唯一 ID(持久化主键)
 * - totalContent   : 本次生成的正文的最终完整内容
 * - totalReasoning : 本次生成的思考过程的最终完整内容(若有)
 *                    落定后,客户端优先用此字段(而不是用 chat.reasoning_delta
 *                    事件自己拼接的 reasoningContent),保证 server / client 一致
 * - tokensUsed     : 本次生成消耗的 token 数(可选)
 * - durationMs     : 本次生成耗时(从 chat.send 收到到 chat.done 推送)
 * - reasoningDurationMs : 思考过程累计耗时(首条 chat.reasoning_delta → chat.done 的时间差)
 *                        落定后,客户端优先用此字段(而不是用 Date.now() - reasoningStartedAt 算),
 *                        因为 server 端是真实数据(包含 prefix / 续写等客户端看不见的轮次),
 *                        client 端只能看到本会话内的 delta,可能不准
 *
 * 关键信息提取:
 *   1. 读 totalContent + totalReasoning,落定一条 ChatMessage
 *   2. reasoningDurationMs:优先用 payload 字段,兜底用 client 累加
 *   3. streamingContent / reasoningContent 置空
 *   4. activeStream 置 null
 */
export interface ChatDonePayload {
  sessionId: string;
  messageId: string;
  totalContent: string;
  /** 最终落定的 reasoning_content(若有) — 优先于客户端自己拼接的 */
  totalReasoning?: string;
  tokensUsed?: number;
  durationMs?: number;
  /** 思考过程累计耗时(毫秒,可选) */
  reasoningDurationMs?: number;
}

/**
 * `chat.error` 事件 payload —— 出错
 *
 * 字段语义:
 * - sessionId : 哪个会话
 * - code      : 错误码(SERVER_ERROR / LLM_HTTP_400 / NO_AGENT / TIMEOUT / ...)
 * - message   : 错误描述
 * - retryable : 是否可重试(同 sessionId 重新发 chat.send)
 *
 * 决策依据:
 *   retryable=true  → UI 可自动 retry 或提示用户重试
 *   retryable=false → 通常是参数错误,需要修改后再发
 */
export interface ChatErrorPayload {
  sessionId: string;
  code: string;
  message: string;
  retryable?: boolean;
}

export interface ChatSendPayload {
  sessionId: string;
  content: string;
  channelId?: string;
  userId?: string;
  messageType?: 'text' | 'command' | 'system';
  attachments?: unknown[];
}

// ── Helpers ──────────────────────────────────────────────

/** 创建 RequestMessage,自动填 id 与 timestamp */
export function buildRequest(
  action: string,
  payload: Record<string, unknown>,
  idGen: () => string = defaultIdGen,
): RequestMessage {
  return {
    type: 'request',
    id: idGen(),
    timestamp: new Date().toISOString(),
    action,
    payload,
  };
}

/** 简易 ID 生成,生产可换 uuid */
export function defaultIdGen(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 类型守卫:EventMessage */
export function isEvent(msg: GatewayMessage): msg is EventMessage {
  return msg.type === 'event';
}

/** 类型守卫:ResponseMessage */
export function isResponse(msg: GatewayMessage): msg is ResponseMessage {
  return msg.type === 'response';
}

/** 类型守卫:RequestMessage */
export function isRequest(msg: GatewayMessage): msg is RequestMessage {
  return msg.type === 'request';
}
