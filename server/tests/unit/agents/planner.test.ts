/**
 * Planner 单元测试
 */
import { describe, it, expect } from 'vitest';
import { Planner } from '../../../src/agents/planner.js';

describe('agents - Planner', () => {
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
      // 默认黑名单被覆盖，所以 exec/root 不再被拦截
      expect(planner.isActionSafe('exec/root')).toBe(true);
    });
  });

  describe('validate (增强版)', () => {
    it('应通过普通子任务', () => {
      const planner = new Planner();
      const result = planner.validate({
        id: 't1',
        tool: 'fs/read_file',
        params: { path: '/tmp/a.txt' },
        dependsOn: [],
        description: '读取文件',
        risk: 'low',
      });
      expect(result.passed).toBe(true);
    });

    it('应拦截黑名单工具', () => {
      const planner = new Planner();
      const result = planner.validate({
        id: 't1',
        tool: 'fs/rm_rf',
        params: {},
        dependsOn: [],
        description: '递归删除',
        risk: 'high',
      });
      expect(result.passed).toBe(false);
      expect(result.ruleId).toBe('TOOL_BLACKLIST');
    });

    it('应拦截 rm -rf / 危险命令', () => {
      const planner = new Planner();
      const result = planner.validate({
        id: 't1',
        tool: 'exec/shell',
        params: { command: 'rm -rf / --no-preserve-root' },
        dependsOn: [],
        description: '危险命令',
        risk: 'high',
      });
      expect(result.passed).toBe(false);
      expect(result.ruleId).toBe('rm_rf_root');
    });

    it('应拦截 DROP TABLE 命令', () => {
      const planner = new Planner();
      const result = planner.validate({
        id: 't1',
        tool: 'exec/sql',
        params: { command: 'DROP TABLE users;' },
        dependsOn: [],
        description: '删表',
        risk: 'high',
      });
      expect(result.passed).toBe(false);
      expect(result.ruleId).toBe('drop_table');
    });

    it('应拦截非白名单路径的文件操作', () => {
      const planner = new Planner({ allowedPaths: ['/workspace'] });
      const result = planner.validate({
        id: 't1',
        tool: 'fs/write_file',
        params: { path: '/etc/passwd' },
        dependsOn: [],
        description: '写系统文件',
        risk: 'high',
      });
      expect(result.passed).toBe(false);
      expect(result.ruleId).toBe('PATH_WHITELIST');
    });

    it('应允许白名单内路径', () => {
      const planner = new Planner({ allowedPaths: ['/workspace', '/data'] });
      const result = planner.validate({
        id: 't1',
        tool: 'fs/write_file',
        params: { path: '/workspace/a.txt' },
        dependsOn: [],
        description: '写入工作目录',
        risk: 'low',
      });
      expect(result.passed).toBe(true);
    });

    it('未配置白名单时应跳过路径校验', () => {
      const planner = new Planner();
      const result = planner.validate({
        id: 't1',
        tool: 'fs/read_file',
        params: { path: '/anywhere' },
        dependsOn: [],
        description: '读取任意路径',
        risk: 'low',
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
      // 第一个 group 包含 a（独立）；后续 group 包含 b、c
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
      // 第一组：a + b（并行）
      expect(plan.groups[0].tasks.map((t) => t.id).sort()).toEqual(['a', 'b']);
      // 第二组：c
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
    it('parses escaped action args generated by XML-ish model output', () => {
      const planner = new Planner();
      const output = `<action name="exec/shell" args='{"command":"powershell -Command \\"$desktop = [Environment]::GetFolderPath('Desktop'); New-Item -Path $desktop -Name test.md -ItemType File -Force\\""}' />`; 
      const parsed = planner.parseCoT(output);
      expect(parsed.actionSteps).toHaveLength(1);
      expect(parsed.actionSteps[0].tool).toBe('exec/shell');
      expect(parsed.actionSteps[0].args.command).toContain('New-Item');
    });
  });
});
