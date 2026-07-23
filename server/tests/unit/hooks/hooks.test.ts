/**
 * Hooks 模块单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { HookPipeline } from '../../../src/hooks/pipeline.js';
import type { Message } from '../../../src/core/types/index.js';

function makeMessage(overrides?: Partial<Message>): Message {
  return {
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    channelId: 'test',
    userId: 'u1',
    sessionId: 's1',
    type: 'text',
    role: 'user',
    content: 'hello',
    attachments: [],
    timestamp: Date.now(),
    metadata: {},
    ...overrides,
  };
}

describe('Hooks', () => {
  describe('HookPipeline', () => {
    let pipeline: HookPipeline;

    beforeEach(() => {
      pipeline = new HookPipeline();
    });

    it('应能注册并执行钩子', async () => {
      const calls: string[] = [];
      pipeline.register({
        name: 'test-hook',
        event: 'message.pre',
        priority: 50,
        handler: async (ctx) => {
          calls.push(ctx.event);
        },
      });

      const msg = makeMessage();
      await pipeline.execute('message.pre', { message: msg });
      expect(calls).toEqual(['message.pre']);
    });

    it('应按 priority 顺序执行', async () => {
      const order: number[] = [];
      pipeline.register({
        name: 'h1',
        event: 'message.pre',
        priority: 100,
        handler: () => { order.push(100); },
      });
      pipeline.register({
        name: 'h2',
        event: 'message.pre',
        priority: 10,
        handler: () => { order.push(10); },
      });
      pipeline.register({
        name: 'h3',
        event: 'message.pre',
        priority: 50,
        handler: () => { order.push(50); },
      });

      const msg = makeMessage();
      await pipeline.execute('message.pre', { message: msg });
      expect(order).toEqual([10, 50, 100]);
    });

    it('应跳过 disabled 的钩子', async () => {
      let called = false;
      pipeline.register({
        name: 'disabled-hook',
        event: 'message.pre',
        enabled: false,
        handler: () => { called = true; },
      });

      const msg = makeMessage();
      await pipeline.execute('message.pre', { message: msg });
      expect(called).toBe(false);
    });

    it('钩子抛错时默认不中断后续钩子（错误隔离）', async () => {
      const executed: string[] = [];
      pipeline.register({
        name: 'failing-hook',
        event: 'message.pre',
        handler: () => { throw new Error('expected fail'); },
      });
      pipeline.register({
        name: 'surviving-hook',
        event: 'message.pre',
        priority: 200,
        handler: () => { executed.push('survived'); },
      });

      const msg = makeMessage();
      await pipeline.execute('message.pre', { message: msg });
      expect(executed).toContain('survived');
    });

    it('abort 应中断后续钩子并抛出错误', async () => {
      const executed: string[] = [];
      pipeline.register({
        name: 'aborting-hook',
        event: 'message.pre',
        handler: (ctx) => {
          ctx.abort('测试中止');
        },
      });
      pipeline.register({
        name: 'should-not-run',
        event: 'message.pre',
        handler: () => { executed.push('should-not'); },
      });

      const msg = makeMessage();
      await expect(
        pipeline.execute('message.pre', { message: msg }),
      ).rejects.toThrow('Hook pipeline aborted');
      expect(executed).not.toContain('should-not');
    });

    it('mutate 应修改后续钩子可见的数据', async () => {
      let observed = '';
      pipeline.register({
        name: 'modifier',
        event: 'message.pre',
        priority: 10,
        handler: (ctx) => {
          ctx.mutate({ message: { ...ctx.data.message, content: 'modified' } });
        },
      });
      pipeline.register({
        name: 'observer',
        event: 'message.pre',
        priority: 20,
        handler: (ctx) => {
          observed = ctx.data.message.content;
        },
      });

      const msg = makeMessage({ content: 'original' });
      await pipeline.execute('message.pre', { message: msg });
      expect(observed).toBe('modified');
    });

    it('unregister 应移除已注册的钩子', async () => {
      let called = false;
      pipeline.register({
        name: 'to-remove',
        event: 'message.pre',
        handler: () => { called = true; },
      });
      pipeline.unregister('to-remove');

      const msg = makeMessage();
      await pipeline.execute('message.pre', { message: msg });
      expect(called).toBe(false);
    });

    it('execute 无钩子时应正常完成', async () => {
      const msg = makeMessage();
      await expect(
        pipeline.execute('message.pre', { message: msg }),
      ).resolves.toBeUndefined();
    });
  });
});
