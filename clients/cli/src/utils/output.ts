/**
 * 输出格式化工具
 *
 * 提供多种输出格式（文本、JSON、表格）的格式化能力，
 * 支持彩色输出、成功/错误/警告等状态消息的样式化展示。
 *
 * @module cli/utils
 */

import chalk from 'chalk';
import Table from 'cli-table3';

/** chalk 实例类型（从 chalk 模块推断） */
type ChalkInstance = typeof chalk;

/** 输出格式类型 */
export type OutputFormat = 'text' | 'json' | 'table';

/**
 * 输出格式化器
 *
 * 根据用户指定的格式将数据输出到 stdout。
 * 支持人类可读的文本格式和机器可解析的 JSON 格式。
 */
export class OutputFormatter {
  /** 当前输出格式 */
  public readonly format: OutputFormat;

  constructor(format: OutputFormat = 'text') {
    this.format = format;
  }

  /**
   * 输出数据
   *
   * 根据当前格式将数据输出到控制台。
   *
   * @param data - 要输出的数据
   */
  print(data: unknown): void {
    switch (this.format) {
      case 'json':
        this.printJson(data);
        break;
      case 'table':
        this.printTable(data);
        break;
      case 'text':
      default:
        this.printText(data);
        break;
    }
  }

  /**
   * 以 JSON 格式输出
   *
   * 输出格式化的 JSON 字符串，适合脚本解析。
   *
   * @param data - 要输出的数据
   */
  private printJson(data: unknown): void {
    try {
      console.log(JSON.stringify(data, null, 2));
    } catch {
      console.log(JSON.stringify({ error: '无法序列化数据' }));
    }
  }

  /**
   * 以表格格式输出数组数据
   *
   * 将对象数组渲染为格式化的表格。
   *
   * @param data - 要输出的数据（应为对象数组）
   */
  private printTable(data: unknown): void {
    if (!Array.isArray(data) || data.length === 0) {
      console.log(chalk.gray('无数据'));
      return;
    }

    // 提取表头
    const headers = Object.keys(data[0] as Record<string, unknown>);
    const table = new Table({
      head: headers.map((h) => chalk.cyan(h)),
      wordWrap: true,
    });

    // 填充数据行
    (data as Array<Record<string, unknown>>).forEach((row) => {
      table.push(headers.map((h) => String(row[h] ?? '')) as (string | number | boolean | null | undefined)[]);
    });

    console.log(table.toString());
  }

  /**
   * 以文本格式输出
   *
   * 根据数据类型选择合适的展示方式。
   *
   * @param data - 要输出的数据
   */
  private printText(data: unknown): void {
    if (typeof data === 'string') {
      console.log(data);
    } else if (typeof data === 'object' && data !== null) {
      // 对对象进行缩进格式化输出
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(String(data));
    }
  }

  /**
   * 输出成功消息
   *
   * @param message - 成功消息文本
   */
  success(message: string): void {
    console.log(chalk.green('✓'), message);
  }

  /**
   * 输出错误消息
   *
   * @param message - 错误消息文本
   */
  error(message: string): void {
    console.error(chalk.red('✗'), message);
  }

  /**
   * 输出警告消息
   *
   * @param message - 警告消息文本
   */
  warning(message: string): void {
    console.log(chalk.yellow('⚠'), message);
  }

  /**
   * 输出信息消息
   *
   * @param message - 信息消息文本
   */
  info(message: string): void {
    console.log(chalk.blue('ℹ'), message);
  }

  /**
   * 输出带标题的分区
   *
   * @param title - 标题文本
   */
  section(title: string): void {
    console.log();
    console.log(chalk.bold(title));
  }

  /**
   * 输出分隔线
   */
  divider(): void {
    console.log(chalk.gray('─'.repeat(50)));
  }

  /**
   * 格式化状态显示
   *
   * @param status - 状态字符串
   * @returns 带颜色的状态显示文本
   */
  formatStatus(status: string): string {
    const statusMap: Record<string, { icon: string; color: ChalkInstance }> = {
      running: { icon: '🟢', color: chalk.green },
      healthy: { icon: '🟢', color: chalk.green },
      active: { icon: '🟢', color: chalk.green },
      ready: { icon: '🟢', color: chalk.green },
      connecting: { icon: '🟡', color: chalk.yellow },
      degraded: { icon: '🟡', color: chalk.yellow },
      starting: { icon: '🟡', color: chalk.yellow },
      stopped: { icon: '🔴', color: chalk.red },
      closed: { icon: '⚪', color: chalk.gray },
      unhealthy: { icon: '🔴', color: chalk.red },
      disconnected: { icon: '🔴', color: chalk.red },
      not_configured: { icon: '⚪', color: chalk.gray },
    };

    const mapping = statusMap[status.toLowerCase()];
    if (mapping) {
      return mapping.color(`${mapping.icon} ${status}`);
    }
    return chalk.gray(status);
  }

  /**
   * 格式化时间显示
   *
   * 将秒数格式化为人类可读的时间字符串。
   *
   * @param seconds - 时间长度（秒）
   * @returns 格式化的时间字符串
   */
  formatUptime(seconds: number): string {
    if (seconds < 60) return `${Math.floor(seconds)}秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分 ${Math.floor(seconds % 60)}秒`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}时 ${Math.floor((seconds % 3600) / 60)}分`;
    return `${Math.floor(seconds / 86400)}天 ${Math.floor((seconds % 86400) / 3600)}时`;
  }

  /**
   * 格式化字节大小
   *
   * @param bytes - 字节数
   * @returns 格式化的大小字符串
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }
}

/**
 * 创建格式化器实例
 *
 * @param format - 输出格式
 * @returns 格式化器实例
 */
export function createFormatter(format: OutputFormat = 'text'): OutputFormatter {
  return new OutputFormatter(format);
}
