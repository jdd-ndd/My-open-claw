/**
 * LLM 相关类型定义
 *
 * @module @myopenclaw/server/core/types
 */

/** LLM 请求参数 */
export interface LLMRequest {
  messages: LLMMessage[];
  tools?: LLMToolDef[];
  maxTokens?: number;
  temperature?: number;
}

/** LLM 消息 */
export interface LLMMessage {
  role: 'user' | 'agent' | 'tool' | 'system';
  content: string | LLMContentBlock[];
}

/** LLM 内容块 */
export interface LLMContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  toolUse?: { toolName: string; arguments: Record<string, unknown>; callId: string };
  toolResult?: string;
}

/** LLM 工具定义 */
export interface LLMToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** LLM 响应 */
export interface LLMResponse {
  content: string;
  toolCalls?: Array<{ toolName: string; arguments: Record<string, unknown>; callId: string }>;
  tokensIn: number;
  tokensOut: number;
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'error';
}

/** LLM 流式响应块 */
export interface LLMStreamChunk {
  content: string;
  isFinal: boolean;
}
