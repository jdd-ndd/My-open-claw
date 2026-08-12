/**
 * WebSocket 连接存储管理
 *
 * 负责维护 connectionId 到 WebSocket 的映射，以及各连接的渠道/用户元数据。
 * 提供类型安全的增删改查与遍历能力，是高并发连接管理的基础组件。
 *
 * @module @myopenclaw/server/gateway/server
 */

import type { WebSocket } from 'ws';

/**
 * 连接元数据
 */
export interface ConnectionMetadata {
  /** 渠道 ID */
  channelId: string;
  /** 用户 ID */
  userId: string;
  sessionId?: string;
}

/**
 * 连接存储
 *
 * 封装 Map 操作，统一维护 connections 与 metadata 的一致性，
 * 避免在多个模块中重复操作两份数据结构。
 */
export class ConnectionStore {
  /** 活跃连接映射（connectionId → WebSocket） */
  private connections = new Map<string, WebSocket>();

  /** 各连接绑定渠道信息（用于状态上报） */
  private metadata = new Map<string, ConnectionMetadata>();

  /**
   * 当前活跃连接数
   */
  get size(): number {
    return this.connections.size;
  }

  /**
   * 添加新连接
   */
  add(connectionId: string, socket: WebSocket, meta: ConnectionMetadata): void {
    this.connections.set(connectionId, socket);
    this.metadata.set(connectionId, meta);
  }

  /**
   * 获取指定连接的 WebSocket 实例
   */
  get(connectionId: string): WebSocket | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * 获取指定连接的元数据
   */
  getMetadata(connectionId: string): ConnectionMetadata | undefined {
    return this.metadata.get(connectionId);
  }

  /**
   * 判断指定连接是否存在
   */
  has(connectionId: string): boolean {
    return this.connections.has(connectionId);
  }

  /**
   * 更新指定连接的元数据
   */
  setMetadata(connectionId: string, meta: ConnectionMetadata): void {
    if (this.connections.has(connectionId)) {
      this.metadata.set(connectionId, meta);
    }
  }

  /**
   * 删除指定连接及其元数据
   */
  delete(connectionId: string): void {
    this.connections.delete(connectionId);
    this.metadata.delete(connectionId);
  }

  /**
   * 清空所有连接与元数据
   */
  clear(): void {
    this.connections.clear();
    this.metadata.clear();
  }

  /**
   * 遍历所有连接
   */
  entries(): IterableIterator<[string, WebSocket]> {
    return this.connections.entries();
  }

  /**
   * 获取连接元数据列表（供 HTTP /status、/connections 使用）
   */
  getMetadataList(): Array<{ connectionId: string; channelId: string; userId: string }> {
    const list: Array<{ connectionId: string; channelId: string; userId: string }> = [];
    for (const [id, meta] of this.metadata) {
      list.push({ connectionId: id, channelId: meta.channelId, userId: meta.userId });
    }
    return list;
  }

  getConnectionIdsBySession(sessionId: string): string[] {
    const list: string[] = [];
    for (const [connectionId, meta] of this.metadata) {
      if (meta.sessionId === sessionId) {
        list.push(connectionId);
      }
    }
    return list;
  }

  /**
   * 获取指定渠道下的所有连接 ID（用于跨端会话变更广播）
   *
   * 跨端同步场景：同 channelId 下的所有连接都属于同一会话空间，
   * 任何一端创建/修改/删除会话时，需要通知同 channel 下所有其他端。
   *
   * @param channelId 渠道 ID
   * @param excludeConnectionIds 可选，需排除的连接 ID 集合（避免重复发送）
   */
  getConnectionIdsByChannel(channelId: string, excludeConnectionIds?: Set<string>): string[] {
    const list: string[] = [];
    for (const [connectionId, meta] of this.metadata) {
      if (meta.channelId !== channelId) continue;
      if (excludeConnectionIds && excludeConnectionIds.has(connectionId)) continue;
      list.push(connectionId);
    }
    return list;
  }
}
