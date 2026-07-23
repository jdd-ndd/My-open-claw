/**
 * LLM Adapter �?多模型适配�? *
 * 统一封装 OpenAI / Claude / DeepSeek / 本地开源模型接口，
 * 切换模型无需修改 Agent 核心逻辑�? *
 * @module @myopenclaw/server/agents
 */

import type { LLMRequest, LLMResponse, LLMStreamChunk } from '../../core/types/index.js';
import { createLogger } from '../../core/utils/logger.js';

const log = createLogger('agent:llm');

export class LLMAdapter {
  /**
   * 发�?LLM 聊天请求
   */
  async chat(_request: LLMRequest): Promise<LLMResponse> {
    log.debug('LLM 调用（占位）');
    return {
      content: '[LLM 响应占位]',
      tokensIn: 0,
      tokensOut: 0,
      finishReason: 'stop',
    };
  }

  /**
   * 流式聊天响应
   */
  async *chatStream(_request: LLMRequest): AsyncGenerator<LLMStreamChunk> {
    yield { content: '[流式响应占位]', isFinal: true };
  }
}
