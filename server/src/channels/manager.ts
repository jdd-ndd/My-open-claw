/**
 * ChannelManager —— 渠道管理器
 *
 * 负责管理所有渠道适配器的完整生命周期：
 * - 注册渠道 Provider
 * - 根据配置启用/禁用渠道
 * - 统一启动/停止渠道
 * - 消息接收回调与 Gateway Router 集成
 * - 消息下行分发到目标渠道
 * - 渠道状态同步到 StateManager
 * - 健康检查
 *
 * @module @myopenclaw/server/channels
 */

import { EventEmitter } from 'node:events';
import { createLogger } from '../core/utils/logger.js';
import type {
  ChannelConfig,
  ChannelContext,
  ChannelStatus,
  InboundMessage,
  OutboundMessage,
  MessageTarget,
  SendMessageResult,
  ChannelLogger,
  ChannelLifecycleState,
} from './types.js';
import type { ChannelProvider } from './base.js';

/** 渠道 Provider 工厂函数类型 */
export type ChannelProviderFactory = () => ChannelProvider;

/** 渠道管理器配置 */
export interface ChannelManagerOptions {
  /** 路由处理函数：将归一化后的入站消息路由到 Agent */
  onRouteMessage?: (message: InboundMessage) => Promise<void>;
  /** 错误处理函数 */
  onError?: (error: Error, channelId: string) => void;
  /** 日志级别 */
  logLevel?: string;
}

const log = createLogger('channels:manager');

/**
 * 渠道管理器
 *
 * 单例模式，管理所有渠道适配器的生命周期。
 * 与 Gateway Router 和 StateManager 配合工作。
 *
 * @example
 * ```typescript
 * const manager = ChannelManager.getInstance();
 * manager.register('qqbot', () => new QQBotChannel());
 * await manager.initializeAll(configs);
 * await manager.startAll();
 * ```
 */
export class ChannelManager extends EventEmitter {
  /** 单例实例 */
  private static instance: ChannelManager | null = null;

  /** 已注册的 Provider 工厂 */
  private factories = new Map<string, ChannelProviderFactory>();

  /** 运行中的渠道实例 */
  private channels = new Map<string, ChannelProvider>();

  /** 每个渠道的状态上下文 */
  private contexts = new Map<string, ChannelContext>();

  /** 每个渠道的配置 */
  private configs = new Map<string, ChannelConfig>();

  /** 路由消息回调 */
  private onRouteMessage?: (message: InboundMessage) => Promise<void>;

  /** 错误回调 */
  private onErrorCallback?: (error: Error, channelId: string) => void;

  /** 管理器状态 */
  private started = false;

  private constructor() {
    super();
    this.setMaxListeners(100);
  }

  /**
   * 获取单例实例
   */
  static getInstance(): ChannelManager {
    if (!ChannelManager.instance) {
      ChannelManager.instance = new ChannelManager();
    }
    return ChannelManager.instance;
  }

  /**
   * 重置单例（测试用）
   */
  static resetInstance(): void {
    ChannelManager.instance = null;
  }

  // ══════════════════════════════════════════════════════════════
  // 注册
  // ══════════════════════════════════════════════════════════════

  /**
   * 注册渠道 Provider
   *
   * @param channelId - 渠道 ID
   * @param factory - Provider 工厂函数
   */
  register(channelId: string, factory: ChannelProviderFactory): void {
    if (this.factories.has(channelId)) {
      log.warn(`渠道 "${channelId}" 已注册，将被覆盖`);
    }
    this.factories.set(channelId, factory);
    log.info(`渠道 "${channelId}" 已注册`);
  }

  /**
   * 检查渠道是否已注册
   */
  isRegistered(channelId: string): boolean {
    return this.factories.has(channelId);
  }

  /**
   * 获取已注册的渠道 ID 列表
   */
  getRegisteredChannelIds(): string[] {
    return Array.from(this.factories.keys());
  }

  // ══════════════════════════════════════════════════════════════
  // 初始化
  // ══════════════════════════════════════════════════════════════

  /**
   * 设置路由消息回调
   */
  setRouteHandler(handler: (message: InboundMessage) => Promise<void>): void {
    this.onRouteMessage = handler;
  }

  /**
   * 设置错误处理回调
   */
  setErrorHandler(handler: (error: Error, channelId: string) => void): void {
    this.onErrorCallback = handler;
  }

  /**
   * 初始化所有已注册的渠道
   *
   * @param configs - 渠道配置列表
   */
  async initializeAll(configs: ChannelConfig[]): Promise<void> {
    log.info(`正在初始化 ${configs.length} 个渠道...`);

    for (const config of configs) {
      const channelId = config.channelId;

      if (!config.enabled) {
        log.info(`渠道 "${channelId}" 已禁用，跳过`);
        continue;
      }

      const factory = this.factories.get(channelId);
      if (!factory) {
        log.warn(`渠道 "${channelId}" 未注册 Provider 工厂，跳过`);
        continue;
      }

      try {
        const provider = factory();
        await provider.initialize(config);
        this.channels.set(channelId, provider);
        this.configs.set(channelId, config);
        log.info(`渠道 "${channelId}" 初始化完成`);
      } catch (err) {
        log.error({ channelId, error: String(err) }, `渠道 "${channelId}" 初始化失败`);
        this.emit('channel:error', channelId, err);
      }
    }

    log.info(`${this.channels.size} 个渠道初始化完成`);
  }

  // ══════════════════════════════════════════════════════════════
  // 启动/停止
  // ══════════════════════════════════════════════════════════════

  /**
   * 启动所有已初始化的渠道
   */
  async startAll(): Promise<void> {
    if (this.started) {
      log.warn('渠道管理器已经启动');
      return;
    }

    log.info(`正在启动 ${this.channels.size} 个渠道...`);

    const startPromises: Promise<void>[] = [];

    for (const [channelId, provider] of this.channels) {
      const context = this.createContext(channelId);
      this.contexts.set(channelId, context);

      startPromises.push(
        provider.start(context).catch((err: unknown) => {
          log.error({ channelId, error: String(err) }, `渠道 "${channelId}" 启动失败`);
          this.emit('channel:error', channelId, err);
        }),
      );
    }

    await Promise.allSettled(startPromises);
    this.started = true;

    const connectedCount = Array.from(this.channels.values())
      .filter((p) => p.getStatus().isRunning).length;

    log.info(`${connectedCount}/${this.channels.size} 个渠道启动完成`);
    this.emit('manager:started', { total: this.channels.size, connected: connectedCount });
  }

  /**
   * 启动单个渠道
   *
   * @param channelId - 渠道 ID
   */
  async startChannel(channelId: string): Promise<void> {
    const provider = this.channels.get(channelId);
    if (!provider) throw new Error(`渠道 "${channelId}" 未初始化`);

    const context = this.createContext(channelId);
    this.contexts.set(channelId, context);

    await provider.start(context);
    log.info(`渠道 "${channelId}" 已启动`);
  }

  /**
   * 停止所有渠道
   */
  async stopAll(): Promise<void> {
    if (!this.started) return;

    log.info('正在停止所有渠道...');

    const stopPromises: Promise<void>[] = [];

    for (const [channelId, provider] of this.channels) {
      stopPromises.push(
        provider.stop().catch((err: unknown) => {
          log.error({ channelId, error: String(err) }, `渠道 "${channelId}" 停止失败`);
        }),
      );
    }

    await Promise.allSettled(stopPromises);
    this.started = false;

    log.info('所有渠道已停止');
    this.emit('manager:stopped');
  }

  /**
   * 停止单个渠道
   *
   * @param channelId - 渠道 ID
   */
  async stopChannel(channelId: string): Promise<void> {
    const provider = this.channels.get(channelId);
    if (!provider) throw new Error(`渠道 "${channelId}" 未找到`);

    await provider.stop();
    this.contexts.delete(channelId);
    log.info(`渠道 "${channelId}" 已停止`);
  }

  // ══════════════════════════════════════════════════════════════
  // 消息处理
  // ══════════════════════════════════════════════════════════════

  /**
   * 处理来自渠道的入站消息
   *
   * @param message - 归一化后的入站消息
   */
  private async handleInboundMessage(message: InboundMessage): Promise<void> {
    const { channelId } = message;

    // 更新统计
    const provider = this.channels.get(channelId);
    if (provider) {
      const status = provider.getStatus();
      status.stats.messagesReceived++;
    }

    // 路由消息到 Agent
    if (this.onRouteMessage) {
      try {
        await this.onRouteMessage(message);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        log.error({ channelId, error: error.message }, `渠道 "${channelId}" 消息路由失败`);
        this.onErrorCallback?.(error, channelId);
      }
    }

    this.emit('channel:message', message);
  }

  /**
   * 发送消息到指定渠道
   *
   * @param channelId - 目标渠道 ID
   * @param target - 消息目标
   * @param message - 出站消息
   * @returns 发送结果
   */
  async sendToChannel(
    channelId: string,
    target: MessageTarget,
    message: OutboundMessage,
  ): Promise<SendMessageResult> {
    const provider = this.channels.get(channelId);

    if (!provider) {
      return {
        success: false,
        timestamp: Date.now(),
        error: `渠道 "${channelId}" 未找到或未启动`,
      };
    }

    const status = provider.getStatus();
    if (!status.isRunning) {
      return {
        success: false,
        timestamp: Date.now(),
        error: `渠道 "${channelId}" 未运行 (当前状态: ${status.state})`,
      };
    }

    return provider.sendMessage(target, message);
  }

  /**
   * 向渠道广播消息（给所有已连接渠道的所有用户）
   */
  async broadcastToAll(message: OutboundMessage): Promise<Map<string, SendMessageResult>> {
    const results = new Map<string, SendMessageResult>();

    for (const [channelId, provider] of this.channels) {
      const status = provider.getStatus();
      if (!status.isRunning) continue;

      const target: MessageTarget = { chatType: 'private' };
      try {
        const result = await provider.sendMessage(target, message);
        results.set(channelId, result);
      } catch (err: unknown) {
        results.set(channelId, {
          success: false,
          timestamp: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  // ══════════════════════════════════════════════════════════════
  // 状态查询
  // ══════════════════════════════════════════════════════════════

  /**
   * 获取所有渠道状态
   */
  getAllStatus(): ChannelStatus[] {
    return Array.from(this.channels.values()).map((p) => p.getStatus());
  }

  /**
   * 获取单个渠道状态
   */
  getChannelStatus(channelId: string): ChannelStatus | null {
    const provider = this.channels.get(channelId);
    return provider?.getStatus() ?? null;
  }

  /**
   * 获取运行中的渠道列表
   */
  getRunningChannels(): ChannelProvider[] {
    return Array.from(this.channels.values()).filter(
      (p) => p.getStatus().isRunning,
    );
  }

  /**
   * 获取所有已注册的渠道 ID 列表
   */
  getAllChannelIds(): string[] {
    return Array.from(this.channels.keys());
  }

  /**
   * 检查管理器是否已启动
   */
  isStarted(): boolean {
    return this.started;
  }

  // ══════════════════════════════════════════════════════════════
  // 健康检查
  // ══════════════════════════════════════════════════════════════

  /**
   * 对所有渠道执行健康检查
   */
  async healthCheckAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const [channelId, provider] of this.channels) {
      try {
        const healthy = provider.healthCheck
          ? await provider.healthCheck()
          : provider.getStatus().isRunning;
        results.set(channelId, healthy);
      } catch {
        results.set(channelId, false);
      }
    }

    return results;
  }

  // ══════════════════════════════════════════════════════════════
  // 内部方法
  // ══════════════════════════════════════════════════════════════

  /**
   * 创建渠道运行上下文
   */
  private createContext(channelId: string): ChannelContext {
    const channelLogger: ChannelLogger = {
      debug: (msg: string, ...args: unknown[]) => log.debug({ channelId, extra: args }, msg),
      info: (msg: string, ...args: unknown[]) => log.info({ channelId, extra: args }, msg),
      warn: (msg: string, ...args: unknown[]) => log.warn({ channelId, extra: args }, msg),
      error: (msg: string, ...args: unknown[]) => log.error({ channelId, extra: args }, msg),
    };

    return {
      onMessage: (message: InboundMessage) => {
        this.handleInboundMessage(message).catch((err) => {
          log.error({ channelId, error: err }, '处理入站消息失败');
        });
      },

      onError: (error: Error, chId: string) => {
        log.error({ channelId: chId, error: error.message }, '渠道错误');
        this.onErrorCallback?.(error, chId);
        this.emit('channel:error', chId, error);
      },

      onStateChange: (chId: string, newState: ChannelLifecycleState, oldState: ChannelLifecycleState) => {
        log.info({ channelId: chId, oldState, newState }, '渠道状态变更');
        this.emit('channel:stateChange', chId, newState, oldState);
      },

      logger: channelLogger,
    };
  }
}
