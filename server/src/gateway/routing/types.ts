/**
 * Gateway Routing 模块类型定义
 *
 * 定义消息路由所需的路由规则和路由结果等核心类型。
 * 标准化消息和会话类型已移至 gateway/sessions 模块。
 *
 * @module @myopenclaw/server/gateway/routing
 */

import type { NormalizedMessage, Session } from '../sessions/types.js';

/**
 * 路由规则结构体
 *
 * 每条规则定义了将特定渠道/用户/内容的消息路由到指定 Agent 的条件。
 * 规则按 priority 升序匹配，数字越小优先级越高。
 */
export interface RoutingRule {
  /** 规则唯一 ID */
  id: string;
  /** 优先级（数字越小越优先） */
  priority: number;
  /** 匹配的渠道 ID（'*' 表示匹配所有渠道） */
  channelId: string;
  /** 匹配的用户 ID 列表（'*' 表示匹配所有用户） */
  userIds: string[];
  /** 可选的内容正则模式匹配 */
  contentPattern?: string;
  /** 目标 Agent ID */
  agentId: string;
  /** 规则是否启用 */
  enabled: boolean;
}

/**
 * 路由结果结构体
 *
 * 路由匹配完成后返回的结果，包含匹配状态、目标 Agent ID、
 * 关联的会话和标准化消息等完整上下文。
 */
export interface RouteResult {
  /** 是否成功匹配到路由规则 */
  matched: boolean;
  /** 匹配到的目标 Agent ID（未匹配时为 undefined） */
  agentId?: string;
  /** 当前会话（新建或已有） */
  session?: Session;
  /** 标准化后待分发的消息 */
  message?: NormalizedMessage;
  /** 未匹配时的原因说明 */
  reason?: string;
}

// 从 sessions 模块重导出，方便 routing 的使用方
export type { NormalizedMessage } from '../sessions/types.js';
export type { Session } from '../sessions/types.js';
