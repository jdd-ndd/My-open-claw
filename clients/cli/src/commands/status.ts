/**
 * status 命令实现
 *
 * 系统状态查询命令，获取 Gateway 和 Agent 的运行状态。
 * 通过 HTTP API 与 Gateway 交互，提供：
 * - 单次查询当前状态
 * - 持续监视模式（--watch）
 * - 支持 JSON 输出
 *
 * @module cli/commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import { createGatewayClient, getSystemStatus, getAgents, GatewayApiError } from '../api/client.js';
import { OutputFormatter } from '../utils/output.js';
import { ExitCode, handleErrorAndExit } from '../utils/errors.js';
import type { MyOpenClawConfig } from '../config/schema.js';
import type { SystemStatus, AgentStatus } from '../api/types.js';

/**
 * Status 命令选项
 */
interface StatusCommandOptions {
  /** 持续监视模式 */
  watch?: boolean;
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
 * 创建 status 子命令
 *
 * @param config - 加载的配置对象
 * @returns Commander Command 实例
 */
export function createStatusCommand(config: MyOpenClawConfig): Command {
  const command = new Command('status')
    .description('系统状态查询')
    .alias('st')
    .option('-w, --watch', '持续监视模式（每 5 秒刷新）')
    .action(async (options: StatusCommandOptions, command: Command) => {
      const globalOpts = command.parent?.opts() as GlobalOptions || {};
      const formatter = new OutputFormatter(globalOpts.json ? 'json' : 'text');

      try {
        if (options.watch) {
          await runWatchMode(globalOpts, config, formatter);
        } else {
          await runStatusCheck(globalOpts, config, formatter);
        }
      } catch (error) {
        if (error instanceof GatewayApiError) {
          console.error(chalk.red('Gateway 连接错误:'), error.message);
          console.log(chalk.gray('请检查 Gateway 服务是否启动'));
          process.exit(ExitCode.GATEWAY_UNREACHABLE);
        }
        handleErrorAndExit(error, globalOpts.verbose);
      }
    });

  return command;
}

/**
 * 执行单次状态检查
 */
async function runStatusCheck(
  globalOpts: GlobalOptions,
  config: MyOpenClawConfig,
  formatter: OutputFormatter
): Promise<void> {
  const client = createGatewayClient({
    baseURL: globalOpts.gateway || config.gateway.url,
    verbose: globalOpts.verbose,
  });

  const spinner = ora('正在获取系统状态...').start();

  try {
    // 并行获取状态和 Agent 列表
    const [statusData, agentsData] = await Promise.allSettled([
      getSystemStatus<SystemStatus>(client),
      getAgents<{ agents: AgentStatus[] }>(client),
    ]);

    spinner.stop();

    // 处理结果
    const status = statusData.status === 'fulfilled' ? statusData.value : null;
    const agents = agentsData.status === 'fulfilled' ? agentsData.value : null;

    if (formatter.format === 'json') {
      formatter.print({
        status,
        agents,
        error: statusData.status === 'rejected' ? (statusData.reason as Error).message : undefined,
      });
      return;
    }

    // 渲染状态显示
    renderStatusDisplay(status, agents);
  } catch (error) {
    spinner.fail('获取状态失败');
    throw error;
  }
}

/**
 * 持续监视模式
 */
async function runWatchMode(
  globalOpts: GlobalOptions,
  config: MyOpenClawConfig,
  formatter: OutputFormatter
): Promise<void> {
  console.log(chalk.bold('📊 MyOpenClaw 系统状态监视'));
  console.log(chalk.gray('  按 Ctrl+C 退出监视模式'));
  console.log();

  // 捕获 Ctrl+C
  process.on('SIGINT', () => {
    console.log(chalk.gray('\n👋 监视已停止'));
    process.exit(ExitCode.SUCCESS);
  });

  // 首次立即查询
  await runStatusCheck(globalOpts, config, formatter);

  // 持续刷新
  setInterval(async () => {
    try {
      // 清屏并重新显示
      console.clear();
      await runStatusCheck(globalOpts, config, formatter);
      console.log(chalk.gray(`\n下次刷新: 5秒后 | 按 Ctrl+C 退出`));
    } catch {
      // 忽略刷新错误，继续尝试
    }
  }, 5000);

  // 防止进程退出
  await new Promise(() => {});
}

/**
 * 渲染状态显示
 */
function renderStatusDisplay(
  status: SystemStatus | null,
  agents: { agents: AgentStatus[] } | null
): void {
  console.log(chalk.bold('📊 MyOpenClaw 系统状态'));
  console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log();

  if (!status) {
    console.log(chalk.red('❌ 无法获取系统状态'));
    console.log(chalk.gray('  请检查 Gateway 服务是否启动'));
    console.log();
    return;
  }

  // Gateway 状态
  const statusIcon = status.status === 'running' ? '🟢' : '🔴';
  console.log(chalk.bold('Gateway'));
  console.log(`  状态:      ${statusIcon} ${status.status === 'running' ? chalk.green('运行中') : chalk.red('异常')}`);
  console.log(`  版本:      ${status.version}`);
  console.log(`  运行时间:  ${formatUptime(status.uptime)}`);
  console.log(`  连接数:    ${status.connectionCount}/${status.maxConnections}`);
  console.log(`  端口:      ${status.host}:${status.port}`);
  console.log();

  // Agent 运行时
  console.log(chalk.bold('Agent Runtime'));
  console.log(`  活跃会话:  ${status.activeSessions}`);
  console.log(`  路由规则:  ${status.ruleCount}`);
  console.log(`  渠道数:    ${status.channels}`);

  if (status.memoryUsage) {
    const mem = status.memoryUsage as { heapUsed?: number; heapTotal?: number; rss?: number };
    if (mem.rss) {
      console.log(`  内存占用:  ${formatBytes(mem.rss)}`);
    }
  }
  console.log();

  // Agent 列表
  if (agents && agents.agents.length > 0) {
    console.log(chalk.bold('Agent 列表'));
    const agentTable = new Table({
      head: ['Agent ID', '状态', '最后活跃'].map(h => chalk.cyan(h)),
      colWidths: [20, 10, 25],
      wordWrap: true,
    });

    agents.agents.forEach((agent) => {
      const statusColor = agent.status === 'ready' ? chalk.green : chalk.yellow;
      agentTable.push([
        agent.agentId,
        statusColor(agent.status),
        agent.lastActiveAt ? new Date(agent.lastActiveAt).toLocaleString('zh-CN') : '-',
      ] as (string | number | boolean | null | undefined)[]);
    });

    console.log(agentTable.toString());
  } else {
    console.log(chalk.gray('  暂无注册的 Agent'));
  }

  console.log();
}

/**
 * 格式化运行时间
 */
function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分 ${Math.floor(seconds % 60)}秒`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}时 ${Math.floor((seconds % 3600) / 60)}分`;
  return `${Math.floor(seconds / 86400)}天 ${Math.floor((seconds % 86400) / 3600)}时`;
}

/**
 * 格式化字节大小
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
