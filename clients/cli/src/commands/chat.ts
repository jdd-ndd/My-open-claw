/**
 * chat 命令实现
 *
 * 进入交互式对话模式，建立持续的多轮对话会话。
 * 通过 WebSocket 与 Gateway 实时通信，支持：
 * - 流式/非流式输出
 * - 多轮上下文保留
 * - 管道输入支持（非交互式场景）
 * - 斜杠命令：/exit, /help, /clear
 * - Token 使用统计显示
 * - 跨端会话同步事件订阅（session.created/updated/deleted）
 *
 * @module cli/commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { randomUUID } from 'node:crypto';
import { createGatewayClient } from '../api/client.js';
import { CLIWebSocketClient, WebSocketEvent } from '../api/websocket.js';
import { runChatExchange } from '../api/chat-client.js';
import { OutputFormatter } from '../utils/output.js';
import { readStdin, hasPipeInput, isInteractiveTerminal } from '../utils/stdin.js';
import { ExitCode, handleErrorAndExit, createOperationError } from '../utils/errors.js';
import type { MyOpenClawConfig } from '../config/schema.js';
import { resolveSharedChannelId, SHARED_USER_ID } from '../config/sync-defaults.js';

// ═══════════════════════════════════════════════════
// 纯 ANSI Spinner（不依赖 ora/log-update，避免 stdout 冲突）
// ═══════════════════════════════════════════════════

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

class SimpleSpinner {
  private text: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private started = false;
  private stopped = false;

  constructor(text: string) {
    this.text = text;
  }

  start(): this {
    if (this.started) return this;
    this.started = true;
    this.stopped = false;
    this.render();
    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
      this.render();
    }, 80);
    return this;
  }

  private render(): void {
    if (this.stopped) return;
    const frame = SPINNER_FRAMES[this.frameIndex];
    process.stdout.write(`\r\x1b[2K${chalk.cyan(frame)} ${this.text}`);
  }

  stop(): this {
    if (this.stopped) return this;
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // 清除当前行
    process.stdout.write('\r\x1b[2K');
    return this;
  }

  clear(): this {
    return this.stop();
  }

  update(text: string): this {
    this.text = text;
    return this;
  }

  succeed(text?: string): this {
    this.stop();
    process.stdout.write(`${chalk.green('✓')} ${text ?? this.text}\n`);
    return this;
  }

  fail(text?: string): this {
    this.stop();
    process.stdout.write(`${chalk.red('✗')} ${text ?? this.text}\n`);
    return this;
  }
}

/**
 * Chat 命令选项接口
 */
interface ChatCommandOptions {
  /** 会话 ID */
  session?: string;
  /** 模型名称 */
  model?: string;
  /** 渠道 ID */
  channel?: string;
  /** 是否使用流式输出 */
  stream?: boolean;
}

/**
 * 全局选项接口
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
 * 创建 chat 子命令
 *
 * 注册 chat 命令及其选项，定义命令的执行逻辑。
 *
 * @param config - 加载的配置对象
 * @returns Commander Command 实例
 */
export function createChatCommand(config: MyOpenClawConfig): Command {
  const command = new Command('chat')
    .description('进入交互式对话模式')
    .alias('c')
    .option('-s, --session <id>', '指定会话 ID（不指定则创建新会话）')
    .option('-m, --model <model>', '指定 LLM 模型', config.model.default)
    .option('-c, --channel <channel>', '指定渠道', config.channel.default)
    .option('--no-stream', '禁用流式输出，等待完整回复后再显示')
    .action(async (options: ChatCommandOptions, command: Command) => {
      const globalOpts = command.parent?.opts() as GlobalOptions || {};
      const formatter = new OutputFormatter(globalOpts.json ? 'json' : 'text');

      try {
        await runInteractiveChat(options, globalOpts, config, formatter);
      } catch (error) {
        console.error(createOperationError('启动对话', error));
        handleErrorAndExit(error, globalOpts.verbose);
      }
    });

  return command;
}

/**
 * 运行交互式对话
 *
 * 实现完整的交互式对话循环，包括：
 * 1. 初始化连接
 * 2. 管道输入处理
 * 3. 对话主循环
 * 4. 流式/非流式响应处理
 * 5. 优雅退出
 *
 * @param options - chat 命令选项
 * @param globalOpts - 全局选项
 * @param config - 配置对象
 * @param formatter - 输出格式化器
 */
async function runInteractiveChat(
  options: ChatCommandOptions,
  globalOpts: GlobalOptions,
  config: MyOpenClawConfig,
  formatter: OutputFormatter
): Promise<void> {
  // 生成或获取会话 ID
  const model = options.model || config.model.default;
  const channel = resolveSharedChannelId(options.channel || config.channel.default);
  const useStream = options.stream !== false;
  const sessionId = await resolveChatSessionId(options.session, channel, globalOpts, config);

  // 检查是否有管道输入（非交互式场景）
  let initialMessage = '';
  if (hasPipeInput()) {
    initialMessage = await readStdin();
  }

  // 检查是否是交互式终端
  const interactive = isInteractiveTerminal();

  // 如果是 JSON 输出模式，且有初始消息，直接发送并输出结果
  if (globalOpts.json && initialMessage) {
    await runJsonModeChat(sessionId, initialMessage, model, channel, globalOpts, formatter);
    return;
  }

  // 建立 WebSocket 连接
  const spinner = new SimpleSpinner('正在连接 Gateway...').start();
  const wsClient = new CLIWebSocketClient(
    globalOpts.websocket || config.gateway.websocketUrl
  );

  try {
    await wsClient.connect();
    spinner.succeed('已连接到 Gateway');
  } catch (error) {
    spinner.fail('连接 Gateway 失败');
    throw error;
  }

  // 注册跨端会话同步事件监听，使 cli 端可实时感知 web/tui_python 端产生的会话变更
  const syncHandlers = registerSessionSyncHandlers(wsClient, sessionId, interactive);

  // 关键：连接建立后立即发送 session.bind，将 channelId/userId 绑定到 WebSocket 连接
  // 这样服务器才能通过 broadcastToChannel 将跨端会话变更事件广播到本端
  try {
    await wsClient.bindSession(sessionId, { channelId: channel, userId: SHARED_USER_ID });
  } catch {
    // 绑定失败不阻断主流程，sendAndReceive 中会再次尝试
  }

  // 打印对话头部信息
  if (interactive) {
    printChatHeader(model, sessionId);
  }

  // 如果有管道输入的初始消息，先发送
  if (initialMessage) {
    await sendAndReceive(wsClient, sessionId, initialMessage, useStream, model, channel, interactive);
    if (!interactive) {
      // 非交互模式下，发送完初始消息后退出
      wsClient.close();
      process.exit(ExitCode.SUCCESS);
    }
  }

  if (!interactive) {
    // 非交互模式（无管道输入），显示提示并退出
    console.log('请通过管道输入消息，或使用交互式终端运行。');
    console.log('示例: echo "你好" | myopenclaw chat');
    wsClient.close();
    process.exit(ExitCode.USAGE_ERROR);
  }

  // 主对话循环
  // eslint-disable-next-line no-constant-condition -- 主循环, 由 break 退出
  while (true) {
    try {
      // 使用 inquirer 读取用户输入
      const { userInput } = await inquirer.prompt([
        {
          type: 'input',
          name: 'userInput',
          message: chalk.blue.bold('>'),
          prefix: '',
        },
      ]);

      const input = (userInput as string).trim();
      if (!input) continue;

      // 处理内置斜杠命令
      if (input.startsWith('/')) {
        const cmd = input.slice(1).trim();
        if (cmd === 'exit' || cmd === 'quit') {
          console.log(chalk.gray('👋 再见！会话已保存。'));
          break;
        }
        if (cmd === 'help') {
          printChatHelp();
          continue;
        }
        if (cmd === 'clear') {
          console.clear();
          continue;
        }
        console.log(chalk.yellow(`未知命令: /${cmd}，输入 /help 查看帮助`));
        continue;
      }

      // 发送消息前记录本端消息内容，用于跨端同步去重
      syncHandlers.setLastSent(input);

      // 发送消息并接收回复
      await sendAndReceive(wsClient, sessionId, input, useStream, model, channel, interactive);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      // inquirer 在 Ctrl+C 时抛出错误
      if (errMsg.includes('ExitPromptError') || errMsg.includes('User force closed')) {
        console.log(chalk.gray('\n👋 再见！会话已保存。'));
        break;
      }
      console.error(chalk.red('错误:'), errMsg);
    }
  }

  // 清理：关闭 WebSocket 连接
  wsClient.close();
}

/**
 * 运行 JSON 模式的对话
 *
 * 在 JSON 输出模式下，发送单条消息并输出 JSON 格式结果。
 *
 * @param sessionId - 会话 ID
 * @param message - 消息内容
 * @param model - 模型名称
 * @param channel - 渠道 ID
 * @param globalOpts - 全局选项
 * @param formatter - 输出格式化器
 */
async function resolveChatSessionId(
  requestedSessionId: string | undefined,
  channelId: string,
  globalOpts: GlobalOptions,
  config: MyOpenClawConfig,
): Promise<string> {
  if (requestedSessionId?.trim()) {
    return requestedSessionId.trim();
  }

  try {
    const client = createGatewayClient({ baseURL: globalOpts.gateway || config.gateway.url });
    const response = await client.get('/api/sessions', {
      params: { channelId, userId: SHARED_USER_ID, includeClosed: false },
    }) as {
      sessions?: Array<{
        sessionId: string;
        updatedAt?: number;
        lastActiveAt?: number;
        createdAt?: number;
      }>;
    };

    const sessions = response.sessions ?? [];
    if (sessions.length === 0) {
      return generateSessionId();
    }

    const latest = [...sessions].sort((a, b) => {
      const aTime = a.updatedAt ?? a.lastActiveAt ?? a.createdAt ?? 0;
      const bTime = b.updatedAt ?? b.lastActiveAt ?? b.createdAt ?? 0;
      return bTime - aTime;
    })[0];

    return latest?.sessionId || generateSessionId();
  } catch {
    return generateSessionId();
  }
}

async function runJsonModeChat(
  sessionId: string,
  message: string,
  model: string,
  channel: string,
  globalOpts: GlobalOptions,
  formatter: OutputFormatter
): Promise<void> {
  const wsClient = new CLIWebSocketClient(
    globalOpts.websocket || 'ws://localhost:18780/ws'
  );

  try {
    await wsClient.connect();

    // 绑定 channelId/userId 到 WebSocket 连接，确保能接收跨端会话同步事件
    await wsClient.bindSession(sessionId, { channelId: channel, userId: SHARED_USER_ID });

    const result = await wsClient.sendRequest('chat.send', {
      sessionId,
      content: message,
      model,
      channelId: channel,
      stream: false,
      userId: SHARED_USER_ID,
    });

    formatter.print({
      success: true,
      sessionId,
      response: result,
    });
  } catch (error) {
    formatter.print({
      success: false,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(ExitCode.GATEWAY_ERROR);
  } finally {
    wsClient.close();
  }
}

/**
 * 发送消息并接收 Agent 回复
 *
 * 根据 useStream 参数选择流式或非流式响应处理方式。
 *
 * @param ws - WebSocket 客户端
 * @param sessionId - 会话 ID
 * @param message - 用户消息内容
 * @param useStream - 是否使用流式输出
 * @param model - 使用的模型
 * @param channel - 使用的渠道
 * @param interactive - 是否交互式模式
 */
async function sendAndReceive(
  ws: CLIWebSocketClient,
  sessionId: string,
  message: string,
  useStream: boolean,
  model: string,
  channel: string,
  interactive: boolean
): Promise<void> {
  const spinner = interactive
    ? new SimpleSpinner(useStream ? '正在处理您的问题...' : 'Agent 思考中...').start()
    : null;

  try {
    const result = await runChatExchange(ws, {
      sessionId,
      content: message,
      model,
      channelId: channel,
      stream: useStream,
      timeoutMs: 120000,
    });

    spinner?.stop();

    if (useStream) {
      const reasoning = result.reasoningDeltas.at(-1)?.accumulated || '';
      const content = result.done?.totalContent || result.deltas.at(-1)?.accumulated || '';

      if (reasoning && interactive) {
        console.log(chalk.gray('\n[思考中...]'));
        console.log(chalk.gray('---'));
      }

      if (content) {
        console.log(content);
      }

      if (result.done?.error) {
        console.log(chalk.red('Agent 错误:'), result.done.totalContent || '无内容');
      }

      if (interactive && result.done?.durationMs) {
        console.log(chalk.gray(`[耗时: ${(result.done.durationMs / 1000).toFixed(1)}s]`));
      }

      console.log();
      return;
    }

    const content = result.done?.totalContent
      || (typeof result.responsePayload?.content === 'string' ? result.responsePayload.content : '');

    if (content) {
      console.log(chalk.green('Agent:'), content);
      console.log();
      return;
    }

    throw new Error('Agent 无回复');
  } catch (error) {
    spinner?.stop();
    throw error;
  }
}
/**
 * 监控跨端会话同步事件并打印通知
 *
 * 订阅 WebSocket 广播的 session.created/session.updated/session.deleted 事件，
 * 以及 chat.message_sent 事件（跨端用户消息同步）。
 *
 * @param ws - WebSocket 客户端实例
 * @param sessionId - 当前会话 ID（用于判断事件是否针对当前会话）
 * @param interactive - 是否处于交互式终端
 * @returns 包含 cleanup() 和 setLastSent() 的控制对象
 */
function registerSessionSyncHandlers(
  ws: CLIWebSocketClient,
  sessionId: string,
  interactive: boolean,
): { cleanup: () => void; setLastSent: (content: string) => void } {
  // 追踪本端最后发送的消息，用于去重（避免自己发送的消息被重复显示）
  let lastSentContent = '';

  // 其他端创建了新会话
  const onCreated = (payload: { session?: { title?: string; id?: string } } | undefined) => {
    if (!interactive) return;
    const title = payload?.session?.title || '未命名会话';
    console.log(chalk.gray(`\n[会话同步] 其他端创建了新会话: ${title}`));
  };

  // 其他端修改了会话（如标题 更新）
  const onUpdated = (payload: { session?: { title?: string; id?: string } } | undefined) => {
    if (!interactive) return;
    const title = payload?.session?.title || '未命名会话';
    if (isEventForCurrentSession(payload, sessionId)) {
      console.log(chalk.cyan(`\n[会话同步] 当前会话已被其他端修改（标题 更新为）: ${title}`));
    } else {
      console.log(chalk.gray(`\n[会话同步] 其他端修改了会话: ${title}`));
    }
  };

  // 其他端删除了会话
  const onDeleted = (payload: { sessionId?: string } | undefined) => {
    if (!interactive) return;
    const targetId = payload?.sessionId;
    if (targetId && targetId === sessionId) {
      // 当前会话被删除：立即关闭并退出
      console.log(chalk.red(`\n[会话同步] 当前会话已被其他端删除，即将退出...`));
      ws.close();
      process.exit(ExitCode.SUCCESS);
    } else {
      console.log(chalk.gray(`\n[会话同步] 其他端删除了会话: ${targetId || '未知'}`));
    }
  };

  // 其他端发送了用户消息（跨端消息同步）
  const onMessageSent = (payload: { sessionId?: string; content?: string; source?: string } | undefined) => {
    if (!interactive) return;
    if (!payload) return;

    // 只处理当前会话的消息
    if (payload.sessionId && payload.sessionId !== sessionId) return;

    const content = (payload.content || '').trim();
    if (!content) return;

    // 去重：如果是本端刚发送的消息，跳过避免重复显示
    if (content === lastSentContent) return;

    // 其他端的用户消息：显示在终端
    console.log(chalk.cyan(`\n[跨端消息] 其他端: ${content}`));
  };

  ws.on(WebSocketEvent.SESSION_CREATED, onCreated);
  ws.on(WebSocketEvent.SESSION_UPDATED, onUpdated);
  ws.on(WebSocketEvent.SESSION_DELETED, onDeleted);
  ws.on(WebSocketEvent.CHAT_MESSAGE_SENT, onMessageSent);

  // 返回控制对象
  return {
    cleanup: () => {
      ws.off(WebSocketEvent.SESSION_CREATED, onCreated);
      ws.off(WebSocketEvent.SESSION_UPDATED, onUpdated);
      ws.off(WebSocketEvent.SESSION_DELETED, onDeleted);
      ws.off(WebSocketEvent.CHAT_MESSAGE_SENT, onMessageSent);
    },
    setLastSent: (content: string) => {
      lastSentContent = content;
    },
  };
}

/**
 * 标识一个会话同步事件payload是否针对当前会话
 *
 * @param payload - 事件 payload
 * @param currentSessionId - 当前会话 ID
 * @returns 如果事件指向当前会话则返回 true
 */
function isEventForCurrentSession(
  payload: { sessionId?: string; session?: { id?: string } } | undefined,
  currentSessionId: string,
): boolean {
  if (!payload) return false;
  // 直接携带 sessionId 字段（删除场景）
  if (payload.sessionId && payload.sessionId === currentSessionId) return true;
  // 内嵌在会话对象中（创建/更新场景）
  if (payload.session?.id && payload.session.id === currentSessionId) return true;
  return false;
}

/**
 * 打印对话头部信息
 *
 * @param model - 模型名称
 * @param sessionId - 会话 ID
 */
function printChatHeader(model: string, sessionId: string): void {
  console.log();
  console.log(
    chalk.bold('🤖 MyOpenClaw 交互式对话'),
    chalk.gray(`(模型: ${model}, 会话: ${sessionId.slice(0, 12)}...)`)
  );
  console.log(chalk.gray('────────────────────────────────────────────────────────────'));
  console.log(chalk.gray('提示: 输入 /help 查看可用命令，/exit 退出对话'));
  console.log();
}

/**
 * 打印对话内置命令帮助
 */
function printChatHelp(): void {
  console.log();
  console.log(chalk.bold('对话内置命令:'));
  console.log('  /help   显示此帮助信息');
  console.log('  /exit   退出对话模式');
  console.log('  /clear  清屏');
  console.log();
}

/**
 * 生成唯一的会话 ID
 *
 * 使用 UUID 生成短会话 ID，格式为 sess-{random}。
 *
 * @returns 会话 ID
 */
function generateSessionId(): string {
  return 'sess-' + randomUUID().replace(/-/g, '').slice(0, 16);
}
