/**
 * Skills 模块功能测试
 *
 * 测试 SkillLoader 的 YAML frontmatter 解析、目录扫描能力，
 * 以及 SkillRegistry 的注册、查询、触发匹配、提示词注入能力。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SkillLoader } from '../../../src/skills/loader.js';
import { SkillRegistry } from '../../../src/skills/registry.js';
import type { Skill } from '../../../src/skills/types.js';

// ═══════════════════════════════════════════════════════════════
describe('Skills 技能模块', () => {
  // ── SkillLoader ──

  describe('SkillLoader — YAML frontmatter 解析', () => {
    const loader = new SkillLoader();

    it('应从原始 SKILL.md 内容中正确解析 YAML frontmatter', () => {
      const md = [
        '---',
        'name: code-review',
        'description: 代码审查技能',
        'version: 1.0.0',
        'author: Test Team',
        'triggers:',
        '  - 代码审查',
        '  - code review',
        'tools:',
        '  - fs/read_file',
        '  - fs/list_dir',
        'priority: high',
        '---',
        '',
        '# 代码审查技能',
        '',
        '## 技能描述',
        '审查代码质量和安全性。',
      ].join('\n');

      // 通过 parseSkillMd (private) 测试，使用临时文件
      const fs = require('node:fs');
      const path = require('node:path');
      const os = require('node:os');
      const tmpFile = path.join(os.tmpdir(), `test-skill-${Date.now()}.md`);
      fs.writeFileSync(tmpFile, md);

      const skill = loader.loadSkill(tmpFile);
      fs.unlinkSync(tmpFile);

      expect(skill).not.toBeNull();
      expect(skill!.meta.name).toBe('code-review');
      expect(skill!.meta.description).toBe('代码审查技能');
      expect(skill!.meta.version).toBe('1.0.0');
      expect(skill!.meta.author).toBe('Test Team');
      expect(skill!.meta.triggers).toEqual(['代码审查', 'code review']);
      expect(skill!.meta.tools).toEqual(['fs/read_file', 'fs/list_dir']);
      expect(skill!.meta.priority).toBe('high');
      expect(skill!.body).toContain('# 代码审查技能');
      expect(skill!.body).toContain('审查代码质量和安全性。');
      expect(skill!.body).not.toContain('---');
    });

    it('无 YAML frontmatter 时应使用默认值和标题', () => {
      const fs = require('node:fs');
      const path = require('node:path');
      const os = require('node:os');
      const tmpFile = path.join(os.tmpdir(), `test-skill2-${Date.now()}.md`);
      fs.writeFileSync(tmpFile, '# 日报生成\n\n生成每日总结报告。');

      const skill = loader.loadSkill(tmpFile);
      fs.unlinkSync(tmpFile);

      expect(skill).not.toBeNull();
      expect(skill!.meta.name).toBe('日报生成');
      expect(skill!.meta.description).toBe('业务技能描述');
      expect(skill!.meta.version).toBe('1.0.0');
      expect(skill!.meta.triggers).toBeUndefined();
    });

    it('loadSkill 对不存在的文件应返回 null', () => {
      const skill = loader.loadSkill('/nonexistent/path/SKILL.md');
      expect(skill).toBeNull();
    });

    it('scanAndLoad 应扫描目录加载所有 SKILL.md', () => {
      const fs = require('node:fs');
      const path = require('node:path');
      const os = require('node:os');
      const skillsDir = path.join(os.tmpdir(), `test-skills-${Date.now()}`);
      fs.mkdirSync(path.join(skillsDir, 'skill-a'), { recursive: true });
      fs.mkdirSync(path.join(skillsDir, 'skill-b'), { recursive: true });
      fs.writeFileSync(path.join(skillsDir, 'skill-a', 'SKILL.md'), '---\nname: skill-a\ndescription: A 技能\nversion: 1.0.0\n---\n# Skill A');
      fs.writeFileSync(path.join(skillsDir, 'skill-b', 'SKILL.md'), '---\nname: skill-b\ndescription: B 技能\nversion: 1.0.0\n---\n# Skill B');

      const skills = loader.scanAndLoad(skillsDir);

      // 清理
      fs.rmSync(skillsDir, { recursive: true, force: true });

      expect(skills).toHaveLength(2);
      expect(skills.map((s) => s.meta.name)).toContain('skill-a');
      expect(skills.map((s) => s.meta.name)).toContain('skill-b');
    });
  });

  // ── SkillRegistry ──

  describe('SkillRegistry — 注册、查询、匹配', () => {
    let registry: SkillRegistry;

    beforeEach(() => {
      registry = new SkillRegistry();
    });

    it('应成功注册技能', () => {
      const skill = createTestSkill('test-skill');
      registry.register(skill);
      expect(registry.has('test-skill')).toBe(true);
      expect(registry.count).toBe(1);
    });

    it('应获取指定技能', () => {
      const skill = createTestSkill('get-me');
      registry.register(skill);
      expect(registry.get('get-me')).toBe(skill);
    });

    it('应列出所有技能', () => {
      registry.register(createTestSkill('a'));
      registry.register(createTestSkill('b'));
      expect(registry.listAll()).toHaveLength(2);
    });

    it('应注销技能', () => {
      registry.register(createTestSkill('rm-me'));
      expect(registry.unregister('rm-me')).toBe(true);
      expect(registry.has('rm-me')).toBe(false);
    });

    it('matchByTriggers 应根据关键词匹配', () => {
      registry.register(createTestSkill('code-review', {
        triggers: ['代码审查', 'code review'],
        priority: 'high',
      }));
      registry.register(createTestSkill('file-ops', {
        triggers: ['文件操作', '整理文件'],
        priority: 'normal',
      }));

      const matched = registry.matchByTriggers('帮我做一次代码审查');
      expect(matched).toHaveLength(1);
      expect(matched[0].meta.name).toBe('code-review');
    });

    it('matchByTriggers 应支持多关键词匹配并按优先级排序', () => {
      registry.register(createTestSkill('multi-match', {
        triggers: ['代码', '审查'],  // 匹配2个关键词
        priority: 'normal',          // 权重 2
      }));
      registry.register(createTestSkill('single-match', {
        triggers: ['审查'],          // 匹配1个关键词
        priority: 'high',            // 权重 3
      }));

      const matched = registry.matchByTriggers('帮我审查代码');
      expect(matched).toHaveLength(2);
      // multi-match: score = 2(matches) * 2(normal) = 4
      // single-match: score = 1(match) * 3(high) = 3
      // 所以 multi-match 应该排前面
      expect(matched[0].meta.name).toBe('multi-match');
      expect(matched[1].meta.name).toBe('single-match');
    });

    it('buildPrompt 应生成可用技能概要', () => {
      registry.register(createTestSkill('skill1'));
      registry.register(createTestSkill('skill2'));
      const prompt = registry.buildPrompt();
      expect(prompt).toContain('可用技能');
      expect(prompt).toContain('skill1');
      expect(prompt).toContain('skill2');
    });

    it('buildPrompt 带用户消息应匹配触发词并注入详情', () => {
      registry.register(createTestSkill('code-review', {
        triggers: ['审查'],
        description: '代码审查',
      }));
      const prompt = registry.buildPrompt('帮我审查代码');
      expect(prompt).toContain('匹配到的技能说明');
      expect(prompt).toContain('code-review');
    });

    it('findByRequiredTool 应找到依赖某工具的所有技能', () => {
      registry.register(createTestSkill('review', { tools: ['fs/read_file'] }));
      registry.register(createTestSkill('search', { tools: ['memory_search/search'] }));
      registry.register(createTestSkill('multi', { tools: ['fs/read_file', 'exec/shell'] }));

      const found = registry.findByRequiredTool('fs/read_file');
      expect(found).toHaveLength(2);
    });

    it('getMetaSummaries 应返回所有技能元数据', () => {
      registry.register(createTestSkill('a'));
      registry.register(createTestSkill('b'));
      const summaries = registry.getMetaSummaries();
      expect(summaries).toHaveLength(2);
      expect(summaries[0]).toHaveProperty('name');
      expect(summaries[0]).toHaveProperty('description');
    });
  });
});

// ── 辅助函数 ──

function createTestSkill(
  name: string,
  overrides: Partial<{
    triggers: string[];
    priority: string;
    description: string;
    tools: string[];
  }> = {},
): Skill {
  return {
    meta: {
      name,
      description: overrides.description ?? `${name} 描述`,
      version: '1.0.0',
      requires: [],
      author: 'Test',
      triggers: overrides.triggers,
      tools: overrides.tools,
      priority: overrides.priority as 'low' | 'normal' | 'high' | undefined,
    },
    content: `# ${name}\n\n描述内容。`,
    filePath: `/skills/${name}/SKILL.md`,
  };
}
