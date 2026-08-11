/**
 * PromptBuilder 单元测试
 */
import { describe, it, expect } from 'vitest';
import { PromptBuilder, createPromptBuilder } from '../../../src/agents/llm/prompt.js';

describe('agents/llm - PromptBuilder', () => {
  describe('默认构造', () => {
    it('应使用默认 Agent 名称', () => {
      const pb = new PromptBuilder();
      const prompt = pb.build();
      expect(prompt).toContain('MyOpenClaw Assistant');
    });

    it('应支持自定义默认名称', () => {
      const pb = new PromptBuilder({ defaultAgentName: 'TestBot' });
      const prompt = pb.build();
      expect(prompt).toContain('TestBot');
    });

    it('createPromptBuilder 工厂应工作', () => {
      const pb = createPromptBuilder('CodeBot');
      const prompt = pb.build();
      expect(prompt).toContain('CodeBot');
    });
  });

  describe('buildIdentitySection', () => {
    it('应包含 Agent 身份与角色', () => {
      const pb = new PromptBuilder();
      const section = pb.buildIdentitySection({
        agentName: 'X',
        agentRole: 'Y',
      });
      expect(section).toContain('你是 X');
      expect(section).toContain('Y');
    });

    it('应使用默认角色', () => {
      const pb = new PromptBuilder();
      const section = pb.buildIdentitySection({});
      expect(section).toContain('通用任务处理智能助手');
    });

    it('应支持自定义行为边界', () => {
      const pb = new PromptBuilder();
      const section = pb.buildIdentitySection({ behaviorBoundary: '只能回复你好' });
      expect(section).toContain('只能回复你好');
    });
  });

  describe('buildSkillsSection', () => {
    it('空技能时应显示提示', () => {
      const pb = new PromptBuilder();
      expect(pb.buildSkillsSection(undefined)).toContain('当前无可用 Skill');
      expect(pb.buildSkillsSection([])).toContain('当前无可用 Skill');
    });

    it('应列出所有技能', () => {
      const pb = new PromptBuilder();
      const section = pb.buildSkillsSection([
        { name: 'web-search', description: '搜索网页' },
        { name: 'daily-summary', description: '生成日报' },
      ]);
      expect(section).toContain('web-search');
      expect(section).toContain('搜索网页');
      expect(section).toContain('daily-summary');
    });
  });

  describe('buildToolsSection', () => {
    it('空工具时应显示提示', () => {
      const pb = new PromptBuilder();
      expect(pb.buildToolsSection(undefined)).toContain('当前无可用工具');
    });

    it('应列出所有工具并标记高危', () => {
      const pb = new PromptBuilder();
      const section = pb.buildToolsSection([
        { name: 'fs/read_file', description: '读取文件', parameters: {}, risk: 'low', builtin: true },
        { name: 'fs/delete', description: '删除文件', parameters: {}, risk: 'high', builtin: true },
      ]);
      expect(section).toContain('fs/read_file');
      expect(section).toContain('fs/delete');
      expect(section).toContain('⚠️ HIGH RISK');
    });
  });

  describe('buildOutputFormatSection', () => {
    it('应包含 thought / action / final_answer 三个标签说明', () => {
      const pb = new PromptBuilder();
      const section = pb.buildOutputFormatSection();
      expect(section).toContain('<thought>');
      expect(section).toContain('<action');
      expect(section).toContain('<final_answer>');
    });
  });

  describe('buildSafetySection', () => {
    it('应包含安全约束提示', () => {
      const pb = new PromptBuilder();
      const section = pb.buildSafetySection();
      expect(section).toContain('rm -rf /');
      expect(section).toContain('DROP TABLE');
    });
  });

  describe('build (完整组装)', () => {
    it('应包含所有段', () => {
      const pb = new PromptBuilder();
      const prompt = pb.build({
        agentName: 'A',
        tools: [{ name: 'fs/read', description: 'd', parameters: {}, risk: 'low', builtin: true }],
        skills: [{ name: 's', description: 'sd' }],
      });
      expect(prompt).toContain('## Agent 身份');
      expect(prompt).toContain('## 可用 Skills');
      expect(prompt).toContain('## 可用 Tools');
      expect(prompt).toContain('## 输出格式');
      expect(prompt).toContain('## 安全约束');
    });

    it('enableCoT=false 时应省略输出格式段', () => {
      const pb = new PromptBuilder();
      const prompt = pb.build({ enableCoT: false });
      expect(prompt).not.toContain('## 输出格式');
    });

    it('应附加会话上下文备注', () => {
      const pb = new PromptBuilder();
      const prompt = pb.build({ contextNote: '当前用户偏好中文回复' });
      expect(prompt).toContain('当前用户偏好中文回复');
    });
  });

  describe('toToolDefinitions 静态方法', () => {
    it('应将 ToolDescriptor 转为 ToolDefinition', () => {
      const defs = PromptBuilder.toToolDefinitions([
        { name: 'fs/read', description: 'd', parameters: { a: 1 }, risk: 'low', builtin: true },
        { name: 'fs/write', description: 'w', parameters: { b: 2 }, risk: 'high', builtin: false },
      ]);
      expect(defs).toHaveLength(2);
      expect(defs[0].name).toBe('fs/read');
      expect(defs[1].parameters).toEqual({ b: 2 });
    });
  });
});