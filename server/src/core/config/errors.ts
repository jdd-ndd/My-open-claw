/**
 * 配置错误类型
 *
 * 三种级别:
 * - ConfigFatalError: 必填缺失 / 严重格式错,启动期必须终止 (process.exit(1))
 * - ConfigWarning:  可选字段缺失 / 软错,启动期打印 warning 继续
 * - ConfigInfo:    纯信息(例如配置文件不存在,使用默认)
 *
 * @module @myopenclaw/server/core/config
 */

import { ZodError } from 'zod';

export type ConfigErrorLevel = 'fatal' | 'warning' | 'info';

export interface ConfigIssue {
  level: ConfigErrorLevel;
  path: string;          // e.g. "network.http.port" or "~/.myopenclaw/config.json"
  message: string;
  hint?: string;
}

export class ConfigFatalError extends Error {
  public readonly issues: ConfigIssue[];

  constructor(issues: ConfigIssue[], summary?: string) {
    super(summary ?? `配置校验失败 (${issues.filter((i) => i.level === 'fatal').length} 个致命问题)`);
    this.name = 'ConfigFatalError';
    this.issues = issues;
  }

  /** 人类可读的多行错误信息 */
  format(): string {
    const lines: string[] = [];
    lines.push('\n❌ MyOpenClaw 配置加载失败:');
    lines.push('');

    for (const issue of this.issues) {
      const icon = issue.level === 'fatal' ? '✗' : issue.level === 'warning' ? '⚠' : 'ℹ';
      lines.push(`  ${icon} ${issue.path}: ${issue.message}`);
      if (issue.hint) {
        lines.push(`    提示: ${issue.hint}`);
      }
    }
    return lines.join('\n');
  }
}

/** 将 Zod 错误转换为 ConfigIssue 列表 */
export function zodToIssues(err: ZodError, sourcePath = '<input>'): ConfigIssue[] {
  return err.issues.map((iss) => {
    const path = iss.path.length > 0 ? iss.path.join('.') : sourcePath;
    return {
      level: 'fatal' as const,
      path,
      message: iss.message,
      hint: undefined,
    };
  });
}
