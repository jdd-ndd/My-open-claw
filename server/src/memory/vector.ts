/**
 * 长期向量记忆（Vector Memory）
 */
import { createLogger } from '../core/utils/logger.js';

const log = createLogger('memory:vector');

export class VectorMemory {
  /** 语义检索 */
  async search(_query: string, _topK = 5): Promise<Array<{ content: string; score: number }>> {
    log.debug('向量检索（占位实现）');
    return [];
  }

  /** 存储记忆 */
  async store(_content: string, _embedding?: number[]): Promise<void> {
    log.debug('存储向量记忆（占位实现）');
  }
}
