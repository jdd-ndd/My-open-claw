/**
 * ReconnectManager 单元测试
 *
 * @module server/tests/unit/channels
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReconnectManager } from '../../../src/channels/reconnect.js';
import type { Reconnectable } from '../../../src/channels/reconnect.js';

/** 创建模拟的可重连对象 */
function createMockReconnectable(
  id: string,
  reconnectBehavior: 'success' | 'fail' | 'switch' = 'success',
): Reconnectable {
  let attemptCount = 0;
  return {
    id,
    async reconnect(): Promise<boolean> {
      attemptCount++;
      if (reconnectBehavior === 'switch') {
        return attemptCount <= 2 ? false : true;
      }
      return reconnectBehavior === 'success';
    },
  };
}

describe('ReconnectManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('应该创建实例', () => {
    const provider = createMockReconnectable('test');
    const manager = new ReconnectManager(provider, {
      enabled: true,
      maxAttempts: 5,
      initialInterval: 1000,
      maxInterval: 10000,
      backoffFactor: 2,
    });
    expect(manager).toBeDefined();
    expect(manager.attemptCount).toBe(0);
    expect(manager.isActive).toBe(false);
  });

  it('禁用时不应执行重连', () => {
    const provider = createMockReconnectable('test', 'fail');
    const manager = new ReconnectManager(provider, {
      enabled: false,
      maxAttempts: 5,
      initialInterval: 1000,
      maxInterval: 10000,
      backoffFactor: 2,
    });

    manager.start();
    expect(manager.isActive).toBe(false);
  });

  it('应该在指定间隔后执行重连', async () => {
    const provider = createMockReconnectable('test', 'success');
    const manager = new ReconnectManager(provider, {
      enabled: true,
      maxAttempts: 5,
      initialInterval: 1000,
      maxInterval: 10000,
      backoffFactor: 2,
    });
    const onSuccess = vi.fn();
    manager.setOnSuccess(onSuccess);

    manager.start();
    expect(manager.isActive).toBe(true);

    // 快进时间触发重连
    await vi.advanceTimersByTimeAsync(1000);

    expect(onSuccess).toHaveBeenCalledOnce();
    expect(manager.attemptCount).toBe(0); // 成功后重置
    expect(manager.isActive).toBe(false);
  });

  it('失败时应递增重连次数并继续重试', async () => {
    const provider = createMockReconnectable('test', 'fail');
    const onGiveUp = vi.fn();
    const manager = new ReconnectManager(provider, {
      enabled: true,
      maxAttempts: 3,
      initialInterval: 1000,
      maxInterval: 10000,
      backoffFactor: 2,
    });
    manager.setOnGiveUp(onGiveUp);

    manager.start();
    expect(manager.isActive).toBe(true);
    expect(manager.attemptCount).toBe(1);

    // 第一次重试（1000ms）
    await vi.advanceTimersByTimeAsync(1000);
    expect(manager.attemptCount).toBe(2);

    // 第二次重试（2000ms）
    await vi.advanceTimersByTimeAsync(2000);
    expect(manager.attemptCount).toBe(3);

    // 第三次重试（4000ms）→ 达到最大次数
    await vi.advanceTimersByTimeAsync(4000);
    expect(onGiveUp).toHaveBeenCalledOnce();
    expect(manager.isActive).toBe(false);
  });

  it('stop 应该停止所有重连', () => {
    const provider = createMockReconnectable('test', 'fail');
    const manager = new ReconnectManager(provider, {
      enabled: true,
      maxAttempts: 10,
      initialInterval: 1000,
      maxInterval: 30000,
      backoffFactor: 2,
    });

    manager.start();
    expect(manager.isActive).toBe(true);

    manager.stop();
    expect(manager.isActive).toBe(false);
    expect(manager.attemptCount).toBe(0);
  });

  it('重连成功后应重置计数器', async () => {
    const provider = createMockReconnectable('success', 'success');
    const onSuccess = vi.fn();
    const manager = new ReconnectManager(provider, {
      enabled: true,
      maxAttempts: 5,
      initialInterval: 1000,
      maxInterval: 10000,
      backoffFactor: 2,
    });
    manager.setOnSuccess(onSuccess);

    manager.start();
    expect(manager.attemptCount).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(manager.attemptCount).toBe(0); // 成功后重置
    expect(manager.isActive).toBe(false);
  });
});
