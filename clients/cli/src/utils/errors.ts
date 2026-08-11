/**
 * 错误处理工具
 *
 * 提供 CLI 客户端统一的错误处理、格式化和退出码管理功能。
 * 确保所有命令的错误处理行为一致，便于脚本化调用和问题诊断。
 *
 * @module cli/utils
 */

import chalk from 'chalk';
import type { GatewayApiError } from '../api/client.js';

/**
 * CLI 退出码约定
 *
 * 遵循 Unix 标准退出码约定，便于 shell 脚本判断命令执行状态。
 */
export const ExitCode = {
  /** 命令成功执行 */
  SUCCESS: 0,
  /** 通用错误 */
  GENERAL_ERROR: 1,
  /** 命令误用（参数错误、非法选项） */
  USAGE_ERROR: 2,
  /** Gateway 不可达 */
  GATEWAY_UNREACHABLE: 3,
  /** Gateway 返回错误 */
  GATEWAY_ERROR: 4,
  /** 请求超时 */
  TIMEOUT: 5,
  /** 配置错误 */
  CONFIG_ERROR: 6,
  /** 权限错误 */
  PERMISSION_ERROR: 7,
  /** 用户中断（SIGINT/Ctrl+C） */
  USER_INTERRUPTED: 130,
} as const;

/** ExitCode 类型（数字联合类型） */
export type ExitCodeType = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * CLI 错误基类
 *
 * 所有 CLI 相关错误都应继承此类，提供统一的错误信息格式。
 */
export class CliError extends Error {
  /** 退出码 */
  public code: number;
  /** 是否可重试 */
  public retryable: boolean;
  /** 是否需要显示详细堆栈 */
  public showStack: boolean;

  constructor(message: string, options?: { code?: number; retryable?: boolean; showStack?: boolean }) {
    super(message);
    this.name = 'CliError';
    this.code = options?.code ?? ExitCode.GENERAL_ERROR;
    this.retryable = options?.retryable ?? false;
    this.showStack = options?.showStack ?? false;
  }
}

/**
 * 用法错误
 *
 * 命令参数错误时抛出，退出码为 2。
 */
export class UsageError extends CliError {
  constructor(message: string) {
    super(message, { code: ExitCode.USAGE_ERROR });
    this.name = 'UsageError';
  }
}

/**
 * Gateway 连接错误
 *
 * 无法连接到 Gateway 时抛出，退出码为 3。
 */
export class GatewayConnectionError extends CliError {
  constructor(message: string) {
    super(message, { code: ExitCode.GATEWAY_UNREACHABLE, retryable: true });
    this.name = 'GatewayConnectionError';
  }
}

/**
 * 配置错误
 *
 * 配置文件无效或缺失时抛出，退出码为 6。
 */
export class ConfigError extends CliError {
  constructor(message: string) {
    super(message, { code: ExitCode.CONFIG_ERROR });
    this.name = 'ConfigError';
  }
}

/**
 * 格式化错误输出
 *
 * 将错误对象转换为用户友好的输出格式。
 *
 * @param error - 错误对象
 * @param verbose - 是否显示详细信息
 * @returns 格式化的错误消息
 */
export function formatError(error: unknown, verbose: boolean = false): string {
  if (error instanceof CliError) {
    let message = chalk.red('错误:') + ` ${error.message}`;

    if (error.retryable) {
      message += chalk.yellow(' (可重试)');
    }

    if (verbose && error.showStack && error.stack) {
      message += `\n${chalk.gray(error.stack)}`;
    }

    return message;
  }

  // Gateway API 错误
  const apiError = error as GatewayApiError;
  if (apiError?.name === 'GatewayApiError') {
    let message = chalk.red('Gateway 错误:') + ` ${apiError.message}`;
    if (apiError.code) {
      message += chalk.gray(` [错误代码: ${apiError.code}]`);
    }
    if (apiError.retryable) {
      message += chalk.yellow(' (可重试)');
    }
    return message;
  }

  // 标准 Error
  if (error instanceof Error) {
    let message = chalk.red('错误:') + ` ${error.message}`;
    if (verbose && error.stack) {
      message += `\n${chalk.gray(error.stack)}`;
    }
    return message;
  }

  // 未知错误
  return chalk.red('未知错误:') + ` ${String(error)}`;
}

/**
 * 处理并退出
 *
 * 统一的错误处理出口，格式化错误消息并以合适的退出码退出。
 *
 * @param error - 错误对象
 * @param verbose - 是否显示详细信息
 */
export function handleErrorAndExit(error: unknown, verbose: boolean = false): never {
  const output = formatError(error, verbose);
  console.error(output);

  // 确定退出码
  let exitCode: number = ExitCode.GENERAL_ERROR;

  if (error instanceof CliError) {
    exitCode = error.code;
  } else {
    const apiError = error as GatewayApiError;
    if (apiError?.name === 'GatewayApiError') {
      exitCode = apiError.retryable ? ExitCode.GATEWAY_UNREACHABLE : ExitCode.GATEWAY_ERROR;
    }
  }

  process.exit(exitCode);
}

/**
 * 安全执行异步函数
 *
 * 包装异步操作，统一处理错误和退出码。
 *
 * @param fn - 要执行的异步函数
 * @param errorMessage - 自定义错误消息
 * @param verbose - 是否显示详细信息
 */
export async function safeExecute(
  fn: () => Promise<void>,
  errorMessage?: string,
  verbose: boolean = false
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (errorMessage && error instanceof Error) {
      console.error(chalk.red('错误:'), errorMessage);
      if (verbose) {
        console.error(chalk.gray(error.message));
      }
      process.exit(ExitCode.GENERAL_ERROR);
    } else {
      handleErrorAndExit(error, verbose);
    }
  }
}

/**
 * 创建进度错误消息
 *
 * @param operation - 操作名称
 * @param error - 错误对象
 * @returns 格式化的错误消息
 */
export function createOperationError(operation: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${operation}失败: ${message}`;
}

/**
 * 检查错误类型并给出建议
 *
 * @param error - 错误对象
 * @returns 建议文本
 */
export function suggestAction(error: unknown): string | null {
  const apiError = error as GatewayApiError;

  if (apiError?.name === 'GatewayApiError') {
    if (apiError.code === 300001 || apiError.code === 0) {
      return '请检查 Gateway 服务是否启动，或使用 --gateway 参数指定正确的地址。';
    }
    if (apiError.statusCode === 401 || apiError.statusCode === 403) {
      return '请检查认证配置，可能需要设置 API Token。';
    }
    if (apiError.statusCode === 404) {
      return '请求的资源不存在，请检查命令参数是否正确。';
    }
    if (apiError.statusCode === 503) {
      return 'Gateway 暂时不可用，请稍后重试。';
    }
  }

  return null;
}
