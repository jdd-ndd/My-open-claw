/**
 * Embedding �?向量嵌入计算服务
 */
import { createLogger } from '../core/utils/logger.js';

const log = createLogger('memory:embedding');

export class EmbeddingService {
  /** 计算文本嵌入向量 */
  async computeEmbedding(_text: string): Promise<number[]> {
    log.debug('计算嵌入向量（占位实现）');
    return [];
  }
}
