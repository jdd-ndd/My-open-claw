/**
 * 技能相关类型定义
 *
 * @module @myopenclaw/server/skills
 */

/** 技能元数据 */
export interface SkillMeta {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly requires: string[];
}

/** 技能实例 */
export interface Skill {
  readonly meta: SkillMeta;
  readonly content: string;
  readonly filePath: string;
}
