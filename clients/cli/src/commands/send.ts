/**
 * send 命令实现
 *
 * 发送单条消息并等待回复，一次性完成请求-响应周期。
 * 支持：
 * - 命令行参数直接发送
 * - 管道输入（stdin）
 * - 文件附件
 * - 流式/非流式输出
 * - JSON 输出模式
 *
 * @module cli/commands
 */

import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { randomUUID } from 'node:crypto';
import { GatewayApiError } from '../api/client.js';
import { CLIWebSocketClient } from '../api/websocket.js';
import { runChatExchange } from '../api/chat-client.js';
import { OutputFormatter } from '../utils/output.js';
import { readStdin, hasPipeInput } from '../utils/stdin.js';
import { handleErrorAndExit, createOperationError } from '../utils/errors.js';
import type { MyOpenClawConfig } from '../config/schema.js';
import type { AttachmentInfo, ChatDonePayload } from '../api/types.js';
import { resolveSharedChannelId } from '../config/sync-defaults.js';

/**
 * Send 命令选项接口
 */
interface SendCommandOptions {
  /** 会话 ID */
  session?: string;
  /** 模型名称 */
  model?: string;
  /** 附件文件路径列表 */
  file?: string[];
  /** 是否使用流式输出 */
  stream?: boolean;
  /** 等待超时时间（秒） */
  wait?: string;
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
 * 创建 send 子命令
 *
 * 注册 send 命令及其选项，定义命令的执行逻辑。
 *
 * @param config - 加载的配置对象
 * @returns Commander Command 实例
 */
export function createSendCommand(config: MyOpenClawConfig): Command {
  const command = new Command('send')
    .description('发送单条消息并等待回复')
    .alias('s')
    .argument('[message]', '要发送的消息内容（可省略，从 stdin 读取）')
    .option('-s, --session <id>', '指定会话 ID（不指定则创建临时会话）')
    .option('-m, --model <model>', '指定 LLM 模型', config.model.default)
    .option('-f, --file <path>', '附加文件路径（可多次使用）', collectFiles, [] as string[])
    .option('--no-stream', '禁用流式输出，等待完整回复')
    .option('-w, --wait <seconds>', '等待响应超时时间（秒）', '60')
    .action(async (messageArg: string | undefined, options: SendCommandOptions, command: Command) => {
      const globalOpts = command.parent?.opts() as GlobalOptions || {};
      const formatter = new OutputFormatter(globalOpts.json ? 'json' : 'text');

      try {
        await runSend(messageArg, options, globalOpts, config, formatter);
      } catch (error) {
        console.error(createOperationError('发送消息', error));
        handleErrorAndExit(error, globalOpts.verbose);
      }
    });

  return command;
}

/**
 * 收集多个文件选项的辅助函数
 *
 * Commander 多次调用此函数来累积文件路径数组。
 *
 * @param value - 当前选项值
 * @param previous - 之前累积的值数组
 * @returns 累积后的数组
 */
function collectFiles(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

/**
 * 执行 send 命令逻辑
 *
 * 完整的发送流程：
 * 1. 确定消息内容（参数 > stdin > 错误）
 * 2. 处理附件文件
 * 3. 建立 WebSocket 连接
 * 4. 发送消息并接收回复
 * 5. 格式化输出结果
 *
 * @param messageArg - 命令行传入的消息参数
 * @param options - send 命令选项
 * @param globalOpts - 全局选项
 * @param config - 配置对象
 * @param formatter - 输出格式化器
 */
async function runSend(
  messageArg: string | undefined,
  options: SendCommandOptions,
  globalOpts: GlobalOptions,
  config: MyOpenClawConfig,
  formatter: OutputFormatter
): Promise<void> {
  // 确定消息内容：参数 > stdin > 错误
  let message = messageArg || '';
  if (!message && hasPipeInput()) {
    message = await readStdin();
  }
  if (!message.trim()) {
    throw new Error('消息内容不能为空。请提供消息参数或通过管道输入。');
  }

  // 确定参数
  const sessionId = options.session || generateTempSessionId();
  const model = options.model || config.model.default;
  const files = options.file || [];
  const useStream = options.stream !== false;
  const timeout = parseInt(options.wait || '60', 10) * 1000;
  const channel = resolveSharedChannelId(config.channel.default);

  // 处理附件文件
  const attachments = await processAttachments(files);

  // 建立 WebSocket 连接
  const spinner = ora('正在连接 Gateway...').start();
  const wsUrl = globalOpts.websocket || config.gateway.websocketUrl;
  const wsClient = new CLIWebSocketClient(wsUrl);

  try {
    await wsClient.connect();
    spinner.succeed('已连接到 Gateway');
  } catch (error) {
    spinner.fail('连接 Gateway 失败');
    throw error;
  }

  // 发送消息并接收回复
  try {
    const startTime = Date.now();
    const result = await sendMessageViaWebSocket(
      wsClient,
      sessionId,
      message,
      model,
      channel,
      useStream,
      timeout,
      attachments
    );
    const latency = Date.now() - startTime;

    // 格式化输出
    if (globalOpts.json) {
      formatter.print({
        success: true,
        sessionId,
        response: result,
        latencyMs: latency,
        model,
      });
    } else {
      // 文本模式：输出 Agent 回复
      if (typeof result === 'string') {
        console.log(result);
      } else if (result && typeof result === 'object' && 'totalContent' in result) {
        console.log((result as ChatDonePayload).totalContent);
      } else if (result && typeof result === 'object' && 'content' in result) {
        console.log((result as { content: string }).content);
      } else {
        console.log(String(result));
      }

      if (globalOpts.verbose) {
        console.error();
        console.error(
          chalk.gray(
            `[延迟: ${latency}ms, 会话: ${sessionId}, 模型: ${model}]`
          )
        );
      }
    }
  } catch (error) {
    if (error instanceof GatewayApiError) {
      throw error;
    }
    console.error(createOperationError('发送消息', error));
    handleErrorAndExit(error, globalOpts.verbose);
  } finally {
    wsClient.close();
  }
}

/**
 * 处理附件文件
 *
 * 读取附件文件并转换为 AttachmentInfo 数组。
 *
 * @param filePaths - 文件路径数组
 * @returns 附件信息数组
 */
async function processAttachments(filePaths: string[]): Promise<AttachmentInfo[]> {
  if (filePaths.length === 0) {
    return [];
  }

  const uploadSpinner = ora(`正在处理 ${filePaths.length} 个附件...`).start();

  try {
    const attachments = await Promise.all(
      filePaths.map(async (filePath) => {
        const stats = await fs.stat(filePath);
        const content = await fs.readFile(filePath);
        const filename = path.basename(filePath);

        return {
          name: filename,
          url: `file://${path.resolve(filePath)}`,
          size: stats.size,
          mimeType: guessMimeType(filename),
          // 注意：实际项目中应上传到 Gateway 并获取 URL
          // 此处简化处理，仅记录本地文件信息
          content: content.toString('base64'),
        } as AttachmentInfo & { content: string };
      })
    );

    uploadSpinner.succeed(`已处理 ${attachments.length} 个附件`);
    return attachments;
  } catch (error) {
    uploadSpinner.fail('附件处理失败');
    throw error;
  }
}

/**
 * 根据文件扩展名猜测 MIME 类型
 *
 * @param filename - 文件名
 * @returns MIME 类型
 */
function guessMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.yaml': 'application/x-yaml',
    '.yml': 'application/x-yaml',
    '.js': 'application/javascript',
    '.ts': 'application/typescript',
    '.py': 'text/x-python',
    '.html': 'text/html',
    '.css': 'text/css',
    '.xml': 'application/xml',
    '.csv': 'text/csv',
    '.log': 'text/plain',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

/**
 * 通过 WebSocket 发送消息
 *
 * 使用 WebSocket 协议发送聊天消息并接收回复。
 *
 * @param wsClient - WebSocket 客户端
 * @param sessionId - 会话 ID
 * @param message - 消息内容
 * @param model - 模型名称
 * @param channel - 渠道 ID
 * @param useStream - 是否使用流式输出
 * @param timeout - 超时时间（毫秒）
 * @param attachments - 附件列表
 * @returns Agent 回复内容
 */
async function sendMessageViaWebSocket(
  wsClient: CLIWebSocketClient,
  sessionId: string,
  message: string,
  model: string,
  channel: string,
  useStream: boolean,
  timeout: number,
  attachments: AttachmentInfo[]
): Promise<unknown> {
  const result = await runChatExchange(wsClient, {
    sessionId,
    content: message,
    model,
    channelId: channel,
    stream: useStream,
    attachments: attachments.map((attachment) => ({
      name: attachment.name,
      url: attachment.url,
      size: attachment.size,
      mimeType: attachment.mimeType,
    })),
    timeoutMs: timeout,
  });

  if (result.done) {
    if (result.done.error) {
      throw new Error(result.done.totalContent || 'Agent ????');
    }
    return result.done;
  }

  if (result.responsePayload) {
    return result.responsePayload;
  }

  throw new Error('Agent ???????');
}

/**
 * ????????? ID
 *
 * @returns ?????? ID
 */
function generateTempSessionId(): string {
  return 'temp-' + randomUUID().replace(/-/g, '').slice(0, 12);
}
