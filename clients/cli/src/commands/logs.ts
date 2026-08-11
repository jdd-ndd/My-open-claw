/**
 * logs 命令实现
 *
 * 日志查看命令，支持查看和追踪 Gateway 日志。
 * 提供以下功能：
 * - 查看最近 N 行日志
 * - 持续跟踪新日志（类似 tail -f）
 * - 按日志级别过滤
 * - 按时间范围过滤
 *
 * 注意：当前实现基于 HTTP API 的审计日志查询，
 *        实时日志流功能需要 Gateway WebSocket 支持。
 *
 * @module cli/commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { createGatewayClient, getAuditLogs, GatewayApiError } from '../api/client.js';
import { OutputFormatter } from '../utils/output.js';
import { ExitCode, handleErrorAndExit } from '../utils/errors.js';
import type { MyOpenClawConfig } from '../config/schema.js';
import type { AuditLogEntry } from '../api/types.js';

/**
 * Logs 命令选项
 */
interface LogsCommandOptions {
  /** 持续跟踪模式 */
  follow?: boolean;
  /** 显示最后 N 行 */
  lines?: string;
  /** 日志级别过滤 */
  level?: 'debug' | 'info' | 'warn' | 'error';
  /** 起始时间 */
  since?: string;
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
 * 创建 logs 子命令
 *
 * @param config - 加载的配置对象
 * @returns Commander Command 实例
 */
export function createLogsCommand(config: MyOpenClawConfig): Command {
  const command = new Command('logs')
    .description('日志查看')
    .alias('log')
    .option('-f, --follow', '持续跟踪新日志')
    .option('-n, --lines <number>', '显示最后 N 行', '50')
    .option('-l, --level <level>', '日志级别过滤: debug/info/warn/error')
    .option('--since <time>', '起始时间（如 1h/24h/2024-01-01）')
    .action(async (options: LogsCommandOptions, command: Command) => {
      const globalOpts = command.parent?.opts() as GlobalOptions || {};
      const formatter = new OutputFormatter(globalOpts.json ? 'json' : 'text');

      try {
        if (options.follow) {
          await runFollowMode(options, globalOpts, config, formatter);
        } else {
          await runLogsQuery(options, globalOpts, config, formatter);
        }
      } catch (error) {
        if (error instanceof GatewayApiError) {
          console.error(chalk.red('Gateway 连接错误:'), error.message);
          process.exit(ExitCode.GATEWAY_UNREACHABLE);
        }
        handleErrorAndExit(error, globalOpts.verbose);
      }
    });

  return command;
}

/**
 * 执行日志查询
 */
async function runLogsQuery(
  options: LogsCommandOptions,
  globalOpts: GlobalOptions,
  config: MyOpenClawConfig,
  formatter: OutputFormatter
): Promise<void> {
  const client = createGatewayClient({
    baseURL: globalOpts.gateway || config.gateway.url,
    verbose: globalOpts.verbose,
  });

  const spinner = ora('正在获取日志...').start();

  try {
    const limit = parseInt(options.lines || '50', 10);
    const params: Record<string, unknown> = { limit };

    // 添加级别过滤
    if (options.level) {
      params.category = options.level;
    }

    // 添加时间范围
    if (options.since) {
      const timeRange = parseTimeRange(options.since);
      if (timeRange) {
        params.startTime = timeRange.startTime;
      }
    }

    const response = await getAuditLogs<{ total: number; logs: AuditLogEntry[] }>(client, params);

    spinner.stop();

    if (formatter.format === 'json') {
      formatter.print(response);
      return;
    }

    // 显示日志
    renderLogsDisplay(response.logs, options.level);
  } catch (error) {
    spinner.fail('获取日志失败');
    throw error;
  }
}

/**
 * 持续跟踪模式
 */
async function runFollowMode(
  options: LogsCommandOptions,
  globalOpts: GlobalOptions,
  config: MyOpenClawConfig,
  formatter: OutputFormatter
): Promise<void> {
  console.log(chalk.bold('📋 Gateway 日志跟踪'));
  console.log(chalk.gray('  按 Ctrl+C 退出'));
  console.log();

  // 先加载一次历史日志
  await runLogsQuery(options, globalOpts, config, formatter);

  // 设置定时刷新
  const interval = setInterval(async () => {
    try {
      await runLogsQuery(options, globalOpts, config, formatter);
    } catch {
      // 忽略错误
    }
  }, 5000);

  // 捕获 Ctrl+C
  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log(chalk.gray('\n👋 日志跟踪已停止'));
    process.exit(ExitCode.SUCCESS);
  });

  // 防止进程退出
  await new Promise(() => {});
}

/**
 * 渲染日志显示
 */
function renderLogsDisplay(logs: AuditLogEntry[], _levelFilter?: string): void {
  if (logs.length === 0) {
    console.log(chalk.gray('暂无日志记录'));
    return;
  }

  console.log(chalk.bold(`日志记录 (共 ${logs.length} 条)`));
  console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  // 按时间倒序显示最新日志
  const sortedLogs = [...logs].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  sortedLogs.forEach((log) => {
    const timestamp = new Date(log.timestamp);
    const timeStr = timestamp.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    // 状态图标和颜色
    const statusIcon = log.success ? chalk.green('✓') : chalk.red('✗');
    const statusColor = log.success ? chalk.green : chalk.red;

    // 根据类别选择颜色
    const categoryColors: Record<string, (text: string) => string> = {
      system: chalk.cyan,
      auth: chalk.magenta,
      message: chalk.blue,
      session: chalk.yellow,
      agent: chalk.green,
    };
    const categoryColor = categoryColors[log.category] || chalk.white;

    // 格式化日志行
    console.log(
      `${chalk.gray(timeStr)} ${statusIcon} ${categoryColor(`[${log.category}]`)} ${statusColor(log.event)} ${chalk.gray(log.sessionId || '')}`
    );

    // 显示详情
    if (log.details) {
      const detailsStr = JSON.stringify(log.details);
      if (detailsStr.length < 100) {
        console.log(chalk.gray(`    ${detailsStr}`));
      }
    }
  });

  console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
}

/**
 * 解析时间范围字符串
 *
 * 支持格式：
 * - "1h" / "30m" / "24h" - 相对时间
 * - "2024-01-01" / "2024-01-01T00:00:00" - 绝对时间
 */
function parseTimeRange(timeStr: string): { startTime: number } | null {
  // 尝试解析相对时间
  const relativeMatch = timeStr.match(/^(\d+)(h|m|d)$/);
  if (relativeMatch) {
    const value = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const now = Date.now();

    switch (unit) {
      case 'h':
        return { startTime: now - value * 3600000 };
      case 'm':
        return { startTime: now - value * 60000 };
      case 'd':
        return { startTime: now - value * 86400000 };
    }
  }

  // 尝试解析绝对时间
  const date = new Date(timeStr);
  if (!isNaN(date.getTime())) {
    return { startTime: date.getTime() };
  }

  return null;
}
