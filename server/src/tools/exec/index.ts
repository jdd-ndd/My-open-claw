/**
 * 系统执行工具集（对齐文档 §4.2）
 *
 * 提供 Shell 命令执行和进程管理能力。
 * 命令执行受黑名单拦截。
 *
 * @module @myopenclaw/server/tools/exec
 */

import { exec as cpExec, spawn } from 'node:child_process';
import { createLogger } from '../../core/utils/logger.js';
import type { Tool, ToolResult, InvokeContext, JSONSchema } from '../../core/types/index.js';

const log = createLogger('tools:exec');

// ═══════════════════════════════════════════════════════════════
// exec/shell —— Shell 命令执行（对齐文档 §4.2.1）
// ═══════════════════════════════════════════════════════════════

export class ExecShellTool implements Tool {
  readonly name = 'exec/shell';
  readonly description = '在系统 Shell 中执行命令。支持超时控制、环境变量设置、工作目录指定。';
  readonly category = 'exec';
  readonly risk: 'low' | 'medium' | 'high' = 'high';
  readonly builtin = true;

  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的 Shell 命令' },
      cwd: { type: 'string', description: '工作目录（默认用户主目录）' },
      timeout: {
        type: 'number',
        description: '超时时间（毫秒），默认 30000',
        default: 30000,
      },
      env: {
        type: 'object',
        description: '环境变量键值对',
        additionalProperties: { type: 'string' },
      },
    },
    required: ['command'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startTime = Date.now();
    const command = String(params.command);
    const cwd = params.cwd as string | undefined;
    const timeout = (params.timeout as number) ?? 30000;
    const env = params.env as Record<string, string> | undefined;

    return new Promise((resolve) => {
      const child = cpExec(command, {
        cwd,
        timeout,
        env: env ? { ...process.env, ...env } : process.env,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
      }, (error, stdout, stderr) => {
        const durationMs = Date.now() - startTime;

        if (error) {
          // 非零退出码不算完全失败，仍然返回结果
          if (error.killed) {
            resolve({
              success: false,
              status: 'timeout',
              error: `命令执行超时（${timeout}ms）`,
              errorCode: 'EXEC_TIMEOUT',
              data: { stdout, stderr, exitCode: error.code },
              metadata: { durationMs, sideEffects: ['command_executed'] },
            });
            return;
          }

          resolve({
            success: false,
            status: 'error',
            error: error.message,
            errorCode: 'EXEC_ERROR',
            data: { stdout, stderr, exitCode: error.code },
            metadata: { durationMs, sideEffects: ['command_executed'] },
          });
          return;
        }

        log.info({ command, durationMs }, '命令执行完成');

        resolve({
          success: true,
          status: 'success',
          data: { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 },
          metadata: { durationMs, sideEffects: ['command_executed'] },
        });
      });

      // 额外超时处理（如果 child_process.exec 的 timeout 不可靠）
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        // Windows 上 SIGTERM 可能不生效，使用 taskkill
        if (process.platform === 'win32' && child.pid) {
          try {
            spawn('taskkill', ['/pid', String(child.pid), '/f', '/t']);
          } catch { /* 忽略 */ }
        }
      }, timeout + 5000);

      child.on('close', () => clearTimeout(timer));
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// exec/process —— 进程管理（对齐文档 §4.2.2）
// ═══════════════════════════════════════════════════════════════

export class ExecProcessTool implements Tool {
  readonly name = 'exec/process';
  readonly description = '管理系统进程：列出运行中进程、查询进程详情、终止指定进程。';
  readonly category = 'exec';
  readonly risk: 'low' | 'medium' | 'high' = 'medium';
  readonly builtin = true;

  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: '操作类型',
        enum: ['list', 'info', 'kill'],
      },
      pid: {
        type: 'number',
        description: '进程 ID（action 为 info 或 kill 时必填）',
      },
      signal: {
        type: 'string',
        description: '发送的信号（action 为 kill 时使用，默认 SIGTERM）',
        default: 'SIGTERM',
      },
      filter: {
        type: 'string',
        description: '进程名过滤（action 为 list 时使用）',
      },
    },
    required: ['action'],
  };

  async execute(params: Record<string, unknown>, _context: InvokeContext): Promise<ToolResult> {
    const startTime = Date.now();
    const action = String(params.action);
    const pid = params.pid as number | undefined;
    const signal = (params.signal as string) ?? 'SIGTERM';
    const filter = params.filter as string | undefined;

    try {
      switch (action) {
        case 'list': {
          // 列出进程（根据平台使用对应命令）
          const isWindows = process.platform === 'win32';
          const listCmd = isWindows ? 'tasklist /FO CSV /NH' : 'ps aux';
          const result = await this.runCommand(listCmd);

          const processList = isWindows
            ? this.parseWindowsProcessList(result.stdout, filter)
            : this.parseUnixProcessList(result.stdout, filter);

          return {
            success: true,
            status: 'success',
            data: processList.slice(0, 50), // 限制返回数量
            metadata: {
              durationMs: Date.now() - startTime,
              sideEffects: [],
              resources: { totalProcesses: processList.length },
            },
          };
        }
        case 'info': {
          if (!pid) {
            return {
              success: false,
              status: 'error',
              error: '查询进程详情需要提供 pid',
              errorCode: 'MISSING_PID',
              metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
            };
          }

          const isWindows = process.platform === 'win32';
          const infoCmd = isWindows
            ? `tasklist /FI "PID eq ${pid}" /FO CSV /NH`
            : `ps -p ${pid} -o pid,ppid,user,pcpu,pmem,comm`;

          const result = await this.runCommand(infoCmd);
          return {
            success: true,
            status: 'success',
            data: { pid, raw: result.stdout },
            metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
          };
        }
        case 'kill': {
          if (!pid) {
            return {
              success: false,
              status: 'error',
              error: '终止进程需要提供 pid',
              errorCode: 'MISSING_PID',
              metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
            };
          }

          const isWindows = process.platform === 'win32';
          const killCmd = isWindows
            ? `taskkill /PID ${pid}${signal === 'SIGKILL' ? ' /F' : ''}`
            : `kill -${signal} ${pid}`;

          await this.runCommand(killCmd);
          log.warn({ pid, signal }, '进程已终止');

          return {
            success: true,
            status: 'success',
            data: { killed: pid, signal },
            metadata: {
              durationMs: Date.now() - startTime,
              sideEffects: ['process_killed'],
            },
          };
        }
        default:
          return {
            success: false,
            status: 'error',
            error: `不支持的进程操作: ${action}`,
            errorCode: 'INVALID_ACTION',
            metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
          };
      }
    } catch (err) {
      log.error({ action, err: (err as Error).message }, '进程操作失败');
      return {
        success: false,
        status: 'error',
        error: `进程操作失败: ${(err as Error).message}`,
        errorCode: 'PROCESS_ERROR',
        metadata: { durationMs: Date.now() - startTime, sideEffects: [] },
      };
    }
  }

  /** 执行命令并返回 stdout/stderr */
  private runCommand(command: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      cpExec(command, { timeout: 10000 }, (error, stdout, stderr) => {
        if (error && !error.killed) {
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }

  /** 解析 Windows tasklist 输出 */
  private parseWindowsProcessList(output: string, filter?: string): Array<Record<string, unknown>> {
    const lines = output.trim().split('\n');
    const result: Array<Record<string, unknown>> = [];
    for (const line of lines) {
      const parts = line.replace(/"/g, '').split(',');
      if (parts.length < 5) continue;
      const proc = {
        name: parts[0]?.trim() ?? '',
        pid: parseInt(parts[1]?.trim() ?? '0', 10),
        sessionName: parts[2]?.trim() ?? '',
        sessionId: parseInt(parts[3]?.trim() ?? '0', 10),
        memoryKB: parts[4]?.trim() ?? '',
      };
      if (filter && proc.name && !proc.name.toLowerCase().includes(filter.toLowerCase())) continue;
      result.push(proc);
    }
    return result;
  }

  /** 解析 Unix ps 输出 */
  private parseUnixProcessList(output: string, filter?: string): Array<Record<string, unknown>> {
    const lines = output.trim().split('\n').slice(1); // 跳过标题行
    const result: Array<Record<string, unknown>> = [];
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 11) continue;
      const proc = {
        user: parts[0],
        pid: parseInt(parts[1], 10),
        cpu: parts[2],
        mem: parts[3],
        vsz: parts[4],
        rss: parts[5],
        tty: parts[6],
        stat: parts[7],
        start: parts[8],
        time: parts[9],
        command: parts.slice(10).join(' '),
      };
      if (filter && proc.command && !proc.command.toLowerCase().includes(filter.toLowerCase())) continue;
      result.push(proc);
    }
    return result;
  }
}

// ═══════════════════════════════════════════════════════════════
// 旧版 ExecTool（向后兼容）
// ═══════════════════════════════════════════════════════════════

/**
 * 旧版 Shell 执行工具（兼容接口）
 *
 * @deprecated 请使用 ExecShellTool / ExecProcessTool 替代
 */
export class ExecTool implements Tool {
  readonly name = 'exec';
  readonly description = '执行 Shell 命令（沙箱化安全执行）—— 已废弃，请使用独立子工具';
  readonly category = 'exec';
  readonly risk: 'low' | 'medium' | 'high' = 'high';
  readonly builtin = true;

  readonly parameters: JSONSchema = {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的 Shell 命令' },
      cwd: { type: 'string', description: '工作目录' },
      timeout: { type: 'number', description: '超时时间（毫秒）', default: 30000 },
    },
    required: ['command'],
  };

  async execute(params: Record<string, unknown>, context: InvokeContext): Promise<ToolResult> {
    const delegate = new ExecShellTool();
    return delegate.execute(params, context);
  }
}
