/**
 * CircuitBreaker - 熔断器
 */

import { EventEmitter } from 'node:events';

export enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open',
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  cooldownMs: number;
  halfOpenMaxRequests: number;
  resetWindowMs: number;
}

export interface CircuitBreakerState {
  name: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  openedAt: number | null;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  cooldownMs: 30_000,
  halfOpenMaxRequests: 3,
  resetWindowMs: 60_000,
};

export class CircuitBreaker extends EventEmitter {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private lastSuccessTime = 0;
  private openedAt: number | null = null;
  private halfOpenRequests = 0;
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  readonly config: CircuitBreakerConfig;

  constructor(
    public readonly name: string,
    config?: Partial<CircuitBreakerConfig>,
  ) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.transitionTo(CircuitState.HALF_OPEN);
      } else {
        throw new CircuitOpenError(this.name);
      }
    }

    if (this.state === CircuitState.HALF_OPEN) {
      if (this.halfOpenRequests >= this.config.halfOpenMaxRequests) {
        throw new CircuitOpenError(this.name);
      }
      this.halfOpenRequests += 1;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  reset(): void {
    this.clearCooldownTimer();
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenRequests = 0;
    this.transitionTo(CircuitState.CLOSED);
  }

  getState(): CircuitBreakerState {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      openedAt: this.openedAt,
    };
  }

  private onSuccess(): void {
    this.lastSuccessTime = Date.now();
    this.successCount += 1;

    if (this.state === CircuitState.HALF_OPEN) {
      this.reset();
      return;
    }

    if (Date.now() - this.lastFailureTime > this.config.resetWindowMs) {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.lastFailureTime = Date.now();
    this.failureCount += 1;

    if (this.state === CircuitState.HALF_OPEN || this.failureCount >= this.config.failureThreshold) {
      this.transitionTo(CircuitState.OPEN);
      this.scheduleCooldown();
    }
  }

  private shouldAttemptReset(): boolean {
    return this.openedAt !== null && Date.now() - this.openedAt >= this.config.cooldownMs;
  }

  private transitionTo(next: CircuitState): void {
    this.state = next;
    if (next === CircuitState.OPEN) {
      this.openedAt = Date.now();
      this.halfOpenRequests = 0;
    }
    if (next === CircuitState.CLOSED) {
      this.openedAt = null;
      this.halfOpenRequests = 0;
    }
    this.emit('stateChanged', this.getState());
  }

  private scheduleCooldown(): void {
    this.clearCooldownTimer();
    this.cooldownTimer = setTimeout(() => {
      if (this.state === CircuitState.OPEN) {
        this.transitionTo(CircuitState.HALF_OPEN);
      }
    }, this.config.cooldownMs);
  }

  private clearCooldownTimer(): void {
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }
  }
}

export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker '${name}' is open`);
    this.name = 'CircuitOpenError';
  }
}
