/**
 * SkillRegistry —— 技能注册中心（增强版 v1.0.2）
 *
 * 对齐文档：docs/06-Tools工具与技能模块.md §5
 * 支持技能注册、查询、自动扫描加载，以及提示词注入。
 *
 * @module @myopenclaw/server/skills
 */

import { createLogger } from '../core/utils/logger.js';
import { SkillLoader } from './loader.js';
import type { Skill, SkillMeta } from './types.js';

const log = createLogger('skills:registry');

/**
 * SkillRegistry —— 技能注册中心
 *
 * 管理所有已注册的技能，支持加载、查询、匹配触发条件。
 */
export class SkillRegistry {
  private skills = new Map<string, Skill>();
  private loader: SkillLoader;

  constructor(loader?: SkillLoader) {
    this.loader = loader ?? new SkillLoader();
  }

  // ═════════════════════════════════════════════════════════════
  // 加载与注册
  // ═════════════════════════════════════════════════════════════

  /**
   * 注册一个技能
   *
   * @param skill 技能实例
   */
  register(skill: Skill): void {
    this.skills.set(skill.meta.name, skill);
    log.info({ name: skill.meta.name }, '技能已注册');
  }

  /**
   * 批量注册技能
   *
   * @param skills 技能列表
   */
  registerAll(skills: Skill[]): void {
    for (const skill of skills) {
      this.register(skill);
    }
  }

  /**
   * 从 skills/ 目录自动扫描并加载所有技能
   *
   * @param skillsDir skills 根目录路径
   * @returns 加载的技能数量
   */
  loadFromDirectory(skillsDir: string): number {
    const skills = this.loader.scanAndLoad(skillsDir);
    for (const skill of skills) {
      this.register(skill);
    }
    return skills.length;
  }

  /**
   * 注销一个技能
   *
   * @param name 技能名称
   * @returns 是否成功注销
   */
  unregister(name: string): boolean {
    const result = this.skills.delete(name);
    if (result) {
      log.info({ name }, '技能已注销');
    }
    return result;
  }

  // ═════════════════════════════════════════════════════════════
  // 查询接口
  // ═════════════════════════════════════════════════════════════

  /**
   * 获取所有已注册技能
   *
   * @returns 技能列表
   */
  listAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * 获取指定技能
   *
   * @param name 技能名称
   * @returns 技能实例，不存在返回 undefined
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * 根据触发关键词匹配相关技能
   *
   * 遍历所有技能，检查用户消息中的关键词是否命中技能的 triggers 配置。
   *
   * @param userMessage 用户输入的消息文本
   * @param maxMatches 最大匹配数量
   * @returns 匹配到的技能列表（按优先级排序）
   */
  matchByTriggers(userMessage: string, maxMatches = 3): Skill[] {
    const lowerMessage = userMessage.toLowerCase();
    const matched: Array<{ skill: Skill; score: number }> = [];

    for (const skill of this.skills.values()) {
      const triggers = skill.meta.triggers;
      if (!triggers || triggers.length === 0) continue;

      // 计算匹配分数
      let score = 0;
      for (const trigger of triggers) {
        if (lowerMessage.includes(trigger.toLowerCase())) {
          score += 1;
        }
      }

      if (score > 0) {
        // 优先级加权
        const priorityWeight = { low: 1, normal: 2, high: 3 };
        score *= priorityWeight[skill.meta.priority ?? 'normal'] ?? 2;
        matched.push({ skill, score });
      }
    }

    // 按分数降序排序
    matched.sort((a, b) => b.score - a.score);

    const result = matched.slice(0, maxMatches).map((m) => m.skill);
    if (result.length > 0) {
      log.info({ matched: result.map((s) => s.meta.name).join(', ') }, '技能触发匹配');
    }

    return result;
  }

  /**
   * 获取指定工具所依赖的所有技能
   *
   * @param toolName 工具名称
   * @returns 依赖该工具的技能列表
   */
  findByRequiredTool(toolName: string): Skill[] {
    const skills: Skill[] = [];
    for (const skill of this.skills.values()) {
      if (skill.meta.tools?.includes(toolName)) {
        skills.push(skill);
      }
    }
    return skills;
  }

  /**
   * 生成所有技能的 LLM 注入提示词
   *
   * 将已注册的技能转换为可注入 LLM 系统提示词的格式。
   *
   * @param userMessage 可选的用户消息，用于触发关键词匹配
   * @returns 技能提示词文本
   */
  buildPrompt(userMessage?: string): string {
    // 如果有用户消息，尝试匹配相关技能
    if (userMessage) {
      const matched = this.matchByTriggers(userMessage);
      if (matched.length > 0) {
        const lines: string[] = ['', '## 匹配到的技能说明', ''];
        for (const skill of matched) {
          const body = skill.body ?? skill.content;
          lines.push(`### ${skill.meta.name} - ${skill.meta.description}`);
          if (body) {
            // 截取前 1500 字作为提示
            const snippet = body.length > 1500
              ? body.substring(0, 1500) + '\n\n...（内容已截断，完整内容可查阅 SKILL.md）'
              : body;
            lines.push('');
            lines.push(snippet);
          }
          lines.push('');
        }
        return lines.join('\n');
      }
    }

    // 否则返回所有可用技能概要
    const all = this.listAll();
    if (all.length === 0) return '';

    const lines: string[] = ['', '## 可用技能', ''];
    for (const skill of all) {
      lines.push(`- **${skill.meta.name}**: ${skill.meta.description}`);
      if (skill.meta.triggers && skill.meta.triggers.length > 0) {
        lines.push(`  触发词：${skill.meta.triggers.join('、')}`);
      }
    }
    lines.push('');
    return lines.join('\n');
  }

  /**
   * 根据主动激活的技能名列表生成 LLM 注入提示词
   *
   * 与 buildPrompt 的区别：不依赖 triggers 关键词匹配，而是按用户
   * 在 Web 端技能面板中主动选择的技能名清单，直接注入完整技能说明。
   * 若某项技能名不存在，则跳过并记录日志。
   *
   * @param skillNames 主动激活的技能名列表（来自 Web 端技能面板）
   * @returns 技能提示词文本，若列表为空则返回空字符串
   */
  buildPromptFromActiveSkills(skillNames?: string[]): string {
    if (!skillNames || skillNames.length === 0) return '';

    const lines: string[] = ['', '## 用户主动激活的技能（优先使用）', ''];

    for (const name of skillNames) {
      const skill = this.get(name);
      if (!skill) {
        log.warn({ name }, '主动激活的技能在注册中心中未找到，跳过');
        continue;
      }

      const body = skill.body ?? skill.content;
      lines.push(`### ✅ ${skill.meta.name} — ${skill.meta.description}`);
      if (skill.meta.version) lines.push(`版本：${skill.meta.version}`);
      if (skill.meta.triggers && skill.meta.triggers.length > 0) {
        lines.push(`触发词：${skill.meta.triggers.join('、')}`);
      }
      if (skill.meta.tools && skill.meta.tools.length > 0) {
        lines.push(`依赖工具：${skill.meta.tools.join('、')}`);
      }
      if (body) {
        lines.push('');
        // 前 2000 字完整技能说明，确保 LLM 充分理解使用方式
        const snippet = body.length > 2000
          ? body.substring(0, 2000) + '\n\n...（内容已截断，参考技能完整定义）'
          : body;
        lines.push(snippet);
      }
      lines.push('');
    }

    // 若无任何可用技能，则不输出该段
    if (lines.length <= 2) return '';
    lines.push('> 说明：请优先依据上述「用户主动激活的技能」完成请求，必要时调用其依赖的工具。');
    lines.push('');
    return lines.join('\n');
  }

  // ═════════════════════════════════════════════════════════════
  // 工具方法
  // ═════════════════════════════════════════════════════════════

  /**
   * 获取已注册的技能数量
   */
  get count(): number {
    return this.skills.size;
  }

  /**
   * 检查技能是否已注册
   */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * 获取所有技能的元数据摘要
   */
  getMetaSummaries(): SkillMeta[] {
    return Array.from(this.skills.values()).map((s) => s.meta);
  }
}
