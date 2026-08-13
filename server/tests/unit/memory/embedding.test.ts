import { describe, expect, it } from 'vitest';
import { EmbeddingService } from '../../../src/memory/embedding.js';

describe('EmbeddingService', () => {
  it('uses local keyword fallback when no API key is provided', () => {
    const service = new EmbeddingService({ provider: 'local' });
    expect(service.provider).toBe('local');
    expect(service.available).toBe(false);
    expect(service.getDimension()).toBe(1536);
  });

  it('marks itself as available when provider is openai with an api key', () => {
    const service = new EmbeddingService({
      provider: 'openai',
      apiKey: 'sk-test-not-real',
      baseUrl: 'https://api.openai.com/v1',
    });
    expect(service.available).toBe(true);
    expect(service.provider).toBe('openai');
  });

  it('respects custom dimension from config', () => {
    const service = new EmbeddingService({
      provider: 'local',
      dimensions: 256,
    });
    expect(service.getDimension()).toBe(256);
  });

  it('returns a normalized 1536-dim vector for non-empty text', async () => {
    const service = new EmbeddingService({ provider: 'local' });
    const vector = await service.computeEmbedding('hello world 你好');

    expect(vector).toHaveLength(1536);
    expect(vector.every((v) => Number.isFinite(v))).toBe(true);

    // L2 norm should be ~1.0 after normalization
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeGreaterThan(0.99);
    expect(norm).toBeLessThanOrEqual(1.01);
  });

  it('returns a zero vector for empty or whitespace-only text', async () => {
    const service = new EmbeddingService({ provider: 'local' });
    const empty = await service.computeEmbedding('');
    const whitespace = await service.computeEmbedding('   \t\n  ');

    expect(empty).toHaveLength(1536);
    expect(empty.every((v) => v === 0)).toBe(true);
    expect(whitespace.every((v) => v === 0)).toBe(true);
  });

  it('returns consistent vectors for the same text (cache hit is deterministic)', async () => {
    const service = new EmbeddingService({ provider: 'local' });
    const text = 'consistent keyword banana';

    const first = await service.computeEmbedding(text);
    const second = await service.computeEmbedding(text);
    const third = await service.computeEmbedding(text);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('computeBatch returns one vector per input text in order', async () => {
    const service = new EmbeddingService({ provider: 'local' });
    const texts = ['alpha', 'beta', 'gamma', 'delta'];

    const vectors = await service.computeBatch(texts);
    expect(vectors).toHaveLength(texts.length);
    for (const v of vectors) {
      expect(v).toHaveLength(1536);
    }

    // Each batch item, computed individually, should match the batch result
    for (let i = 0; i < texts.length; i++) {
      const single = await service.computeEmbedding(texts[i]);
      expect(vectors[i]).toEqual(single);
    }
  });
});
