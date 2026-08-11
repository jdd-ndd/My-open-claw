/**
 * Skills 类型定义（增强版 v1.0.2）
 *
 * 对齐文档：docs/06-Tools工具与技能模块.md §5
 * 支持 YAML frontmatter 元数据解析。
 *
 * @module @myopenclaw/server/skills
 */

/** 技能元数据 */
export interface SkillMeta {
  /** 技能名称（唯一标识） */
  readonly name: string;
  /** 技能简述 */
  readonly description: string;
  /** 技能版本 */
  readonly version: string;
  /** 依赖的工具列表 */
  readonly requires: string[];
  /** 作者 */
  readonly author?: string;
  /** 触发关键词列表 */
  readonly triggers?: string[];
  /** 此技能需要用到的工具列表 */
  readonly tools?: string[];
  /** 优先级：low/normal/high */
  readonly priority?: 'low' | 'normal' | 'high';
}

/** 技能实例 */
export interface Skill {
  /** 技能元数据 */
  readonly meta: SkillMeta;
  /** SKILL.md 完整内容（用于注入 LLM 提示词） */
  readonly content: string;
  /** 文件路径 */
  readonly filePath: string;
  /** 正文内容（不含 frontmatter） */
  readonly body?: string;
}

/**
 * 生成 Skill 注入 LLM 的提示词文本
 *
 * @param skill 技能实例
 * @returns 格式化的提示词片段
 */
export function skillToPrompt(skill: Skill): string {
  const lines: string[] = [];
  lines.push(`### ${skill.meta.name}`);
  lines.push(`描述：${skill.meta.description}`);

  if (skill.meta.triggers && skill.meta.triggers.length > 0) {
    lines.push(`触发词：${skill.meta.triggers.join('、')}`);
  }
  if (skill.meta.priority) {
    lines.push(`优先级：${skill.meta.priority}`);
  }

  // 使用 body 或 content（去除 frontmatter）
  const body = skill.body ?? skill.content;
  if (body) {
    lines.push('');
    lines.push(body);
  }

  return lines.join('\n');
}

/**
 * 生成所有技能注入 LLM 的提示词文本
 *
 * @param skills 技能列表
 * @returns 完整的技能提示词块
 */
export function skillsToPrompt(skills: Skill[]): string {
  if (skills.length === 0) return '';

  const lines: string[] = ['## 可用技能', ''];
  for (const skill of skills) {
    lines.push(`### ${skill.meta.name}`);
    lines.push(`描述：${skill.meta.description}`);
    if (skill.meta.triggers && skill.meta.triggers.length > 0) {
      lines.push(`触发条件：${skill.meta.triggers.join('、')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
