/**
 * UI 层通用类型定义
 * 视图模式、焦点区域、连接状态等
 */

export type ViewMode = 'launch' | 'connecting' | 'chat' | 'help';
export type ConnectionState = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';
export type FocusArea = 'input' | 'messages' | 'sidebar';
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * 聊天消息(在 messages 数组里存储,history 持久化 + chat.done 落定)
 *
 * 字段说明:
 * - id              : 消息唯一 ID(持久化主键)。user 消息用 `user-<ts>`,
 *                     assistant 消息用 server 给的 messageId
 * - role            : user / assistant / system
 * - content         : 消息正文(assistant 时是 answer,user 时是用户输入)
 * - time            : 本地时间戳(HH:MM 格式,formatNow() 生成)
 * - reasoning       : 思考过程(若 assistant 消息有 reasoning_content)
 *                     默认折叠;按 R 展开(在 messages 焦点下)
 * - reasoningDurationMs : 思考用时(毫秒),从首条 chat.reasoning_delta 事件
 *                     到 chat.done 事件之间的时间
 */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  time: string;
  /** @deprecated 旧字段,新代码用 reasoning 替代 */
  thought?: string;
  /**
   * 思考过程(reasoning_content)
   * 字段语义:由 LLM 在生成 answer 前的"推理链"原文
   * 包含事件分析的逻辑步骤、决策依据、关键信息提取过程及结论推导方式
   * 数据来源:server 在 chat.done 事件里给的 totalReasoning,
   *          或 client 从 chat.reasoning_delta 事件拼出的 reasoningContent
   * 默认折叠(MessageItem 渲染为 "▶ 思考过程 (按 R 展开)")
   */
  reasoning?: string;
  /** 思考过程耗时(毫秒);当 reasoning 存在时才有意义 */
  reasoningDurationMs?: number;
}

export interface ActiveStream {
  id: string;
  prompt: string;
  time: string;
}
