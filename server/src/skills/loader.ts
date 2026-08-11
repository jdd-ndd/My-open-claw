/**
 * SkillLoader —— SKILL.md 加载器（增强版 v1.0.2）
 *
 * 扫描 skills/ 目录，解析 SKILL.md 文件，提取 YAML frontmatter 与 Markdown 正文内容。
 *
 * @module @myopenclaw/server/skills
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { createLogger } from '../core/utils/logger.js';
import type { Skill, SkillMeta } from './types.js';

const log = createLogger('skills:loader');

/**
 * SkillLoader —— 技能加载器
 *
 * 负责从文件系统加载 SKILL.md 文件，解析技能元数据和描述内容。
 */
export class SkillLoader {
  /**
   * 从单个 SKILL.md 文件路径加载
   *
   * @param filePath SKILL.md 文件的绝对路径
   * @returns 技能实例，加载失败返回 null
   */
  loadSkill(filePath: string): Skill | null {
    if (!existsSync(filePath)) {
      log.warn({ filePath }, 'SKILL.md 文件不存在');
      return null;
    }

    try {
      const raw = readFileSync(filePath, 'utf-8');
      return this.parseSkillMd(filePath, raw);
    } catch (err) {
      log.error({ filePath, err: (err as Error).message }, 'SKILL.md 加载失败');
      return null;
    }
  }

  /**
   * 从 skills/ 目录批量扫描并加载所有 SKILL.md
   *
   * 遍历 skillsDir 下的所有子目录，加载其中的 SKILL.md 文件。
   *
   * @param skillsDir skills 根目录路径
   * @returns 技能列表
   */
  scanAndLoad(skillsDir: string): Skill[] {
    const skills: Skill[] = [];

    if (!existsSync(skillsDir)) {
      log.warn({ skillsDir }, 'Skills 目录不存在，跳过扫描');
      return skills;
    }

    try {
      const entries = readdirSync(skillsDir);

      for (const entry of entries) {
        // 跳过隐藏文件和 examples 示例目录
        if (entry.startsWith('.')) continue;

        const fullPath = resolve(skillsDir, entry);
        let stat: ReturnType<typeof statSync>;
        try {
          stat = statSync(fullPath);
        } catch {
          continue;
        }

        if (stat.isDirectory()) {
          // 尝试查找 SKILL.md
          const skillMdPath = resolve(fullPath, 'SKILL.md');
          if (existsSync(skillMdPath)) {
            const skill = this.loadSkill(skillMdPath);
            if (skill) {
              skills.push(skill);
              log.info({ name: skill.meta.name, path: skillMdPath }, '技能加载成功');
            }
          }
        }
      }

      log.info({ count: skills.length }, 'Skills 扫描完成');
    } catch (err) {
      log.error({ skillsDir, err: (err as Error).message }, 'Skills 扫描失败');
    }

    return skills;
  }

  /**
   * 解析 SKILL.md 内容
   *
   * 提取 YAML frontmatter（--- 分隔符间的内容）和 Markdown 正文。
   */
  private parseSkillMd(filePath: string, raw: string): Skill {
    const meta = this.extractMeta(raw, basename(filePath));
    const body = this.extractBody(raw);

    return {
      meta,
      content: raw,
      filePath,
      body,
    };
  }

  /**
   * 提取 YAML frontmatter 元数据
   *
   * 解析 --- 分隔的 YAML 块中的键值对。
   */
  private extractMeta(raw: string, fallbackName: string): SkillMeta {
    const yamlBlock = this.extractYamlBlock(raw);
    const yamlName = this.extractYamlValue(yamlBlock, 'name');
    const skillName = yamlName ?? fallbackName;

    const meta: SkillMeta = {
      name: skillName,
      description: this.extractYamlValue(yamlBlock, 'description') ?? '业务技能描述',
      version: this.extractYamlValue(yamlBlock, 'version') ?? '1.0.0',
      requires: this.extractYamlList(yamlBlock, 'requires') ?? [],
      author: this.extractYamlValue(yamlBlock, 'author') ?? undefined,
      triggers: this.extractYamlList(yamlBlock, 'triggers') ?? undefined,
      tools: this.extractYamlList(yamlBlock, 'tools') ?? undefined,
      priority: this.extractYamlValue(yamlBlock, 'priority') as 'low' | 'normal' | 'high' | undefined,
    };

    // 如果没有 YAML frontmatter，从标题提取 name
    if (!yamlBlock && meta.name === fallbackName) {
      const titleMatch = raw.match(/^#\s+(.+)$/m);
      if (titleMatch) {
        return {
          ...meta,
          name: titleMatch[1].trim(),
        };
      }
    }

    return meta;
  }

  /**
   * 提取 Markdown 正文（不含 frontmatter）
   */
  private extractBody(raw: string): string {
    const yamlEndIndex = raw.indexOf('---', 3);
    if (raw.startsWith('---') && yamlEndIndex > 0) {
      return raw.substring(yamlEndIndex + 3).trim();
    }
    return raw;
  }

  /**
   * 提取 YAML frontmatter 块
   */
  private extractYamlBlock(raw: string): string {
    if (!raw.startsWith('---')) return '';

    const endIndex = raw.indexOf('---', 3);
    if (endIndex < 0) return '';

    return raw.substring(3, endIndex).trim();
  }

  /**
   * 从 YAML 块中提取单个键值
   *
   * 支持格式：key: value（允许 key 前有可选的缩进空白）
   */
  private extractYamlValue(yamlBlock: string, key: string): string | null {
    if (!yamlBlock) return null;

    // 转义 key 中的正则特殊字符，防止注入风险
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // 允许 key 前有可选空白（兼容缩进写法），m 标志使 ^ 匹配每行开头
    const regex = new RegExp(`^\\s*${escapedKey}\\s*:\\s*(.+)$`, 'm');
    const match = yamlBlock.match(regex);
    if (!match) return null;

    // 去除首尾空白和引号
    return match[1].trim().replace(/^["']|["']$/g, '');
  }

  /**
   * 从 YAML 块中提取列表值（逐行解析，健壮可靠）
   *
   * 支持格式：
   *   key:
   *     - item1
   *     - item2
   *
   * 与正则方案不同，逐行解析不受 multiline 模式下 $ 锚点
   * 和惰性量词交互的影响，能够正确捕获所有列表项。
   */
  private extractYamlList(yamlBlock: string, key: string): string[] | null {
    if (!yamlBlock) return null;

    const lines = yamlBlock.split('\n');
    const items: string[] = [];
    let inTargetList = false;

    // 转义 key 中的正则特殊字符
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // 逐行遍历 YAML 块
    for (const line of lines) {
      // 步骤1：检测列表声明行（如 "triggers:" 独占一行）
      if (line.match(new RegExp(`^\\s*${escapedKey}\\s*:\\s*$`))) {
        inTargetList = true;
        continue;
      }

      // 步骤2：在目标列表中解析列表项
      if (inTargetList) {
        const itemMatch = line.match(/^\s*-\s+(.+?)\s*$/);
        if (itemMatch) {
          // 提取列表项内容，去除引号
          items.push(itemMatch[1].trim().replace(/^["']|["']$/g, ''));
        } else {
          // 非列表项行：空行或注释行跳过继续，其他行表示列表结束
          const trimmed = line.trim();
          if (trimmed !== '' && !trimmed.startsWith('#')) {
            break;
          }
        }
      }
    }

    return items.length > 0 ? items : null;
  }
}
