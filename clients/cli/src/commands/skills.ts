/**
 * skills 命令实现
 *
 * 技能管理命令，查看和使用预定义的技能（Skill）模板。
 * 技能是可复用的 AI Agent 行为模板，可以快速启动特定场景的对话。
 * 提供以下子操作：
 * - list: 列出所有可用技能
 * - info: 查看技能详情
 * - use: 使用技能进入对话
 *
 * 数据来源：通过 HTTP API /api/skills 从 Gateway 拉取真实技能清单。
 * 当 Gateway 不可用时，给出明确的连接错误提示。
 *
 * @module cli/commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import { randomUUID } from 'node:crypto';
import { createGatewayClient, getSkills, isGatewayApiError } from '../api/client.js';
import { OutputFormatter } from '../utils/output.js';
import { ExitCode, handleErrorAndExit, createOperationError } from '../utils/errors.js';
import type { MyOpenClawConfig } from '../config/schema.js';

/**
 * Skills 命令操作类型
 */
type SkillsAction = 'list' | 'info' | 'use';

/**
 * Skills 命令选项
 */
interface SkillsCommandOptions {
  /** 关联文件 */
  file?: string;
}

/**
 * 全局选项
 */
interface GlobalOptions {
  /** Gateway HTTP 地址 */
  gateway?: string;
  /** Gateway WebSocket 地址 */
  websocket?: string;
  /** 是否使用 JSON 输出 */
  json?: boolean;
  /** 是否显示详细日志 */
  verbose?: boolean;
}

/**
 * 技能信息（来自 /api/skills 响应）
 */
interface SkillInfo {
  /** 技能名（唯一标识） */
  name: string;
  /** 技能简述 */
  description: string;
  /** 技能版本 */
  version: string;
  /** 作者 */
  author?: string;
  /** 触发关键词列表 */
  triggers: string[];
  /** 此技能需要用到的工具列表 */
  tools: string[];
  /** 依赖的工具列表 */
  requires: string[];
  /** 优先级：low/normal/high */
  priority: 'low' | 'normal' | 'high';
  /** SKILL.md 文件路径 */
  filePath: string;
}

/**
 * /api/skills 响应数据结构
 */
interface SkillsApiResponse {
  total: number;
  skills: SkillInfo[];
  /** Gateway 未注入 runtimeAdapter 时的提示 */
  note?: string;
}

/**
 * 创建 skills 子命令
 *
 * @param config - 加载的配置对象
 * @returns Commander Command 实例
 */
export function createSkillsCommand(config: MyOpenClawConfig): Command {
  const command = new Command('skills')
    .description('技能管理')
    .alias('skill')
    .argument('[action]', '操作类型: list, info, use', 'list')
    .argument('[name]', '技能名称（info/use 时使用）')
    .option('-f, --file <path>', '关联文件路径')
    .action(async (action: SkillsAction, name: string | undefined, options: SkillsCommandOptions, command: Command) => {
      const globalOpts = command.parent?.opts() as GlobalOptions || {};
      const formatter = new OutputFormatter(globalOpts.json ? 'json' : 'text');

      const client = createGatewayClient({
        baseURL: globalOpts.gateway || config.gateway.url,
        verbose: globalOpts.verbose,
      });

      try {
        await handleSkillsAction(action, name, options, client, formatter, globalOpts, config);
      } catch (error) {
        console.error(createOperationError(`技能 ${action}`, error));
        handleErrorAndExit(error, globalOpts.verbose);
      }
    });

  return command;
}

/**
 * 处理技能操作
 */
async function handleSkillsAction(
  action: SkillsAction,
  name: string | undefined,
  options: SkillsCommandOptions,
  client: ReturnType<typeof createGatewayClient>,
  formatter: OutputFormatter,
  globalOpts: GlobalOptions,
  config: MyOpenClawConfig
): Promise<void> {
  switch (action) {
    case 'list':
      await listSkills(client, formatter);
      break;
    case 'info':
      await showSkillInfo(name, client, formatter);
      break;
    case 'use':
      await useSkill(name, options, client, formatter, globalOpts, config);
      break;
    default:
      console.log(chalk.red(`未知操作: ${action}`));
      console.log('可用操作: list, info, use');
      process.exit(ExitCode.USAGE_ERROR);
  }
}

/**
 * 列出所有可用技能（通过 HTTP API 从 Gateway 拉取）
 */
async function listSkills(
  client: ReturnType<typeof createGatewayClient>,
  formatter: OutputFormatter
): Promise<void> {
  const spinner = ora('正在从 Gateway 获取技能列表...').start();

  let data: SkillsApiResponse;
  try {
    data = await getSkills<SkillsApiResponse>(client);
  } catch (error) {
    spinner.fail('获取技能列表失败');
    if (isGatewayApiError(error)) {
      throw new Error(`Gateway 错误: ${error.message}（code: ${error.code}）`);
    }
    throw error;
  }

  spinner.succeed(`已加载 ${data.total} 个技能`);

  // JSON 输出模式
  if (formatter.format === 'json') {
    formatter.print({
      total: data.total,
      skills: data.skills.map(s => ({
        name: s.name,
        description: s.description,
        version: s.version,
        priority: s.priority,
        triggers: s.triggers,
      })),
      ...(data.note ? { note: data.note } : {}),
    });
    return;
  }

  // 文本输出模式
  console.log(chalk.bold('可用技能列表'));
  console.log(chalk.gray(`共 ${data.total} 个技能`));
  if (data.note) {
    console.log(chalk.yellow('⚠'), chalk.gray(data.note));
  }
  console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  if (data.skills.length === 0) {
    console.log(chalk.gray('（暂无可用技能）'));
    return;
  }

  const table = new Table({
    head: ['技能名称', '描述', '优先级', '版本'].map(h => chalk.cyan(h)),
    colWidths: [22, 45, 10, 10],
    wordWrap: true,
  });

  data.skills.forEach((skill) => {
    // 优先级用不同颜色标识
    const priorityColor = skill.priority === 'high' ? chalk.red
      : skill.priority === 'normal' ? chalk.yellow
      : chalk.gray;
    table.push([
      skill.name,
      skill.description,
      priorityColor(skill.priority),
      skill.version,
    ] as (string | number | boolean | null | undefined)[]);
  });

  console.log(table.toString());
  console.log();
  console.log(chalk.gray('提示:'));
  console.log(chalk.gray('  使用 "skills info <name>" 查看技能详情'));
  console.log(chalk.gray('  使用 "skills use <name>" 使用技能进入对话'));
}

/**
 * 查看技能详情
 */
async function showSkillInfo(
  name: string | undefined,
  client: ReturnType<typeof createGatewayClient>,
  formatter: OutputFormatter
): Promise<void> {
  if (!name) {
    throw new Error('请提供技能名称，如: skills info code-review');
  }

  const spinner = ora('正在获取技能详情...').start();

  let data: SkillsApiResponse;
  try {
    data = await getSkills<SkillsApiResponse>(client);
  } catch (error) {
    spinner.fail('获取技能列表失败');
    if (isGatewayApiError(error)) {
      throw new Error(`Gateway 错误: ${error.message}（code: ${error.code}）`);
    }
    throw error;
  }

  // 大小写不敏感匹配技能名
  const skill = data.skills.find(
    s => s.name === name || s.name.toLowerCase() === name.toLowerCase()
  );

  if (!skill) {
    spinner.fail(`技能 "${name}" 不存在`);
    if (formatter.format === 'json') {
      formatter.print({ success: false, error: `技能 "${name}" 不存在` });
    } else {
      console.log(chalk.gray('可用技能:'), data.skills.map(s => s.name).join(', '));
    }
    process.exit(ExitCode.USAGE_ERROR);
  }

  spinner.succeed(`已找到技能: ${skill.name}`);

  // JSON 输出模式
  if (formatter.format === 'json') {
    formatter.print(skill);
    return;
  }

  // 文本输出模式
  console.log(chalk.bold(`技能: ${skill.name}`));
  console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan('  描述:'), skill.description);
  console.log(chalk.cyan('  版本:'), skill.version);
  if (skill.author) {
    console.log(chalk.cyan('  作者:'), skill.author);
  }
  console.log(chalk.cyan('  优先级:'), skill.priority);
  console.log(chalk.cyan('  文件:'), skill.filePath);

  if (skill.triggers.length > 0) {
    console.log();
    console.log(chalk.bold('  触发关键词:'));
    skill.triggers.forEach((trigger) => {
      console.log(chalk.gray('    -'), trigger);
    });
  }

  if (skill.tools.length > 0) {
    console.log();
    console.log(chalk.bold('  使用工具:'));
    skill.tools.forEach((tool) => {
      console.log(chalk.gray('    -'), tool);
    });
  }

  if (skill.requires.length > 0) {
    console.log();
    console.log(chalk.bold('  依赖:'));
    skill.requires.forEach((req) => {
      console.log(chalk.gray('    -'), req);
    });
  }

  console.log();
  console.log(chalk.gray('使用方法:'));
  console.log(chalk.gray('  skills use <name>         使用技能进入交互对话'));
  console.log(chalk.gray('  skills use <name> --file <path>  附带文件使用技能'));
}

/**
 * 使用技能进入对话
 */
async function useSkill(
  name: string | undefined,
  options: SkillsCommandOptions,
  client: ReturnType<typeof createGatewayClient>,
  formatter: OutputFormatter,
  _globalOpts: GlobalOptions,
  config: MyOpenClawConfig
): Promise<void> {
  if (!name) {
    throw new Error('请提供技能名称，如: skills use code-review');
  }

  // 先获取真实技能列表，校验技能是否存在
  const spinner = ora('正在校验技能...').start();

  let data: SkillsApiResponse;
  try {
    data = await getSkills<SkillsApiResponse>(client);
  } catch (error) {
    spinner.fail('获取技能列表失败');
    if (isGatewayApiError(error)) {
      throw new Error(`Gateway 错误: ${error.message}（code: ${error.code}）`);
    }
    throw error;
  }

  const skill = data.skills.find(
    s => s.name === name || s.name.toLowerCase() === name.toLowerCase()
  );

  if (!skill) {
    spinner.fail(`技能 "${name}" 不存在`);
    throw new Error(`技能 "${name}" 不存在`);
  }

  spinner.succeed(`技能 ${skill.name} 已启动`);

  // 生成技能启动消息
  const sessionId = 'skill-' + randomUUID().replace(/-/g, '').slice(0, 12);
  const startupMessage = `[技能: ${skill.name}]\n${skill.description}\n\n请执行此技能的相关任务。`;

  // JSON 输出模式
  if (formatter.format === 'json') {
    formatter.print({
      success: true,
      skill: skill.name,
      sessionId,
      message: startupMessage,
      file: options.file || null,
    });
    return;
  }

  // 文本输出模式：显示技能启动信息
  console.log();
  console.log(chalk.bold(`🎯 技能: ${skill.name}`));
  console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan('  描述:'), skill.description);
  console.log(chalk.cyan('  会话:'), sessionId);

  if (options.file) {
    console.log(chalk.cyan('  关联文件:'), options.file);
  }

  console.log();
  console.log(chalk.yellow('⚠'), '技能使用功能需要结合 chat 命令使用');
  console.log(chalk.gray('  推荐使用方式:'));
  console.log(chalk.gray(`    myopenclaw chat -s ${sessionId}`));
  console.log(chalk.gray(`    然后在对话中发送: ${startupMessage.slice(0, 50)}...`));
  console.log();

  // 尝试自动进入 chat 模式
  console.log(chalk.gray('自动启动对话模式...'));
  console.log();

  // 导入并启动 chat 命令
  try {
    const { createChatCommand } = await import('./chat.js');
    const chatCommand = createChatCommand(config);
    chatCommand.parse([], { from: 'user' });
  } catch {
    console.log(chalk.gray('请手动启动: myopenclaw chat'));
  }
}
