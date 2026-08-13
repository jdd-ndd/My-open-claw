import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryManager } from '../../../src/memory/manager.js';
import type { SessionMessage } from '../../../src/memory/types.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'memory-manager-'));
  tempDirs.push(dir);
  return dir;
}

function message(id: string, role: SessionMessage['role'], content: string, timestamp: number): SessionMessage {
  return { id, role, content, timestamp };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('MemoryManager', () => {
  it('initializes with a fresh data directory and is idempotent', async () => {
    const dataDir = createTempDir();
    const manager = new MemoryManager({ dataDir });

    await manager.initialize();
    // Second init is a no-op (idempotent)
    await expect(manager.initialize()).resolves.toBeUndefined();

    expect(manager.embedding.provider).toBe('local');
    expect(manager.session.activeCount).toBe(0);
    expect(manager.vector.size).toBe(0);

    await manager.shutdown();
    // Shutdown is also idempotent
    await expect(manager.shutdown()).resolves.toBeUndefined();
  });

  it('remember without storeVector writes only to session memory', async () => {
    const manager = new MemoryManager({ dataDir: createTempDir() });
    await manager.initialize();
    try {
      await manager.session.create('s1', { userId: 'u1', channelId: 'c1', agentId: 'a1' });

      await manager.remember('s1', message('m1', 'user', 'hello', Date.now()));

      const session = await manager.session.read('s1');
      expect(session?.messages).toHaveLength(1);
      expect(session?.messages[0].content).toBe('hello');
      expect(manager.vector.size).toBe(0);
    } finally {
      await manager.shutdown();
    }
  });

  it('remember with storeVector writes to both session and vector stores', async () => {
    const manager = new MemoryManager({ dataDir: createTempDir() });
    await manager.initialize();
    try {
      await manager.session.create('s1', { userId: 'u1', channelId: 'c1', agentId: 'a1' });

      await manager.remember('s1', message('m1', 'user', 'important fact to recall', Date.now()), {
        storeVector: true,
        type: 'fact',
        importance: 0.8,
      });

      expect(manager.vector.size).toBe(1);
      // The vector entry should have the metadata we passed
      const entries = await manager.vector.search('fact', { topK: 1 });
      expect(entries).toHaveLength(1);
      expect(entries[0].metadata.type).toBe('fact');
      expect(entries[0].metadata.sessionId).toBe('s1');
    } finally {
      await manager.shutdown();
    }
  });

  it('recall returns session context and matching long-term vectors', async () => {
    const manager = new MemoryManager({ dataDir: createTempDir() });
    await manager.initialize();
    try {
      await manager.session.create('chat-1', { userId: 'u1', channelId: 'c1', agentId: 'a1' });
      await manager.remember(
        'chat-1',
        message('m1', 'user', 'my favorite color is blue', Date.now()),
        { storeVector: true, type: 'preference' },
      );
      await manager.remember(
        'chat-1',
        message('m2', 'assistant', 'noted, blue it is', Date.now()),
      );

      const result = await manager.recall('chat-1', 'color preference', 3);

      expect(result.session).not.toBeNull();
      expect(result.session?.sessionId).toBe('chat-1');
      expect(result.vectors.length).toBeGreaterThan(0);
      // Top vector should mention color
      expect(result.vectors[0].content).toContain('color');
    } finally {
      await manager.shutdown();
    }
  });

  it('cleanExpired removes sessions past their TTL and leaves fresh ones', async () => {
    // Use TTL of 2s to give the test plenty of timing headroom.
    // The key behavior we test: cleanExpired evicts sessions whose lastActiveAt
    // is older than TTL, and does not touch ones that were recently touched.
    const dataDir = createTempDir();
    const manager = new MemoryManager({
      dataDir,
      sessionTtlSeconds: 2,
    });
    await manager.initialize();
    try {
      // Create two sessions, then 'touch' the second one to keep it fresh.
      await manager.session.create('old', { userId: 'u', channelId: 'c', agentId: 'a' });
      await manager.session.create('new', { userId: 'u', channelId: 'c', agentId: 'a' });

      // Sleep 2.2s so 'old' is past TTL
      await new Promise((resolve) => setTimeout(resolve, 2200));

      // Now refresh 'new' so it survives the cleanup
      await manager.remember(
        'new',
        message('m1', 'user', 'just now', Date.now()),
      );

      // Pre-cleanup state: both sessions exist, only 'old' is expired
      expect(manager.session.activeCount).toBe(2);

      const stats = await manager.cleanExpired();
      // 'old' is past TTL → removed; 'new' was just touched → kept
      expect(stats.sessions).toBe(1);
      expect(manager.session.activeCount).toBe(1);

      // 'new' is still readable, 'old' is gone
      await expect(manager.session.read('new')).resolves.not.toBeNull();
      await expect(manager.session.read('old')).resolves.toBeNull();
    } finally {
      await manager.shutdown();
    }
  });
});
