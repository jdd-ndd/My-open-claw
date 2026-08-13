/**
 * memory 命令实现 (v1.1.8+)
 *
 * Memory 管理命令, 接 v1.1.6 暴露的 5 个 /api/memory/* 端点。
 * 提供以下子操作:
 * - list:    列出 memory sessions (活跃 + 概览)
 * - search:  在 memory 长期向量记忆里做语义检索
 * - show:    显示指定 session 详情 (含 messages)
 * - clear:   删除 session 或 vector (危险操作, --json 友好)
 *
 * 数据来源: HTTP API /api/memory/* 从 Gateway 拉取。
 * 当 Gateway 不可用或 runtimeAdapter 没装 memory 时给出明确错误提示。
 *
 * @module cli/commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';
import { createGatewayClient, isGatewayApiError } from '../api/client.js';
import { OutputFormatter } from '../utils/output.js';
import { ExitCode, handleErrorAndExit, createOperationError } from '../utils/errors.js';
import type { MyOpenClawConfig } from '../config/schema.js';

/**
 * Memory 命令操作类型
 */
type MemoryAction = 'list' | 'search' | 'show' | 'clear';

/**
 * Memory 命令选项
 */
interface MemoryCommandOptions {
  /** 语义检索 topK */
  topK?: string;
  /** 语义检索 threshold */
  threshold?: string;
  /** 限定 sessionId (search / clear) */
  session?: string;
  /** clear 时: 删除 vector 而不是 session */
  vector?: boolean;
  /** 跳过确认 (clear 时) */
  force?: boolean;
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

/* ═══════════════════════════════════════════════════════════════
 * /api/memory/* 响应类型 (跟 server MemoryManager 响应形状对齐)
 * ═══════════════════════════════════════════════════════════════ */

interface MemorySessionSummary {
  sessionId: string;
  userId: string;
  channelId: string;
  agentId: string;
  messageCount: number;
  createdAt: number;
  lastActiveAt: number;
}

interface MemorySessionsResponse {
  total: number;
  activeCount: number;
  sessions: MemorySessionSummary[];
}

interface MemorySessionDetail {
  sessionId: string;
  userId: string;
  channelId: string;
  agentId: string;
  metadata: {
    createdAt: number;
    lastActiveAt: number;
    messageCount: number;
    compressed: boolean;
  };
  taskState: Record<string, unknown> | null;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    timestamp: number;
  }>;
}

interface MemoryVectorEntry {
  id: string;
  content: string;
  score?: number;
  dimension?: number;
  metadata: {
    sessionId?: string;
    userId?: string;
    type?: 'conversation' | 'task' | 'knowledge';
    importance?: number;
    tags?: string[];
    createdAt?: number;
    [k: string]: unknown;
  };
}

interface MemoryVectorSearchResponse {
  query: string;
  total: number;
  results: MemoryVectorEntry[];
}

interface MemoryStats {
  sessions: { active: number };
  vectors: { total: number };
  embedding: {
    provider: string;
    available: boolean;
    dimension: number;
  };
}

/* ═══════════════════════════════════════════════════════════════
 * HTTP fetch 包装
 * ═══════════════════════════════════════════════════════════════ */

type HttpClient = ReturnType<typeof createGatewayClient>;

async function fetchMemorySessions(client: HttpClient): Promise<MemorySessionsResponse> {
  return (await client.get('/api/memory/sessions')) as MemorySessionsResponse;
}

async function fetchMemorySession(
  client: HttpClient,
  id: string,
): Promise<MemorySessionDetail> {
  return (await client.get(
    `/api/memory/sessions/${encodeURIComponent(id)}`,
  )) as MemorySessionDetail;
}

async function fetchMemoryStats(client: HttpClient): Promise<MemoryStats> {
  return (await client.get('/api/memory/stats')) as MemoryStats;
}

async function searchMemoryVectors(
  client: HttpClient,
  query: string,
  topK: number,
  threshold: number,
  sessionId?: string,
): Promise<MemoryVectorSearchResponse> {
  const params: Record<string, string | number> = { q: query, topK, threshold };
  if (sessionId) params.sessionId = sessionId;
  return (await client.get('/api/memory/vectors/search', { params })) as MemoryVectorSearchResponse;
}

async function deleteMemorySession(client: HttpClient, id: string): Promise<void> {
  await client.delete(`/api/memory/sessions/${encodeURIComponent(id)}`);
}

async function deleteMemoryVector(client: HttpClient, id: string): Promise<void> {
  await client.delete(`/api/memory/vectors/${encodeURIComponent(id)}`);
}

/* ═══════════════════════════════════════════════════════════════
 * 工具函数
 * ═══════════════════════════════════════════════════════════════ */

function formatRelativeTime(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '-';
  const diff = Date.now() - timestamp;
  if (diff < 0) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

/* ═══════════════════════════════════════════════════════════════
 * 命令注册
 * ═══════════════════════════════════════════════════════════════ */

export function createMemoryCommand(config: MyOpenClawConfig): Command {
  return new Command('memory')
    .description('Memory 管理: list / search / show / clear')
    .alias('mem')
    .argument('[action]', '操作类型: list, search, show, clear', 'list')
    .argument('[target]', '目标: search 时为查询字符串, show/clear 时为 session id (clear 加 --vector 则为 vector id)')
    .option('--topK <n>', '语义检索返回数量 (1-50, 默认 5)', '5')
    .option('--threshold <n>', '语义检索相似度阈值 (0-1, 默认 0)', '0')
    .option('--session <id>', '限定 sessionId (search 时过滤, clear 时作为 session id)')
    .option('--vector', 'clear 模式: 删除 vector 而不是 session (需提供 vector id 作为 target)')
    .option('-f, --force', '跳过确认 (clear 时)')
    .option('-l, --limit <n>', 'list 模式: 返回数量限制', '50')
    .action(
      async (
        action: MemoryAction,
        target: string | undefined,
        options: MemoryCommandOptions,
        command: Command,
      ) => {
        const globalOpts = (command.parent?.opts() as GlobalOptions) || {};
        const formatter = new OutputFormatter(globalOpts.json ? 'json' : 'text');

        const client = createGatewayClient({
          baseURL: globalOpts.gateway || config.gateway.url,
          verbose: globalOpts.verbose,
        });

        try {
          await handleMemoryAction(action, target, options, client, formatter);
        } catch (error) {
          console.error(createOperationError(`memory ${action}`, error));
          handleErrorAndExit(error, globalOpts.verbose);
        }
      },
    );
}

/* ═══════════════════════════════════════════════════════════════
 * 操作分发
 * ═══════════════════════════════════════════════════════════════ */

async function handleMemoryAction(
  action: MemoryAction,
  target: string | undefined,
  options: MemoryCommandOptions,
  client: HttpClient,
  formatter: OutputFormatter,
): Promise<void> {
  switch (action) {
    case 'list':
      await listMemorySessions(client, formatter, options);
      break;
    case 'search':
      if (!target) {
        console.error(chalk.red('search 需要一个查询字符串作为参数'));
        console.error('用法: myopenclaw memory search "..." [--topK 5] [--threshold 0]');
        process.exit(ExitCode.USAGE_ERROR);
      }
      await searchMemory(client, target, options, formatter);
      break;
    case 'show':
      if (!target) {
        console.error(chalk.red('show 需要一个 session id'));
        console.error('用法: myopenclaw memory show <session-id>');
        process.exit(ExitCode.USAGE_ERROR);
      }
      await showMemorySession(client, target, formatter);
      break;
    case 'clear':
      await clearMemory(target, options, client, formatter);
      break;
    default:
      console.log(chalk.red(`未知操作: ${action}`));
      console.log('可用操作: list, search, show, clear');
      process.exit(ExitCode.USAGE_ERROR);
  }
}

/* ═══════════════════════════════════════════════════════════════
 * list: 列出 memory sessions
 * ═══════════════════════════════════════════════════════════════ */

async function listMemorySessions(
  client: HttpClient,
  formatter: OutputFormatter,
  options: MemoryCommandOptions,
): Promise<void> {
  const spinner = ora('正在从 Gateway 获取 memory 状态...').start();
  let data: MemorySessionsResponse;
  let stats: MemoryStats;
  try {
    [data, stats] = await Promise.all([fetchMemorySessions(client), fetchMemoryStats(client)]);
    spinner.stop();
  } catch (error) {
    spinner.fail('获取 memory 列表失败');
    if (isGatewayApiError(error)) {
      throw new Error(`Gateway 错误: ${error.message}（code: ${error.code}）`);
    }
    throw error;
  }

  if (formatter.format === 'json') {
    formatter.print({ stats, sessions: data.sessions, total: data.total, activeCount: data.activeCount });
    return;
  }

  // 顶部概览
  console.log();
  console.log(chalk.bold('Memory overview'));
  console.log(chalk.gray(`  active sessions: ${stats.sessions.active}`));
  console.log(chalk.gray(`  vector entries:  ${stats.vectors.total}`));
  console.log(chalk.gray(`  embedding:       ${stats.embedding.provider} (${stats.embedding.dimension}-dim, ${stats.embedding.available ? 'API ready' : 'keyword fallback'})`));
  console.log();

  if (data.sessions.length === 0) {
    formatter.info('No memory sessions yet.');
    return;
  }

  // 表格
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 50));
  const rows = data.sessions.slice(0, limit);

  const table = new Table({
    head: ['SESSION', 'USER', 'CHANNEL / AGENT', 'MSGS', 'LAST ACTIVE'].map((h) => chalk.cyan(h)),
    wordWrap: true,
    colWidths: [22, 16, 28, 8, 16],
  });

  const now = Date.now();
  for (const session of rows) {
    const isStale = now - session.lastActiveAt > 24 * 60 * 60 * 1000;
    const lastActive = isStale
      ? chalk.yellow(formatRelativeTime(session.lastActiveAt))
      : chalk.white(formatRelativeTime(session.lastActiveAt));
    table.push([
      chalk.white(session.sessionId),
      chalk.gray(session.userId),
      chalk.gray(`${session.channelId} / ${session.agentId}`),
      String(session.messageCount),
      lastActive,
    ]);
  }

  console.log(table.toString());
  if (rows.length < data.sessions.length) {
    console.log(chalk.gray(`\n  Showing ${rows.length} of ${data.sessions.length} sessions. Use --limit to adjust.`));
  }
  console.log();
}

/* ═══════════════════════════════════════════════════════════════
 * search: 语义检索
 * ═══════════════════════════════════════════════════════════════ */

async function searchMemory(
  client: HttpClient,
  query: string,
  options: MemoryCommandOptions,
  formatter: OutputFormatter,
): Promise<void> {
  const topK = Math.max(1, Math.min(50, Number(options.topK) || 5));
  const threshold = Math.max(0, Math.min(1, Number(options.threshold) || 0));

  const spinner = ora(`搜索 "${query}" (topK=${topK}, threshold=${threshold})...`).start();
  let data: MemoryVectorSearchResponse;
  try {
    data = await searchMemoryVectors(client, query, topK, threshold, options.session);
    spinner.stop();
  } catch (error) {
    spinner.fail('搜索失败');
    if (isGatewayApiError(error)) {
      throw new Error(`Gateway 错误: ${error.message}（code: ${error.code}）`);
    }
    throw error;
  }

  if (formatter.format === 'json') {
    formatter.print(data);
    return;
  }

  console.log();
  console.log(chalk.bold(`Search results for "${query}"`));
  console.log(chalk.gray(`  total matches: ${data.total}`));
  console.log();

  if (data.results.length === 0) {
    formatter.info('No matches found.');
    return;
  }

  const table = new Table({
    head: ['ID', 'SCORE', 'CONTENT', 'METADATA'].map((h) => chalk.cyan(h)),
    wordWrap: true,
    colWidths: [16, 9, 50, 32],
  });

  for (const entry of data.results) {
    const meta = entry.metadata ?? {};
    const chips: string[] = [];
    if (meta.type) chips.push(`type:${meta.type}`);
    if (meta.sessionId) chips.push(`s:${meta.sessionId}`);
    if (meta.importance !== undefined) chips.push(`imp:${meta.importance}`);

    table.push([
      chalk.gray(entry.id.slice(0, 12)),
      entry.score !== undefined ? entry.score.toFixed(3) : '-',
      truncate(entry.content.replace(/\n/g, ' '), 200),
      chalk.gray(chips.join(' · ')),
    ]);
  }

  console.log(table.toString());
  console.log();
}

/* ═══════════════════════════════════════════════════════════════
 * show: 显示 session 详情
 * ═══════════════════════════════════════════════════════════════ */

async function showMemorySession(
  client: HttpClient,
  sessionId: string,
  formatter: OutputFormatter,
): Promise<void> {
  const spinner = ora(`正在读取 session ${sessionId}...`).start();
  let data: MemorySessionDetail;
  try {
    data = await fetchMemorySession(client, sessionId);
    spinner.stop();
  } catch (error) {
    spinner.fail('读取 session 失败');
    if (isGatewayApiError(error)) {
      if (error.code === 500002) {
        throw new Error(`Session "${sessionId}" not found.`);
      }
      throw new Error(`Gateway 错误: ${error.message}（code: ${error.code}）`);
    }
    throw error;
  }

  if (formatter.format === 'json') {
    formatter.print(data);
    return;
  }

  console.log();
  console.log(chalk.bold(`Session ${data.sessionId}`));
  console.log(chalk.gray(`  user:           ${data.userId}`));
  console.log(chalk.gray(`  channel / agent: ${data.channelId} / ${data.agentId}`));
  console.log(chalk.gray(`  message count:  ${data.metadata?.messageCount ?? 0}`));
  console.log(chalk.gray(`  compressed:     ${data.metadata?.compressed ?? false}`));
  console.log(chalk.gray(`  created:        ${formatRelativeTime(data.metadata?.createdAt)}`));
  console.log(chalk.gray(`  last active:    ${formatRelativeTime(data.metadata?.lastActiveAt)}`));
  if (data.taskState && Object.keys(data.taskState).length > 0) {
    console.log(chalk.gray(`  task state:     ${JSON.stringify(data.taskState)}`));
  }
  console.log();

  if (!data.messages || data.messages.length === 0) {
    formatter.info('No messages in this session.');
    return;
  }

  console.log(chalk.bold(`Messages (${data.messages.length})`));
  for (const msg of data.messages) {
    const time = new Date(msg.timestamp).toLocaleString();
    const roleColor = msg.role === 'user' ? chalk.cyan : chalk.gray;
    console.log(`  ${roleColor(`[${msg.role}]`)} ${chalk.gray(time)}`);
    const content = msg.content || '(空内容)';
    const lines = content.split('\n');
    for (const line of lines) {
      console.log(`    ${line}`);
    }
    console.log();
  }
}

/* ═══════════════════════════════════════════════════════════════
 * clear: 删除 (危险操作, 走 confirm 流程)
 * ═══════════════════════════════════════════════════════════════ */

async function clearMemory(
  target: string | undefined,
  options: MemoryCommandOptions,
  client: HttpClient,
  formatter: OutputFormatter,
): Promise<void> {
  if (!target) {
    console.error(chalk.red('clear 需要 target'));
    console.error('用法:');
    console.error('  myopenclaw memory clear <session-id>           # 删除 session');
    console.error('  myopenclaw memory clear <vector-id> --vector   # 删除 vector entry');
    console.error('  myopenclaw memory clear <session-id> --force   # 跳过确认');
    process.exit(ExitCode.USAGE_ERROR);
  }

  const kind = options.vector ? 'vector' : 'session';
  const id = target;

  // 确认 (除非 --force)
  if (!options.force) {
    console.log();
    console.log(chalk.yellow('即将执行危险操作:'));
    console.log(`  类型: ${chalk.bold(kind)}`);
    console.log(`  ID:   ${chalk.bold(id)}`);
    if (kind === 'session') {
      console.log('  影响: 删除 session 内存 + 所有消息, 引用此 session 的 vector 会被 detach');
    } else {
      console.log('  影响: 删除单条 vector 长期记忆');
    }
    console.log();
    const answer = await promptYesNo('确认删除? [y/N]');
    if (answer !== 'y') {
      formatter.info('已取消');
      return;
    }
  }

  const spinner = ora(`正在删除 ${kind} ${id}...`).start();
  try {
    if (kind === 'session') {
      await deleteMemorySession(client, id);
    } else {
      await deleteMemoryVector(client, id);
    }
    spinner.succeed(`已删除 ${kind}: ${id}`);
  } catch (error) {
    spinner.fail('删除失败');
    if (isGatewayApiError(error)) {
      if (error.statusCode === 404) {
        throw new Error(`${kind} "${id}" not found.`);
      }
      throw new Error(`Gateway 错误: ${error.message}（code: ${error.code}）`);
    }
    throw error;
  }

  if (formatter.format === 'json') {
    formatter.print({ ok: true, deleted: { kind, id } });
  }
}

/**
 * 简化的 y/N 提示 (避免引 readline 包)
 */
function promptYesNo(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(`${question} `);
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (data: Buffer | string) => {
      const answer = (typeof data === 'string' ? data : data.toString('utf8')).trim().toLowerCase();
      resolve(answer);
    });
    process.stdin.once('error', () => resolve('n'));
    process.stdin.resume();
  });
}
