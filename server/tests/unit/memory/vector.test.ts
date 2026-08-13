import { describe, expect, it } from 'vitest';
import { VectorMemory } from '../../../src/memory/vector.js';
import { EmbeddingService } from '../../../src/memory/embedding.js';

function createEmbedding(): EmbeddingService {
  // 强制走 keyword 回退模式, 避免网络依赖
  return new EmbeddingService({ provider: 'local' });
}

describe('VectorMemory', () => {
  it('stores entries and retrieves them by id', async () => {
    const memory = new VectorMemory(createEmbedding());

    const id = await memory.store({ content: 'first memory', metadata: {} });
    const entry = await memory.get(id);

    expect(entry).not.toBeNull();
    expect(entry?.content).toBe('first memory');
    expect(entry?.embedding.length).toBe(1536); // default dimension
    expect(entry?.dimension).toBe(1536);
    expect(memory.size).toBe(1);
  });

  it('searches by cosine similarity and returns top-K sorted by score', async () => {
    const memory = new VectorMemory(createEmbedding());

    // 关键词完全相同 → 高相似度
    await memory.store({ content: 'apple banana cherry', metadata: {} });
    // 关键词完全不同 → 低相似度
    await memory.store({ content: 'totally unrelated words here', metadata: {} });
    // 关键词部分相同 → 中相似度
    await memory.store({ content: 'banana cherry dragonfruit', metadata: {} });

    const results = await memory.search('apple banana', { topK: 3 });

    expect(results).toHaveLength(3);
    // Top result should be the one with most overlap
    expect(results[0].content).toContain('apple');
    // Each result has a score attached
    expect(typeof results[0].score).toBe('number');
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score ?? 0);
  });

  it('filters by metadata: sessionId, userId, type, tags', async () => {
    const memory = new VectorMemory(createEmbedding());

    await memory.store({
      content: 'session A content',
      metadata: { sessionId: 'A', userId: 'u1', type: 'knowledge', tags: ['x'] },
    });
    await memory.store({
      content: 'session B content',
      metadata: { sessionId: 'B', userId: 'u2', type: 'conversation', tags: ['y'] },
    });

    const onlyA = await memory.search('content', { sessionId: 'A' });
    expect(onlyA).toHaveLength(1);
    expect(onlyA[0].metadata.sessionId).toBe('A');

    const onlyType = await memory.search('content', { type: 'conversation' });
    expect(onlyType).toHaveLength(1);

    const onlyTag = await memory.search('content', { tags: ['x'] });
    expect(onlyTag).toHaveLength(1);
  });

  it('respects topK and threshold parameters', async () => {
    const memory = new VectorMemory(createEmbedding());

    for (let i = 0; i < 5; i++) {
      await memory.store({ content: `common word ${i} apple banana`, metadata: {} });
    }
    await memory.store({ content: 'unique unrelated zebra quokka', metadata: {} });

    const limited = await memory.search('apple banana', { topK: 2 });
    expect(limited).toHaveLength(2);

    const highThreshold = await memory.search('zebra', { threshold: 0.99 });
    expect(highThreshold).toHaveLength(0);
  });

  it('updates content and regenerates the embedding vector', async () => {
    const memory = new VectorMemory(createEmbedding());

    const id = await memory.store({ content: 'original', metadata: {} });
    const originalEntry = await memory.get(id);
    const originalEmbedding = originalEntry?.embedding;

    await memory.update(id, { content: 'completely new content' });

    const updated = await memory.get(id);
    expect(updated?.content).toBe('completely new content');
    // Embedding should have changed
    expect(updated?.embedding).not.toEqual(originalEmbedding);
  });

  it('deletes single entries and bulk-deletes by filter', async () => {
    const memory = new VectorMemory(createEmbedding());

    const id1 = await memory.store({ content: 'A', metadata: { sessionId: 'A' } });
    const id2 = await memory.store({ content: 'B', metadata: { sessionId: 'A' } });
    await memory.store({ content: 'C', metadata: { sessionId: 'B' } });

    expect(await memory.delete(id1)).toBe(true);
    expect(await memory.delete(id1)).toBe(false); // already gone
    expect(await memory.get(id1)).toBeNull();
    expect(await memory.get(id2)).not.toBeNull();

    const removed = await memory.deleteByFilter({ sessionId: 'A' });
    expect(removed).toBe(1);
    expect(await memory.get(id2)).toBeNull();
    expect(memory.size).toBe(1);
  });

  it('counts entries with optional filter and cleans up by importance', async () => {
    const memory = new VectorMemory(createEmbedding());

    await memory.store({ content: 'high', metadata: { importance: 0.9 } });
    await memory.store({ content: 'low', metadata: { importance: 0.1 } });
    await memory.store({ content: 'default', metadata: {} });

    expect(await memory.count()).toBe(3);
    expect(await memory.count({ sessionId: 'nonexistent' })).toBe(0);

    // 清理重要性 < 0.3
    const cleaned = await memory.cleanupLowImportance(0.3);
    expect(cleaned).toBe(1);
    expect(memory.size).toBe(2);
  });
});
