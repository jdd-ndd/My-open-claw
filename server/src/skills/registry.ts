/**
 * SkillRegistry �?技能注册中�? *
 * @module @myopenclaw/server/skills
 */

import { createLogger } from '../core/utils/logger.js';
import type { Skill } from './types.js';

const log = createLogger('skills:registry');

export class SkillRegistry {
  private skills = new Map<string, Skill>();

  /** 注册技�?*/
  register(skill: Skill): void {
    this.skills.set(skill.meta.name, skill);
    log.info({ name: skill.meta.name }, '技能已注册');
  }

  /** 获取所有已注册技�?*/
  listAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /** 获取指定技�?*/
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }
}
