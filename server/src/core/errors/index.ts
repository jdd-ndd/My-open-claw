/**
 * Core Errors — 聚合导出
 *
 * @module @myopenclaw/server/core/errors
 */

export { ErrorCode } from './codes.js';
export type { ErrorCodeType } from './codes.js';
export { AppError } from './AppError.js';
export type { AppErrorParams } from './AppError.js';
export {
  validationError,
  unauthorizedError,
  notFoundError,
  forbiddenError,
  timeoutError,
} from './AppError.js';
