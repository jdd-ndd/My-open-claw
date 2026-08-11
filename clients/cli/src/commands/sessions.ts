/**
 * sessions 命令实现
 *
 * 会话管理命令，支持会话的查询、创建、删除等操作。
 * 通过 HTTP API 与 Gateway 交互，提供以下子操作：
 * - list: 列出活跃会话（显示路由规则信息）
 * - list-all: 列出所有会话
 * - create: 创建新会话
 * - delete: 删除指定会话
 * - switch: 切换默认会话
 * - rename: 重命名会话
 * - clear: 清空会话消息
 *
 * 注意：部分高级操作（如 rename、clear）需要 Gateway 对应端点支持，
 *        若端点不存在会给出友好提示。
 *
 * @module cli/commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import { createGatewayClient } from '../api/client.js';
import { OutputFormatter } from '../utils/output.js';
import { ExitCode, handleErrorAndExit, createOperationError } from '../utils/errors.js';
import type { MyOpenClawConfig } from '../config/schema.js';
import { resolveSharedChannelId, SHARED_USER_ID } from '../config/sync-defaults.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Sessions 命令操作类型
 */
type SessionAction = 'list' | 'list-all' | 'create' | 'delete' | 'switch' | 'rename' | 'clear';

/**
 * Sessions 命令选项
 */
interface SessionsCommandOptions {
  /** 会话标题 */
  title?: string;
  /** 列表返回数量限制 */
  limit?: string;
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
 * 创建 sessions 子命令
 *
 * @param config - 加载的配置对象
 * @returns Commander Command 实例
 */
export function createSessionsCommand(config: MyOpenClawConfig): Command {
  const command = new Command('sessions')
    .description('会话管理')
    .alias('sess')
    .argument('[action]', '操作类型: list, list-all, create, delete, switch, rename, clear', 'list')
    .argument('[id]', '会话 ID（需要时使用）')
    .option('-t, --title <title>', '会话标题（create/rename 时使用）')
    .option('-l, --limit <number>', '列表返回数量限制', '20')
    .action(async (action: SessionAction, id: string | undefined, options: SessionsCommandOptions, command: Command) => {
      const globalOpts = command.parent?.opts() as GlobalOptions || {};
      const formatter = new OutputFormatter(globalOpts.json ? 'json' : 'text');

      const client = createGatewayClient({
        baseURL: globalOpts.gateway || config.gateway.url,
        verbose: globalOpts.verbose,
      });

      try {
        await handleSessionAction(action, id, options, client, formatter, globalOpts, config);
      } catch (error) {
        console.error(createOperationError(`会话 ${action}`, error));
        handleErrorAndExit(error, globalOpts.verbose);
      }
    });

  return command;
}

/**
 * 处理会话操作
 *
 * @param action - 操作类型
 * @param id - 会话 ID
 * @param options - 命令选项
 * @param client - HTTP 客户端
 * @param formatter - 输出格式化器
 * @param globalOpts - 全局选项
 * @param config - 配置对象
 */
async function handleSessionAction(
  action: SessionAction,
  id: string | undefined,
  options: SessionsCommandOptions,
  client: ReturnType<typeof createGatewayClient>,
  formatter: OutputFormatter,
  globalOpts: GlobalOptions,
  config: MyOpenClawConfig
): Promise<void> {
  switch (action) {
    case 'list':
      await listSessions(client, options, formatter, globalOpts);
      break;
    case 'list-all':
      await listSessions(client, options, formatter, globalOpts, true);
      break;
    case 'create':
      await createSession(client, options, formatter, config);
      break;
    case 'delete':
      await deleteSession(client, id, formatter);
      break;
    case 'switch':
      await switchSession(client, id, formatter);
      break;
    case 'rename':
      await renameSession(client, id, options, formatter);
      break;
    case 'clear':
      await clearSession(client, id, formatter);
      break;
    default:
      console.log(chalk.red(`未知操作: ${action}`));
      console.log('可用操作: list, list-all, create, delete, switch, rename, clear');
      process.exit(ExitCode.USAGE_ERROR);
  }
}

/**
 * 列出会话
 *
 * 调用 GET /api/sessions?channelId=&userId= 端点，获取当前用户在共享渠道下的所有会话。
 * 返回的是真正的会话列表（含 sessionId、title、updatedAt 等），用于跨端同步场景。
 */
async function listSessions(
  client: ReturnType<typeof createGatewayClient>,
  _options: SessionsCommandOptions,
  formatter: OutputFormatter,
  globalOpts: GlobalOptions,
  _includeAll: boolean = false
): Promise<void> {
  const spinner = ora('正在获取会话列表...').start();

  try {
    // 使用共享 channelId 与 userId，与 web/tui_python 保持一致以实现跨端同步
    const channelId = resolveSharedChannelId();
    const response = await client.get('/api/sessions', {
      params: { channelId, userId: SHARED_USER_ID, includeClosed: false },
    }) as {
      sessions?: Array<{
        sessionId: string;
        title?: string;
        status?: string;
        createdAt?: number;
        updatedAt?: number;
        lastActiveAt?: number;
        pinnedAt?: number | null;
        agentId?: string;
      }>;
      total?: number;
    };

    spinner.stop();

    if (globalOpts.json) {
      formatter.print(response);
      return;
    }

    const sessions = response.sessions ?? [];

    // 显示会话概览
    console.log(chalk.bold('会话列表'));
    console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    console.log(`  渠道: ${channelId}  用户: ${SHARED_USER_ID}  共 ${sessions.length} 个会话`);
    console.log();

    if (sessions.length === 0) {
      console.log(chalk.gray('暂无会话，使用 "sessions create --title <标题>" 创建新会话'));
      return;
    }

    // 按更新时间倒序排序
    const sorted = [...sessions].sort((a, b) => {
      const aTime = a.updatedAt ?? a.lastActiveAt ?? 0;
      const bTime = b.updatedAt ?? b.lastActiveAt ?? 0;
      return bTime - aTime;
    });

    const table = new Table({
      head: ['#', '会话 ID', '标题', 'Agent', '更新时间'].map(h => chalk.cyan(h)),
      colWidths: [4, 38, 28, 12, 20],
      wordWrap: true,
    });

    sorted.forEach((session, idx) => {
      const updateTime = session.updatedAt ?? session.lastActiveAt
        ? new Date(session.updatedAt ?? session.lastActiveAt!).toLocaleString('zh-CN')
        : '-';
      table.push([
        String(idx + 1),
        session.sessionId,
        session.title || '(未命名)',
        session.agentId || '-',
        updateTime,
      ] as (string | number | boolean | null | undefined)[]);
    });

    console.log(table.toString());
  } catch (error) {
    spinner.fail('获取会话列表失败');
    throw error;
  }
}

/**
 * 创建新会话
 *
 * 使用共享 channelId/userId，确保新建的会话能被 web/tui_python/cli 三端共同看到
 */
async function createSession(
  client: ReturnType<typeof createGatewayClient>,
  options: SessionsCommandOptions,
  formatter: OutputFormatter,
  config: MyOpenClawConfig
): Promise<void> {
  const title = options.title;
  if (!title) {
    throw new Error('创建会话需要提供 --title 参数');
  }

  const spinner = ora('正在创建会话...').start();

  try {
    // 使用共享 channelId/userId，与 web/tui_python 保持一致以实现跨端同步
    const channelId = resolveSharedChannelId();
    const response = await client.post('/api/sessions', {
      agentId: config.model.default,
      channelId,
      userId: SHARED_USER_ID,
      title,
    }) as { sessionId: string; status?: string; createdAt?: number; title?: string };

    spinner.succeed('会话创建成功');

    if (formatter.format === 'json') {
      formatter.print(response);
    } else {
      console.log(chalk.green('✓'), `会话创建成功`);
      console.log(chalk.cyan('  会话 ID:'), response.sessionId);
      console.log(chalk.cyan('  标题:'), response.title || title);
      if (response.createdAt) {
        console.log(chalk.cyan('  创建时间:'), new Date(response.createdAt).toLocaleString('zh-CN'));
      }
      console.log(chalk.gray(`  已广播到同渠道其他端（web/tui_python）`));
    }
  } catch (error) {
    spinner.fail('创建会话失败');
    throw error;
  }
}

/**
 * 删除会话
 */
async function deleteSession(
  client: ReturnType<typeof createGatewayClient>,
  sessionId: string | undefined,
  formatter: OutputFormatter
): Promise<void> {
  if (!sessionId) {
    throw new Error('请提供要删除的会话 ID');
  }

  const spinner = ora(`正在删除会话 ${sessionId}...`).start();

  try {
    // DELETE 请求无 body，需显式移除 Content-Type 头，否则 Fastify 会因空 JSON body 报错
    await client.delete(`/api/sessions/${sessionId}`, { headers: { 'Content-Type': undefined } });
    spinner.succeed('会话已删除');

    if (formatter.format === 'json') {
      formatter.print({ success: true, sessionId });
    } else {
      console.log(chalk.green('✓'), `会话已删除: ${sessionId}`);
    }
  } catch (error) {
    spinner.fail('删除会话失败');
    throw error;
  }
}

/**
 * 当前会话本地状态文件路径
 *
 * CLI 是无状态进程，每次调用都重新启动。
 * 为支持"切换会话"语义，把当前选中的 sessionId 持久化到用户主目录。
 */
function getCurrentSessionFilePath(): string {
  return path.join(os.homedir(), '.myopenclaw', 'current-session');
}

/** 读取本地保存的当前会话 ID */
function readCurrentSessionId(): string | null {
  try {
    const file = getCurrentSessionFilePath();
    if (!fs.existsSync(file)) return null;
    const content = fs.readFileSync(file, 'utf-8').trim();
    return content || null;
  } catch {
    return null;
  }
}

/** 写入当前会话 ID 到本地 */
function writeCurrentSessionId(sessionId: string): void {
  const file = getCurrentSessionFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, sessionId, 'utf-8');
}

/**
 * 切换当前会话
 *
 * CLI 端的"切换"语义：把目标 sessionId 保存到本地 ~/.myopenclaw/current-session，
 * 后续 chat 命令会读取该文件作为默认会话。
 * 服务器端无需专用端点，因为会话本身已存在。
 */
async function switchSession(
  _client: ReturnType<typeof createGatewayClient>,
  sessionId: string | undefined,
  formatter: OutputFormatter
): Promise<void> {
  if (!sessionId) {
    throw new Error('请提供要切换到的会话 ID');
  }

  writeCurrentSessionId(sessionId);

  if (formatter.format === 'json') {
    formatter.print({ success: true, sessionId });
  } else {
    console.log(chalk.green('✓'), `已切换到会话: ${sessionId}`);
    console.log(chalk.gray('  后续 chat 命令将使用此会话（直到再次切换）'));
  }
}

/**
 * 重命名会话
 *
 * 调用 PATCH /api/sessions/:id 修改标题，服务器会广播 session.updated 事件给其他端
 */
async function renameSession(
  client: ReturnType<typeof createGatewayClient>,
  sessionId: string | undefined,
  options: SessionsCommandOptions,
  formatter: OutputFormatter
): Promise<void> {
  if (!sessionId) {
    throw new Error('请提供要重命名的会话 ID');
  }

  if (!options.title) {
    throw new Error('重命名会话需要提供 --title 参数');
  }

  const spinner = ora(`正在重命名会话 ${sessionId}...`).start();

  try {
    const response = await client.patch(`/api/sessions/${sessionId}`, {
      title: options.title,
    }) as { sessionId: string; title?: string };

    spinner.succeed('会话已重命名');

    if (formatter.format === 'json') {
      formatter.print({ success: true, ...response });
    } else {
      console.log(chalk.green('✓'), `会话已重命名`);
      console.log(chalk.cyan('  会话 ID:'), response.sessionId || sessionId);
      console.log(chalk.cyan('  新标题:'), response.title || options.title);
      console.log(chalk.gray('  已广播到同渠道其他端'));
    }
  } catch (error) {
    spinner.fail('重命名会话失败');
    throw error;
  }
}

/**
 * 清空会话消息
 *
 * 当前 Gateway 没有专用"清空消息"端点。
 * 此命令提示用户：可通过删除会话+重新创建实现等价效果。
 */
async function clearSession(
  _client: ReturnType<typeof createGatewayClient>,
  sessionId: string | undefined,
  formatter: OutputFormatter
): Promise<void> {
  if (!sessionId) {
    throw new Error('请提供要清空的会话 ID');
  }

  if (formatter.format === 'json') {
    formatter.print({
      success: false,
      message: 'Gateway 暂无清空消息端点，请使用 sessions delete + sessions create 实现等价效果',
      sessionId,
    });
  } else {
    console.log(chalk.yellow('⚠'), 'Gateway 暂无清空消息端点');
    console.log(chalk.gray('  可通过以下步骤实现等价效果:'));
    console.log(chalk.gray(`    1. myopenclaw sessions delete ${sessionId}`));
    console.log(chalk.gray('    2. myopenclaw sessions create --title <新标题>'));
  }
}

/** 导出：供 chat 命令读取本地当前会话 ID */
export function getCurrentSessionId(): string | null {
  return readCurrentSessionId();
}
