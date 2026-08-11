/**
 * 会话与 Agent 类型
 */

import type { ConnectionState } from './ui.js';

export interface Session {
  id: string;
  title: string;
  createdAt?: number;
  updatedAt?: number;
  messageCount?: number;
}

export interface AgentInfo {
  id: string;
  name: string;
  enabled: boolean;
  model: string;
  status: 'idle' | 'busy' | 'error';
}

export interface ConnectionInfo {
  state: ConnectionState;
  endpoint?: string;
  latencyMs?: number;
  lastError?: string;
}
