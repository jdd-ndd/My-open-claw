/**
 * 日志器 — 基于 pino 的结构化日志
 *
 * @module @myopenclaw/server/core/utils
 */

import pino from 'pino';

/** 按 scope 缓存的日志器 Map */
const loggerCache = new Map<string, pino.Logger>();

/** 创建带作用域的日志器（按 scope 缓存实例） */
export function createLogger(scope: string): pino.Logger {
  const cached = loggerCache.get(scope);
  if (cached) return cached;

  const transport =
    process.env.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
        }
      : undefined;

  const logger = pino({
    name: 'myopenclaw',
    level: process.env.LOG_LEVEL ?? 'info',
    transport,
    formatters: {
      log(object) {
        return { ...object, scope } as Record<string, unknown>;
      },
    },
  });

  loggerCache.set(scope, logger);
  return logger;
}
