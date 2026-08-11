/**
 * tools 命令实现
 *
 * 工具管理命令，查看和调用 Agent 可用的外部工具。
 * 提供以下子操作：
 * - list: 列出所有可用工具
 * - info: 查看工具详情
 * - execute: 直接执行工具（演示用途，实际执行需通过 chat 流程）
 *
 * 数据来源：通过 HTTP API /api/tools 从 Gateway 拉取真实工具清单。
 * 当 Gateway 不可用时，给出明确的连接错误提示。
 *
 * @module cli/commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import { createGatewayClient, getTools, isGatewayApiError } from '../api/client.js';
import { OutputFormatter } from '../utils/output.js';
import { ExitCode, handleErrorAndExit, createOperationError } from '../utils/errors.js';
import type { MyOpenClawConfig } from '../config/schema.js';

/**
 * Tools 命令操作类型
 */
type ToolsAction = 'list' | 'info' | 'execute';

/**
 * Tools 命令选项
 */
interface ToolsCommandOptions {
  /** 执行参数（JSON 字符串） */
  args?: string;
}

/**
 * 全局选项
 */
interface GlobalOptions {
  /** Gateway HTTP 地址 */
  gateway?: string;
  /** 是否使用 JSON 输出 */
  json?: boolean;
  /** 是否显示详细日志 */
  verbose?: boolean;
}

/**
 * 工具信息（来自 /api/tools 响应）
 */
interface ToolInfo {
  /** 工具名（如 fs/read_file） */
  name: string;
  /** 工具描述 */
  description: string;
  /** 工具分类（如 fs、exec、http） */
  category: string;
  /** 风险等级（low / medium / high） */
  risk: 'low' | 'medium' | 'high';
  /** 是否为内置工具 */
  builtin: boolean;
  /** 参数 Schema（JSON Schema 格式） */
  parameters: Record<string, unknown>;
}

/**
 * /api/tools 响应数据结构
 */
interface ToolsApiResponse {
  total: number;
  tools: ToolInfo[];
  /** Gateway 未注入 runtimeAdapter 时的提示 */
  note?: string;
}

/**
 * 创建 tools 子命令
 *
 * @param config - 加载的配置对象
 * @returns Commander Command 实例
 */
export function createToolsCommand(config: MyOpenClawConfig): Command {
  const command = new Command('tools')
    .description('工具管理')
    .alias('tool')
    .argument('[action]', '操作类型: list, info, execute', 'list')
    .argument('[name]', '工具名称（info/execute 时使用）')
    .option('--args <json>', '执行参数（JSON 格式）')
    .action(async (action: ToolsAction, name: string | undefined, options: ToolsCommandOptions, command: Command) => {
      const globalOpts = command.parent?.opts() as GlobalOptions || {};
      const formatter = new OutputFormatter(globalOpts.json ? 'json' : 'text');

      const client = createGatewayClient({
        baseURL: globalOpts.gateway || config.gateway.url,
        verbose: globalOpts.verbose,
      });

      try {
        await handleToolsAction(action, name, options, client, formatter, globalOpts);
      } catch (error) {
        console.error(createOperationError(`工具 ${action}`, error));
        handleErrorAndExit(error, globalOpts.verbose);
      }
    });

  return command;
}

/**
 * 处理工具操作
 */
async function handleToolsAction(
  action: ToolsAction,
  name: string | undefined,
  options: ToolsCommandOptions,
  client: ReturnType<typeof createGatewayClient>,
  formatter: OutputFormatter,
  globalOpts: GlobalOptions
): Promise<void> {
  switch (action) {
    case 'list':
      await listTools(client, formatter, globalOpts);
      break;
    case 'info':
      await showToolInfo(name, client, formatter);
      break;
    case 'execute':
      await executeTool(name, options, client, formatter);
      break;
    default:
      console.log(chalk.red(`未知操作: ${action}`));
      console.log('可用操作: list, info, execute');
      process.exit(ExitCode.USAGE_ERROR);
  }
}

/**
 * 列出所有可用工具（通过 HTTP API 从 Gateway 拉取）
 */
async function listTools(
  client: ReturnType<typeof createGatewayClient>,
  formatter: OutputFormatter,
  globalOpts: GlobalOptions
): Promise<void> {
  const spinner = ora('正在从 Gateway 获取工具列表...').start();

  let data: ToolsApiResponse;
  try {
    data = await getTools<ToolsApiResponse>(client);
  } catch (error) {
    spinner.fail('获取工具列表失败');
    if (isGatewayApiError(error)) {
      throw new Error(`Gateway 错误: ${error.message}（code: ${error.code}）`);
    }
    throw error;
  }

  spinner.succeed(`已加载 ${data.total} 个工具`);

  // JSON 输出模式
  if (formatter.format === 'json') {
    formatter.print({
      total: data.total,
      tools: data.tools.map(t => ({
        name: t.name,
        description: t.description,
        category: t.category,
        risk: t.risk,
        builtin: t.builtin,
      })),
      ...(data.note ? { note: data.note } : {}),
    });
    return;
  }

  // 文本输出模式
  console.log(chalk.bold('可用工具列表'));
  console.log(chalk.gray(`共 ${data.total} 个工具`));
  if (data.note) {
    console.log(chalk.yellow('⚠'), chalk.gray(data.note));
  }
  console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  if (data.tools.length === 0) {
    console.log(chalk.gray('（暂无可用工具）'));
    return;
  }

  const table = new Table({
    head: ['工具名称', '分类', '风险', '描述'].map(h => chalk.cyan(h)),
    colWidths: [25, 12, 8, 45],
    wordWrap: true,
  });

  data.tools.forEach((tool) => {
    // 风险等级用不同颜色标识
    const riskColor = tool.risk === 'high' ? chalk.red
      : tool.risk === 'medium' ? chalk.yellow
      : chalk.green;
    table.push([
      tool.name,
      tool.category,
      riskColor(tool.risk),
      tool.description,
    ] as (string | number | boolean | null | undefined)[]);
  });

  console.log(table.toString());
  console.log();
  console.log(chalk.gray('提示: 使用 "tools info <name>" 查看工具详细参数'));

  // 静默使用 globalOpts 避免 TS 未使用警告
  void globalOpts;
}

/**
 * 查看工具详情
 */
async function showToolInfo(
  name: string | undefined,
  client: ReturnType<typeof createGatewayClient>,
  formatter: OutputFormatter
): Promise<void> {
  if (!name) {
    throw new Error('请提供工具名称，如: tools info fs/read_file');
  }

  const spinner = ora('正在获取工具详情...').start();

  let data: ToolsApiResponse;
  try {
    data = await getTools<ToolsApiResponse>(client);
  } catch (error) {
    spinner.fail('获取工具列表失败');
    if (isGatewayApiError(error)) {
      throw new Error(`Gateway 错误: ${error.message}（code: ${error.code}）`);
    }
    throw error;
  }

  // 大小写不敏感匹配工具名
  const tool = data.tools.find(
    t => t.name === name || t.name.toLowerCase() === name.toLowerCase()
  );

  if (!tool) {
    spinner.fail(`工具 "${name}" 不存在`);
    if (formatter.format === 'json') {
      formatter.print({ success: false, error: `工具 "${name}" 不存在` });
    } else {
      console.log(chalk.gray('可用工具:'), data.tools.map(t => t.name).join(', '));
    }
    process.exit(ExitCode.USAGE_ERROR);
  }

  spinner.succeed(`已找到工具: ${tool.name}`);

  // JSON 输出模式
  if (formatter.format === 'json') {
    formatter.print(tool);
    return;
  }

  // 文本输出模式
  console.log(chalk.bold(`工具: ${tool.name}`));
  console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan('  描述:'), tool.description);
  console.log(chalk.cyan('  分类:'), tool.category);
  console.log(chalk.cyan('  风险:'), tool.risk);
  console.log(chalk.cyan('  内置:'), tool.builtin ? '是' : '否');
  console.log();

  // 显示参数 schema
  const params = tool.parameters;
  const paramProperties = (params?.properties as Record<string, { type?: string; description?: string }> | undefined);
  if (paramProperties && Object.keys(paramProperties).length > 0) {
    console.log(chalk.bold('  参数:'));
    const paramTable = new Table({
      head: ['参数名', '类型', '必填', '描述'].map(h => chalk.cyan(h)),
      colWidths: [16, 12, 8, 40],
      wordWrap: true,
    });

    const requiredList = params?.required as string[] | undefined;
    for (const [paramName, paramInfo] of Object.entries(paramProperties)) {
      const isRequired = requiredList?.includes(paramName) ?? false;
      paramTable.push([
        paramName,
        paramInfo?.type ?? 'any',
        isRequired ? chalk.red('是') : chalk.gray('否'),
        paramInfo?.description ?? '',
      ] as (string | number | boolean | null | undefined)[]);
    }
    console.log(paramTable.toString());
  } else {
    console.log(chalk.gray('  （此工具无参数）'));
  }
}

/**
 * 执行工具
 *
 * 注意：当前 Gateway 未提供 /api/tools/execute 端点（工具执行需通过 chat 流程触发）。
 * 此命令会先验证工具是否存在，然后给出引导提示。
 */
async function executeTool(
  name: string | undefined,
  options: ToolsCommandOptions,
  client: ReturnType<typeof createGatewayClient>,
  formatter: OutputFormatter
): Promise<void> {
  if (!name) {
    throw new Error('请提供工具名称，如: tools execute fs/read_file');
  }

  // 先验证工具是否真实存在
  const spinner = ora('正在校验工具...').start();

  let data: ToolsApiResponse;
  try {
    data = await getTools<ToolsApiResponse>(client);
  } catch (error) {
    spinner.fail('获取工具列表失败');
    if (isGatewayApiError(error)) {
      throw new Error(`Gateway 错误: ${error.message}（code: ${error.code}）`);
    }
    throw error;
  }

  const tool = data.tools.find(
    t => t.name === name || t.name.toLowerCase() === name.toLowerCase()
  );

  if (!tool) {
    spinner.fail(`工具 "${name}" 不存在`);
    throw new Error(`工具 "${name}" 不存在`);
  }

  // 解析执行参数
  let args: Record<string, unknown> = {};
  if (options.args) {
    try {
      args = JSON.parse(options.args);
    } catch {
      throw new Error('参数必须是有效的 JSON 字符串');
    }
  }

  spinner.warn(`工具 ${name} 已校验通过，但 Gateway 暂未开放直接执行端点`);

  // JSON 输出模式
  if (formatter.format === 'json') {
    formatter.print({
      success: false,
      tool: name,
      arguments: args,
      message: 'Gateway 暂未提供 /api/tools/execute 端点，工具执行需通过 chat 流程触发',
      hint: '使用 "myopenclaw chat" 进入对话模式，由 Agent 自动调用此工具',
    });
    return;
  }

  // 文本输出模式
  console.log(chalk.green('✓'), `工具 ${name} 已校验通过`);
  console.log(chalk.cyan('  参数:'), JSON.stringify(args, null, 2));
  console.log();
  console.log(chalk.yellow('⚠'), 'Gateway 暂未开放直接工具执行端点');
  console.log(chalk.gray('  工具执行需通过 chat 流程触发，由 Agent 根据用户意图自动调用。'));
  console.log(chalk.gray('  推荐方式:'));
  console.log(chalk.gray('    myopenclaw chat'));
  console.log(chalk.gray(`    然后在对话中描述需要使用 ${name} 工具完成的任务`));
}
