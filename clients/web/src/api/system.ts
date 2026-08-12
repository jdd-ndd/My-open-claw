import { httpClient } from './http';

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy' | string;
  components?: Record<string, string>;
  uptime?: number;
}

export interface SystemStatusResponse {
  status: string;
  serverTime: string;
  serverTimestamp: number;
  uptime: number;
  connectionCount: number;
  maxConnections: number;
  activeSessions: number;
  ruleCount: number;
  host: string;
  port: number;
  version: string;
  memoryUsage?: {
    rss?: number;
    heapTotal?: number;
    heapUsed?: number;
    external?: number;
    arrayBuffers?: number;
  };
  channels: number;
  agents: Array<{
    agentId: string;
    status: string;
    lastActiveAt?: string;
    stats?: Record<string, unknown>;
  }>;
}

export interface AgentsResponse {
  total: number;
  agents: Array<{
    agentId: string;
    status: string;
    lastActiveAt?: string;
    stats?: Record<string, unknown>;
  }>;
}

export interface SchedulerTasksResponse {
  total: number;
  tasks: Array<Record<string, unknown>>;
}

export async function fetchHealth(): Promise<HealthResponse> {
  return httpClient.get('/health') as Promise<HealthResponse>;
}

export async function fetchSystemStatus(): Promise<SystemStatusResponse> {
  return httpClient.get('/status') as Promise<SystemStatusResponse>;
}

export async function fetchAgents(): Promise<AgentsResponse> {
  return httpClient.get('/agents') as Promise<AgentsResponse>;
}

export async function fetchSchedulerTasks(): Promise<SchedulerTasksResponse> {
  return httpClient.get('/scheduler/tasks') as Promise<SchedulerTasksResponse>;
}
