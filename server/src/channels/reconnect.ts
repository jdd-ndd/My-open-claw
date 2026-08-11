/**
 * 自动重连管理器
 *
 * 使用指数退避算法控制重连频率。
 * 当渠道连接异常断开时，按照配置的退避策略自动尝试重连。
 *
 * 重连退避时间计算：initialInterval × backoffFactor^(attempts - 1)，上限为 maxInterval。
 *
 * @module @myopenclaw/server/channels
 */

import type { ReconnectConfig } from './types.js';

/**
 * 重连回调接口
 *
 * 由渠道适配器实现，供 ReconnectManager 调用以执行实际重连操作。
 */
export interface Reconnectable {
  /** 渠道 ID，用于日志标识 */
  readonly id: string;

  /**
   * 执行重连操作
   * @returns true 表示重连成功，false 表示重连失败
   */
  reconnect(): Promise<boolean>;
}

/**
 * 自动重连管理器
 *
 * 使用指数退避算法控制重连频率。
 *
 * @example
 * ```typescript
 * const manager = new ReconnectManager(channel, {
 *   enabled: true,
 *   maxAttempts: 10,
 *   initialInterval: 1000,
 *   maxInterval: 30000,
 *   backoffFactor: 2,
 * });
 *
 * // 在连接断开时触发重连
 * manager.start();
 *
 * // 在连接恢复或停止时清理
 * manager.stop();
 * ```
 */
export class ReconnectManager {
  /** 当前重连尝试次数 */
  private attempts = 0;

  /** 定时器引用 */
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** 是否正在执行重连流程 */
  private active = false;

  /** 是否已被手动停止 */
  private stopped = false;

  /** 重连成功回调 */
  private onSuccess?: () => void;

  /** 重连失败回调（达到最大次数） */
  private onGiveUp?: () => void;

  constructor(
    private provider: Reconnectable,
    private config: ReconnectConfig,
  ) {}

  /**
   * 设置重连成功回调
   */
  setOnSuccess(callback: () => void): this {
    this.onSuccess = callback;
    return this;
  }

  /**
   * 设置放弃重连回调
   */
  setOnGiveUp(callback: () => void): this {
    this.onGiveUp = callback;
    return this;
  }

  /**
   * 开始重连流程
   *
   * 如果已经在重连中或已被手动停止，则忽略。
   */
  start(): void {
    if (this.active || this.stopped) return;
    if (!this.config.enabled) return;

    // 检查是否已达到最大重连次数
    if (this.config.maxAttempts > 0 && this.attempts >= this.config.maxAttempts) {
      console.error(
        `[ReconnectManager] 渠道 "${this.provider.id}" 已达到最大重连次数 ${this.config.maxAttempts}，放弃重连`,
      );
      this.onGiveUp?.();
      return;
    }

    this.active = true;
    this.attempts++;

    // 计算本次重连等待间隔（指数退避）
    const interval = this.calculateInterval();

    console.log(
      `[ReconnectManager] 渠道 "${this.provider.id}" 第 ${this.attempts} 次重连，` +
      `${Math.round(interval)}ms 后执行`,
    );

    this.timer = setTimeout(() => {
      this.executeReconnect();
    }, interval);
  }

  /**
   * 计算重连间隔
   */
  private calculateInterval(): number {
    return Math.min(
      this.config.initialInterval * Math.pow(this.config.backoffFactor, this.attempts - 1),
      this.config.maxInterval,
    );
  }

  /**
   * 执行实际重连操作
   */
  private async executeReconnect(): Promise<void> {
    try {
      const success = await this.provider.reconnect();
      if (success) {
        // 重连成功，重置计数器
        this.attempts = 0;
        this.active = false;
        console.log(`[ReconnectManager] 渠道 "${this.provider.id}" 重连成功`);
        this.onSuccess?.();
      } else {
        // 重连失败，继续重试
        this.active = false;
        this.start();
      }
    } catch (err) {
      // 重连异常，继续重试
      console.error(
        `[ReconnectManager] 渠道 "${this.provider.id}" 重连异常:`,
        err instanceof Error ? err.message : String(err),
      );
      this.active = false;
      this.start();
    }
  }

  /**
   * 停止重连流程
   *
   * 清除定时器并重置所有状态。
   */
  stop(): void {
    this.stopped = true;
    this.active = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.attempts = 0;
  }

  /**
   * 获取当前重连尝试次数
   */
  get attemptCount(): number {
    return this.attempts;
  }

  /**
   * 是否正在重连中
   */
  get isActive(): boolean {
    return this.active;
  }
}
