/**
 * 指数退避重试机制
 *
 * @module @myopenclaw/server/core/utils
 */

import { sleep } from './time.js';

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 100,
    backoffFactor = 2,
    maxDelayMs = 10000,
    shouldRetry = () => true,
  } = opts;

  let lastError: unknown = new Error('retry: unreachable');
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries || !shouldRetry(error, attempt)) {
        throw error;
      }
      const delay = Math.min(initialDelayMs * Math.pow(backoffFactor, attempt), maxDelayMs);
      await sleep(delay);
    }
  }
  throw lastError;
}
