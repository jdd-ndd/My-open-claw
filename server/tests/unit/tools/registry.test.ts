/**
 * ToolRegistry 单元测试（对齐文档 §3）
 *
 * 测试工具注册中心的注册、查询、调用、批量执行、事件监听全部功能。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../../../src/tools/registry.js';
import type { Tool, ToolResult, InvokeContext, JSONSchema } from '../../../src/core/types/index.js';

// ── 测试用工具工厂 ──

/** 创建测试工具 */
function createTestTool(
  name: string,
  overrides: Partial<Tool> = {},
): Tool {
  return {
    name,
    description: `${name} 工具描述`,
    category: 'test',
    risk: 'low',
    builtin: false,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
      },
      required: ['path'],
    },
    async execute(_params: Record<string, unknown>, _ctx: InvokeContext): Promise<ToolResult> {
      return { success: true, status: 'success', data: `executed: ${name}` };
    },
    ...overrides,
  };
}

/** 测试用调用上下文 */
const testContext: InvokeContext = {
  sessionId: 'test-session',
  userId: 'test-user',
  channelId: 'test-channel',
};

// ═══════════════════════════════════════════════════════════════
describe('ToolRegistry 工具注册中心', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  // ── 注册与注销 ──

  describe('register — 注册工具', () => {
    it('应成功注册一个工具', async () => {
      const tool = createTestTool('test/hello');
      const result = await registry.register(tool);
      expect(result).toBe(true);
      expect(registry.has('test/hello')).toBe(true);
      expect(registry.count).toBe(1);
    });

    it('重复注册同名工具应抛出错误', async () => {
      const tool = createTestTool('test/dup');
      await registry.register(tool);
      await expect(registry.register(tool)).rejects.toThrow('已注册');
    });

    it('force 模式应允许覆盖同名工具', async () => {
      const tool1 = createTestTool('test/override', { risk: 'low' });
      const tool2 = createTestTool('test/override', { risk: 'high' });
      await registry.register(tool1);
      await registry.register(tool2, { force: true });
      expect(registry.get('test/override')?.risk).toBe('high');
    });

    it('builtin 标记应正确设置', async () => {
      const tool = createTestTool('test/builtin');
      await registry.register(tool, { builtin: true });
      const desc = registry.getDescriptor('test/builtin');
      expect(desc?.builtin).toBe(true);
    });
  });

  describe('unregister — 注销工具', () => {
    it('应成功注销一个非内置工具', async () => {
      const tool = createTestTool('test/tmp');
      await registry.register(tool);
      const result = await registry.unregister('test/tmp');
      expect(result).toBe(true);
      expect(registry.has('test/tmp')).toBe(false);
    });

    it('不应允许注销内置工具', async () => {
      const tool = createTestTool('test/builtin');
      await registry.register(tool, { builtin: true });
      const result = await registry.unregister('test/builtin');
      expect(result).toBe(false);
      expect(registry.has('test/builtin')).toBe(true);
    });

    it('注销不存在的工具应返回 false', async () => {
      const result = await registry.unregister('nonexistent/tool');
      expect(result).toBe(false);
    });
  });

  // ── 查询 ──

  describe('list — 列出工具', () => {
    it('空 registry 应返回空列表', () => {
      expect(registry.listAll()).toHaveLength(0);
    });

    it('应正确返回所有已注册工具', async () => {
      await registry.register(createTestTool('test/a'));
      await registry.register(createTestTool('test/b'));
      await registry.register(createTestTool('exec/c'));
      expect(registry.listAll()).toHaveLength(3);
    });

    it('应按命名空间过滤工具', async () => {
      await registry.register(createTestTool('test/a'));
      await registry.register(createTestTool('test/b'));
      await registry.register(createTestTool('exec/c'));
      const filtered = registry.listAll({ namespace: 'test' });
      expect(filtered).toHaveLength(2);
      expect(filtered.every((t) => t.name.startsWith('test/'))).toBe(true);
    });

    it('应按风险等级过滤工具', async () => {
      await registry.register(createTestTool('test/low', { risk: 'low' }));
      await registry.register(createTestTool('test/high', { risk: 'high' }));
      const filtered = registry.listAll({ risk: 'high' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('test/high');
    });

    it('应按分类过滤工具', async () => {
      await registry.register(createTestTool('test/a', { category: 'fs' }));
      await registry.register(createTestTool('test/b', { category: 'exec' }));
      const filtered = registry.listAll({ category: 'fs' });
      expect(filtered).toHaveLength(1);
    });

    it('list 方法应返回 ToolDescriptor 列表', async () => {
      await registry.register(createTestTool('test/desc'));
      const descriptors = registry.list();
      expect(descriptors).toHaveLength(1);
      expect(descriptors[0].name).toBe('test/desc');
      expect(descriptors[0].parameters).toBeDefined();
    });
  });

  describe('get / getDescriptor — 获取工具信息', () => {
    it('get 应返回工具实例', async () => {
      const tool = createTestTool('test/get');
      await registry.register(tool);
      expect(registry.get('test/get')).toBe(tool);
    });

    it('get 对不存在的工具应返回 undefined', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('getDescriptor 应返回包含元信息的描述符', async () => {
      const tool = createTestTool('test/desc', { risk: 'medium' });
      await registry.register(tool, { builtin: true });
      const desc = registry.getDescriptor('test/desc');
      expect(desc).toBeDefined();
      expect(desc?.name).toBe('test/desc');
      expect(desc?.risk).toBe('medium');
      expect(desc?.builtin).toBe(true);
    });
  });

  // ── 调用工具 ──

  describe('invoke — 调用工具', () => {
    it('应成功调用已注册的工具', async () => {
      await registry.register(createTestTool('test/invoke'));
      const result = await registry.invoke('test/invoke', { path: '/test' }, testContext);
      expect(result.success).toBe(true);
      expect(result.data).toBe('executed: test/invoke');
    });

    it('调用未注册工具应返回错误', async () => {
      const result = await registry.invoke('nonexistent/tool', {}, testContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('未注册');
    });

    it('调用缺少必填参数的工具应返回校验错误', async () => {
      await registry.register(createTestTool('test/validate'));
      const result = await registry.invoke('test/validate', {}, testContext);
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('200001');
    });

    it('execute 方法（兼容旧接口）应正常工作', async () => {
      await registry.register(createTestTool('test/legacy'));
      const result = await registry.execute('test/legacy', { path: '/old' }, {
        sessionId: 's',
        userId: 'u',
        channelId: 'c',
        config: {},
      });
      expect(result.success).toBe(true);
    });

    it('工具执行失败应返回错误', async () => {
      await registry.register(createTestTool('test/fail', {
        async execute(): Promise<ToolResult> {
          throw new Error('模拟执行失败');
        },
      }));
      const result = await registry.invoke('test/fail', { path: '/x' }, testContext);
      expect(result.success).toBe(false);
      expect(result.status).toBe('error');
    });
  });

  describe('invokeBatch — 批量并行调用', () => {
    it('应并行调用多个工具', async () => {
      await registry.register(createTestTool('test/a'));
      await registry.register(createTestTool('test/b'));
      await registry.register(createTestTool('test/c'));
      const results = await registry.invokeBatch([
        { name: 'test/a', params: { path: '/a' } },
        { name: 'test/b', params: { path: '/b' } },
        { name: 'test/c', params: { path: '/c' } },
      ], testContext);
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it('部分工具失败不影响其他工具', async () => {
      await registry.register(createTestTool('test/good'));
      await registry.register(createTestTool('test/bad', {
        async execute(): Promise<ToolResult> {
          throw new Error('失败');
        },
      }));
      const results = await registry.invokeBatch([
        { name: 'test/good', params: { path: '/' } },
        { name: 'test/bad', params: { path: '/' } },
      ], testContext);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
    });
  });

  // ── 事件监听 ──

  describe('onChange — 注册中心变更监听', () => {
    it('注册工具时应触发 register 事件', async () => {
      const events: Array<{ type: string; toolName: string }> = [];
      const unsub = registry.onChange((e) => events.push(e));
      await registry.register(createTestTool('test/event'));
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('register');
      expect(events[0].toolName).toBe('test/event');
      unsub();
    });

    it('注销工具时应触发 unregister 事件', async () => {
      const tool = createTestTool('test/unreg');
      await registry.register(tool);
      const events: Array<{ type: string; toolName: string }> = [];
      const unsub = registry.onChange((e) => events.push(e));
      await registry.unregister('test/unreg');
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('unregister');
      unsub();
    });

    it('取消监听后不再收到事件', async () => {
      let count = 0;
      const unsub = registry.onChange(() => count++);
      unsub();
      await registry.register(createTestTool('test/nolisten'));
      expect(count).toBe(0);
    });
  });

  // ── 工具方法 ──

  describe('工具方法', () => {
    it('count 应返回正确的工具数量', async () => {
      expect(registry.count).toBe(0);
      await registry.register(createTestTool('test/1'));
      await registry.register(createTestTool('test/2'));
      expect(registry.count).toBe(2);
    });

    it('getCategoryStats 应返回分类统计', async () => {
      await registry.register(createTestTool('a/a', { category: 'fs' }));
      await registry.register(createTestTool('b/b', { category: 'fs' }));
      await registry.register(createTestTool('c/c', { category: 'exec' }));
      const stats = registry.getCategoryStats();
      expect(stats.fs).toBe(2);
      expect(stats.exec).toBe(1);
    });

    it('clearNonBuiltin 应只清除非内置工具', async () => {
      await registry.register(createTestTool('test/clear1'), { builtin: true });
      await registry.register(createTestTool('test/clear2'));
      registry.clearNonBuiltin();
      expect(registry.has('test/clear1')).toBe(true);
      expect(registry.has('test/clear2')).toBe(false);
    });

    it('registerAll 应批量注册工具', async () => {
      const tools = [
        createTestTool('batch/1'),
        createTestTool('batch/2'),
        createTestTool('batch/3'),
      ];
      await registry.registerAll(tools);
      expect(registry.count).toBe(3);
    });
  });
});
