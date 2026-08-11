import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryManager } from '../../../src/memory/manager.js';
import { createToolRegistry } from '../../../src/tools/index.js';

describe('tools - memory_search integration', () => {
  it('uses real vector memory from the injected memory manager', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'myoc-memory-search-'));

    try {
      const memory = new MemoryManager({ dataDir });
      await memory.initialize();

      await memory.session.create('session-1', {
        userId: 'user-1',
        channelId: 'web',
        agentId: 'default',
      });

      await memory.vector.store({
        content: 'DeepSeek API key is stored in the secure vault.',
        metadata: {
          sessionId: 'session-1',
          userId: 'user-1',
          type: 'knowledge',
          importance: 0.9,
          tags: ['deepseek', 'api'],
          createdAt: Date.now(),
        },
      });

      const registry = await createToolRegistry({ memory });
      const result = await registry.invoke('memory_search/search', {
        query: 'Where is the DeepSeek API key stored?',
        sessionId: 'session-1',
        topK: 3,
      }, {
        sessionId: 'session-1',
        userId: 'user-1',
        channelId: 'web',
      });

      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect((result.data as Array<{ content: string }>)[0]?.content).toContain('DeepSeek API key');

      await memory.shutdown();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
