/**
 * Planner 增强功能单元测试
 *
 * 覆盖 plan() 方法、多步 CoT 解析、安全校验、调度编排等完整功能。
 */
import { describe, it, expect } from 'vitest';
import { Planner } from '../../../src/agents/planner.js';
import type {
  PlannerContext,
  ToolDescriptor,
  UserPermissions,
} from '../../../src/agents/planner.js';

// ── 测试辅助函数 ──

/** 构建默认测试用的规划上下文 */
function makeContext(overrides: Partial<PlannerContext> = {}): PlannerContext {
  const defaultTools: ToolDescriptor[] = [
    { name: 'fs/read_file', description: '读取文件', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, risk: 'low', builtin: true },
    { name: 'fs/write_file', description: '写入文件', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }, risk: 'medium', builtin: true },
    { name: 'exec/shell', description: '执行命令', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }, risk: 'medium', builtin: true },
    { name: 'http/get', description: 'HTTP GET', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }, risk: 'low', builtin: true },
    { name: 'browser/navigate', description: '浏览器导航', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }, risk: 'low', builtin: true },
  ];

  const defaultPermissions: UserPermissions = {
    allowedCategories: ['fs', 'exec', 'http', 'browser'],
    maxAutoRisk: 'medium',
  };

  return {
    sessionId: 'test-session',
    availableTools: defaultTools,
    permissions: defaultPermissions,
    allowedPaths: ['/workspace', '/data'],
    ...overrides,
  };
}

describe('agents - Planner (增强功能)', () => {
  // ═════════════════════════════════════════════════════════════
  // 原有测试（保持兼容性）
  // ═════════════════════════════════════════════════════════════

  describe('isActionSafe (兼容旧接口)', () => {
    it('应允许普通工具调用', () => {
      const planner = new Planner();
      expect(planner.isActionSafe('fs/read_file')).toBe(true);
      expect(planner.isActionSafe('http/get')).toBe(true);
    });

    it('应拦截高危工具（默认黑名单）', () => {
      const planner = new Planner();
      expect(planner.isActionSafe('exec/root')).toBe(false);
      expect(planner.isActionSafe('fs/rm_rf')).toBe(false);
    });

    it('应支持自定义黑名单', () => {
      const planner = new Planner({ dangerousTools: ['custom/danger'] });
      expect(planner.isActionSafe('custom/danger')).toBe(false);
      expect(planner.isActionSafe('exec/root')).toBe(true);
    });
  });

  describe('validate (增强版)', () => {
    it('应通过普通子任务', () => {
      const planner = new Planner();
      const result = planner.validate({
        id: 't1', tool: 'fs/read_file', params: { path: '/tmp/a.txt' },
        dependsOn: [], description: '读取文件', risk: 'low',
      });
      expect(result.passed).toBe(true);
    });

    it('应拦截黑名单工具', () => {
      const planner = new Planner();
      const result = planner.validate({
        id: 't1', tool: 'fs/rm_rf', params: {},
        dependsOn: [], description: '递归删除', risk: 'high',
      });
      expect(result.passed).toBe(false);
      expect(result.ruleId).toBe('TOOL_BLACKLIST');
    });

    it('应拦截 rm -rf / 危险命令', () => {
      const planner = new Planner();
      const result = planner.validate({
        id: 't1', tool: 'exec/shell', params: { command: 'rm -rf / --no-preserve-root' },
        dependsOn: [], description: '危险命令', risk: 'high',
      });
      expect(result.passed).toBe(false);
      expect(result.ruleId).toBe('rm_rf_root');
    });

    it('应拦截 DROP TABLE 命令', () => {
      const planner = new Planner();
      const result = planner.validate({
        id: 't1', tool: 'exec/sql', params: { command: 'DROP TABLE users;' },
        dependsOn: [], description: '删表', risk: 'high',
      });
      expect(result.passed).toBe(false);
      expect(result.ruleId).toBe('drop_table');
    });

    it('应拦截非白名单路径的文件操作', () => {
      const planner = new Planner({ allowedPaths: ['/workspace'] });
      const result = planner.validate({
        id: 't1', tool: 'fs/write_file', params: { path: '/etc/passwd' },
        dependsOn: [], description: '写系统文件', risk: 'high',
      });
      expect(result.passed).toBe(false);
      expect(result.ruleId).toBe('PATH_WHITELIST');
    });

    it('应允许白名单内路径', () => {
      const planner = new Planner({ allowedPaths: ['/workspace', '/data'] });
      const result = planner.validate({
        id: 't1', tool: 'fs/write_file', params: { path: '/workspace/a.txt' },
        dependsOn: [], description: '写入工作目录', risk: 'low',
      });
      expect(result.passed).toBe(true);
    });

    it('未配置白名单时应跳过路径校验', () => {
      const planner = new Planner();
      const result = planner.validate({
        id: 't1', tool: 'fs/read_file', params: { path: '/anywhere' },
        dependsOn: [], description: '读取任意路径', risk: 'low',
      });
      expect(result.passed).toBe(true);
    });
  });

  describe('schedule (执行计划编排)', () => {
    it('空任务列表应返回空计划', () => {
      const planner = new Planner();
      const plan = planner.schedule([]);
      expect(plan.groups).toHaveLength(0);
    });

    it('无依赖任务应合并为并行组', () => {
      const planner = new Planner();
      const plan = planner.schedule([
        { id: 'a', tool: 'fs/read', params: {}, dependsOn: [], description: 'A', risk: 'low' },
        { id: 'b', tool: 'fs/read', params: {}, dependsOn: [], description: 'B', risk: 'low' },
      ]);
      expect(plan.groups).toHaveLength(1);
      expect(plan.groups[0].parallel).toBe(true);
      expect(plan.groups[0].tasks).toHaveLength(2);
    });

    it('有依赖任务应按顺序执行', () => {
      const planner = new Planner();
      const plan = planner.schedule([
        { id: 'a', tool: 'fs/read', params: {}, dependsOn: [], description: 'A', risk: 'low' },
        { id: 'b', tool: 'llm/summarize', params: {}, dependsOn: ['a'], description: 'B', risk: 'low' },
        { id: 'c', tool: 'fs/write', params: {}, dependsOn: ['b'], description: 'C', risk: 'low' },
      ]);
      expect(plan.groups.length).toBeGreaterThanOrEqual(2);
      const allIds = plan.groups.flatMap((g) => g.tasks.map((t) => t.id));
      expect(allIds).toEqual(['a', 'b', 'c']);
    });

    it('独立任务与依赖任务应分到不同 group', () => {
      const planner = new Planner();
      const plan = planner.schedule([
        { id: 'a', tool: 'fs/read', params: {}, dependsOn: [], description: 'A', risk: 'low' },
        { id: 'b', tool: 'fs/read', params: {}, dependsOn: [], description: 'B', risk: 'low' },
        { id: 'c', tool: 'fs/write', params: {}, dependsOn: ['a'], description: 'C', risk: 'low' },
      ]);
      expect(plan.groups.length).toBe(2);
      expect(plan.groups[0].tasks.map((t) => t.id).sort()).toEqual(['a', 'b']);
      expect(plan.groups[1].tasks.map((t) => t.id)).toEqual(['c']);
    });
  });

  describe('parseCoT', () => {
    it('应正确提取 thought / action / final_answer', () => {
      const planner = new Planner();
      const output = `
        <thought>用户想读取文件</thought>
        <action name="fs/read_file" args='{"path":"/tmp/a"}'/>
        <final_answer>读取完成</final_answer>
      `;
      const parsed = planner.parseCoT(output);
      expect(parsed.thought).toContain('用户想读取文件');
      expect(parsed.action).toContain('fs/read_file');
      expect(parsed.finalAnswer).toBe('读取完成');
    });

    it('缺失标签时应返回 undefined', () => {
      const planner = new Planner();
      const parsed = planner.parseCoT('直接回复用户');
      expect(parsed.thought).toBeUndefined();
      expect(parsed.action).toBeUndefined();
      expect(parsed.finalAnswer).toBeUndefined();
    });
  });

  // ═════════════════════════════════════════════════════════════
  // 新增增强功能测试
  // ═════════════════════════════════════════════════════════════

  describe('parseCoT - 多步 action 提取', () => {
    it('应提取多个自闭合 action 标签', () => {
      const planner = new Planner();
      const output = `
        <thought>需要先读取再写入</thought>
        <action name="fs/read_file" args='{"path":"/work/input.txt"}' />
        <action name="fs/write_file" args='{"path":"/work/output.txt","content":"processed"}' />
        <final_answer>处理完成</final_answer>
      `;
      const parsed = planner.parseCoT(output);
      expect(parsed.actionSteps).toHaveLength(2);
      expect(parsed.actionSteps[0].tool).toBe('fs/read_file');
      expect(parsed.actionSteps[0].args).toEqual({ path: '/work/input.txt' });
      expect(parsed.actionSteps[1].tool).toBe('fs/write_file');
      expect(parsed.actionSteps[1].args).toEqual({ path: '/work/output.txt', content: 'processed' });
    });

    it('应正确解析配对 action 标签', () => {
      const planner = new Planner();
      const output = `
        <action name="fs/read_file" args='{"path":"/data/report.md"}'>读取报告文件</action>
      `;
      const parsed = planner.parseCoT(output);
      expect(parsed.actionSteps).toHaveLength(1);
      expect(parsed.actionSteps[0].tool).toBe('fs/read_file');
      expect(parsed.actionSteps[0].description).toBe('读取报告文件');
    });

    it('应提取 action 中的 description 属性', () => {
      const planner = new Planner();
      const output = `
        <action name="http/get" args='{"url":"https://api.example.com"}' description="获取API数据" />
      `;
      const parsed = planner.parseCoT(output);
      expect(parsed.actionSteps).toHaveLength(1);
      expect(parsed.actionSteps[0].description).toBe('获取API数据');
    });

    it('应处理空 action 列表', () => {
      const planner = new Planner();
      const parsed = planner.parseCoT('只有文字回复');
      expect(parsed.actionSteps).toHaveLength(0);
    });

    it('应处理格式不完整的 JSON 参数', () => {
      // v1.0.3 行为变更:JSON 解析失败时,该 action step 直接跳过(避免把原始字符串塞给工具)
      // 旧行为 (v1.0.2 之前) 是 { _raw: '...' },已废弃
      const planner = new Planner();
      const output = `<action name="fs/read_file" args='not-json' />`;
      const parsed = planner.parseCoT(output);
      expect(parsed.actionSteps).toHaveLength(0);
    });
  });

  describe('plan() - 完整规划流程', () => {
    it('应将时间问题直接路由到 system/time', async () => {
      const planner = new Planner();
      const ctx = makeContext({
        availableTools: [
          ...makeContext().availableTools,
          {
            name: 'system/time',
            description: '获取当前时间',
            parameters: { type: 'object', properties: {} },
            risk: 'low',
            builtin: true,
          },
        ],
      });
      const tasks = await planner.plan('用户问：现在几点？', ctx);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].tool).toBe('system/time');
      expect(tasks[0].params).toEqual({});
    });

    it('纯文本回复时应返回空任务列表', async () => {
      const planner = new Planner();
      const ctx = makeContext();
      const tasks = await planner.plan('<thought>理解了</thought><final_answer>你好！</final_answer>', ctx);
      expect(tasks).toHaveLength(0);
    });

    it('单个工具调用应生成一个子任务', async () => {
      const planner = new Planner();
      const ctx = makeContext();
      const output = `
        <thought>用户想读取文件</thought>
        <action name="fs/read_file" args='{"path":"/workspace/readme.md"}' />
        <final_answer>完成</final_answer>
      `;
      const tasks = await planner.plan(output, ctx);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].tool).toBe('fs/read_file');
      expect(tasks[0].params).toEqual({ path: '/workspace/readme.md' });
      expect(tasks[0].risk).toBe('low');
    });

    it('多个工具调用应生成带依赖的子任务列表', async () => {
      const planner = new Planner();
      const ctx = makeContext();
      const output = `
        <thought>需要读取文件、提取信息、写入结果</thought>
        <action name="fs/read_file" args='{"path":"/workspace/input.txt"}' />
        <action name="fs/write_file" args='{"path":"/workspace/output.txt","content":"result"}' />
      `;
      const tasks = await planner.plan(output, ctx);
      expect(tasks.length).toBeGreaterThanOrEqual(2);
      // 第二个任务应依赖第一个任务
      expect(tasks[1].dependsOn).toContain(tasks[0].id);
    });

    it('危险工具应被安全校验拦截', async () => {
      const planner = new Planner();
      const ctx = makeContext({
        availableTools: [
          { name: 'fs/rm_rf', description: '危险删除', parameters: {}, risk: 'high', builtin: true },
        ],
      });
      const output = `<action name="fs/rm_rf" args='{"path":"/"}' />`;
      const tasks = await planner.plan(output, ctx);
      // 黑名单工具应被拦截
      expect(tasks.filter((t) => t.tool === 'fs/rm_rf')).toHaveLength(0);
    });

    it('白名单外的路径文件操作应被拦截', async () => {
      const planner = new Planner({ allowedPaths: ['/workspace'] });
      const ctx = makeContext({ allowedPaths: ['/workspace'] });
      const output = `<action name="fs/write_file" args='{"path":"/etc/hosts","content":"evil"}' />`;
      const tasks = await planner.plan(output, ctx);
      expect(tasks).toHaveLength(0);
    });

    it('应正确为用户权限高的操作标记 requiresConfirmation', async () => {
      const planner = new Planner();
      const ctx = makeContext({
        permissions: { allowedCategories: ['fs'], maxAutoRisk: 'low' },
      });
      // fs/write_file 是 medium 风险，但用户 maxAutoRisk 是 low
      const output = `<action name="fs/write_file" args='{"path":"/workspace/output.txt","content":"data"}' />`;
      const tasks = await planner.plan(output, ctx);
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks[0].requiresConfirmation).toBe(true);
    });
  });

  describe('allowedPaths getter', () => {
    it('应返回配置的路径白名单', () => {
      const planner = new Planner({ allowedPaths: ['/work', '/data'] });
      expect(planner.allowedPaths).toEqual(['/work', '/data']);
    });

    it('默认应返回空数组', () => {
      const planner = new Planner();
      expect(planner.allowedPaths).toEqual([]);
    });
  });

  describe('buildToolDescriptors', () => {
    it('应将工具列表转换为描述符列表', () => {
      const descriptors = Planner.buildToolDescriptors([
        { name: 'fs/read_file', description: '读文件', category: 'fs', inputSchema: { type: 'object' } },
        { name: 'exec/shell', description: '执行命令', category: 'exec', inputSchema: { type: 'object' } },
      ]);
      expect(descriptors).toHaveLength(2);
      expect(descriptors[0].name).toBe('fs/read_file');
      expect(descriptors[0].risk).toBe('low');
      expect(descriptors[1].name).toBe('exec/shell');
      expect(descriptors[1].risk).toBe('medium');
    });
  });
});
