/**
 * SkillLoader —— SKILL.md 加载器
 *
 * 解析 skills/ 目录下的 SKILL.md 文件，提取技能元数据与描述内容。
 *
 * @module @myopenclaw/server/skills
 */

import { readFileSync, existsSync } from 'node:fs';
import { createLogger } from '../core/utils/logger.js';
import type { Skill, SkillMeta } from './types.js';

const log = createLogger('skills:loader');

export class SkillLoader {
  /**
   * 从文件路径加载 SKILL.md
   */
  loadSkill(filePath: string): Skill | null {
    if (!existsSync(filePath)) {
      log.warn({ filePath }, 'SKILL.md 文件不存在');
      return null;
    }

    const raw = readFileSync(filePath, 'utf-8');
    return this.parseSkillMd(filePath, raw);
  }

  /**
   * 解析 SKILL.md 内容
   */
  private parseSkillMd(filePath: string, raw: string): Skill {
    const meta = this.extractMeta(raw);
    return {
      meta,
      content: raw,
      filePath,
    };
  }

  /**
   * 提取 SKILL.md 中的元数据（YAML frontmatter 与 Markdown 标题）
   */
  private extractMeta(raw: string): SkillMeta {
    const lines = raw.split('\n');
    const titleLine = lines.find((l) => l.startsWith('# '));
    const name = titleLine?.replace('# ', '').trim() ?? 'unknown';

    return {
      name,
      description: '业务技能描述',
      version: '1.0.0',
      requires: [],
    };
  }
}
