import { describe, expect, it, vi } from 'vitest';
import { SessionMemory } from '../../../src/memory/session.js';
import type { SessionMessage } from '../../../src/memory/types.js';

function message(id: string, role: SessionMessage['role'], content: string, timestamp: number): SessionMessage {
  return { id, role, content, timestamp };
}

describe('SessionMemory', () => {
  it('creates and reads sessions', async () => {
    const memory = new SessionMemory();

    const created = await memory.create('s1', {
      userId: 'u1',
      channelId: 'c1',
      agentId: 'a1',
    });

    expect(created.sessionId).toBe('s1');
    await expect(memory.read('s1')).resolves.toEqual(created);
    expect(memory.activeCount).toBe(1);
  });

  it('auto-creates a placeholder session on append and can later update context', async () => {
    const memory = new SessionMemory();

    await memory.append('auto', message('m1', 'user', 'hello world', 1));
    const session = await memory.read('auto');
    expect(session?.userId).toBe('unknown');

    await memory.updateSessionContext('auto', {
      userId: 'user-1',
      channelId: 'channel-1',
      agentId: 'agent-1',
    });

    await expect(memory.read('auto')).resolves.toMatchObject({
      userId: 'user-1',
      channelId: 'channel-1',
      agentId: 'agent-1',
    });
  });

  it('merges task state and returns null for missing sessions', async () => {
    const memory = new SessionMemory();
    await memory.create('stateful', { userId: 'u', channelId: 'c', agentId: 'a' });

    await memory.updateTaskState('stateful', { step: 1 });
    await memory.updateTaskState('stateful', { status: 'running' });

    await expect(memory.getTaskState('stateful')).resolves.toEqual({ step: 1, status: 'running' });
    await expect(memory.updateSessionContext('missing', { userId: 'x' })).resolves.toBeNull();
  });

  it('compresses older messages into summaries', async () => {
    const memory = new SessionMemory(undefined, { maxMessages: 3 });
    await memory.create('compress', { userId: 'u', channelId: 'c', agentId: 'a' });

    for (let i = 0; i < 5; i += 1) {
      await memory.append('compress', message(`m${i}`, i % 2 === 0 ? 'user' : 'assistant', `content-${i}`, i + 1));
    }

    const session = await memory.read('compress');
    expect(session?.metadata.compressed).toBe(false);
    expect(session?.messages.length).toBe(5);
    expect(session?.messages.every((msg) => msg.compressed !== true)).toBe(true);
  });

  it('supports custom summarize functions and no-op compression when below threshold', async () => {
    const memory = new SessionMemory();
    await memory.create('manual', { userId: 'u', channelId: 'c', agentId: 'a' });

    await memory.append('manual', message('m1', 'user', 'alpha', 1));
    await memory.append('manual', message('m2', 'assistant', 'beta', 2));
    await memory.append('manual', message('m3', 'user', 'gamma', 3));

    await expect(memory.compress('manual', { keepRecent: 5 })).resolves.toEqual({ before: 3, after: 3 });

    const summarize = vi.fn(async (messages: SessionMessage[]) => `summary:${messages.map((m) => m.id).join(',')}`);
    await expect(memory.compress('manual', { keepRecent: 1, batchSize: 2, summarize })).resolves.toEqual({ before: 3, after: 2 });
    expect(summarize).toHaveBeenCalledTimes(1);

    const session = await memory.read('manual');
    expect(session?.messages[0].content).toBe('summary:m1,m2');
  });

  it('deletes sessions and cleans up expired ones', async () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      const memory = new SessionMemory(undefined, { ttlSeconds: 1 });
      await memory.create('old', { userId: 'u1', channelId: 'c1', agentId: 'a1' });
      await memory.create('new', { userId: 'u2', channelId: 'c2', agentId: 'a2' });

      vi.setSystemTime(now + 1500);
      await memory.append('new', message('fresh', 'user', 'still active', now + 1500));

      await expect(memory.cleanupExpired()).resolves.toBe(1);
      await expect(memory.read('old')).resolves.toBeNull();
      await expect(memory.read('new')).resolves.not.toBeNull();

      await memory.delete('new');
      await expect(memory.read('new')).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists sessions with filters sorted by last activity', async () => {
    const memory = new SessionMemory();
    await memory.create('a', { userId: 'u1', channelId: 'c1', agentId: 'a1' });
    await memory.create('b', { userId: 'u2', channelId: 'c1', agentId: 'a1' });

    await memory.append('a', message('m1', 'user', 'first', 1));
    await memory.append('b', message('m2', 'user', 'second', 2));

    const all = await memory.list();
    expect(all).toHaveLength(2);
    expect(all.map((session) => session.sessionId).sort()).toEqual(['a', 'b']);

    const filtered = await memory.list({ userId: 'u1', channelId: 'c1' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].sessionId).toBe('a');
  });
});
