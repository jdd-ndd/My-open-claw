import { httpClient } from './http';

export interface MemorySessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  timestamp: number;
  compressed?: boolean;
}

export interface MemorySessionDetail {
  sessionId: string;
  userId: string;
  channelId: string;
  agentId: string;
  metadata: {
    createdAt: number;
    lastActiveAt: number;
    messageCount: number;
    compressed: boolean;
  };
  taskState: Record<string, unknown> | null;
  messages: MemorySessionMessage[];
}

export interface MemorySessionResponse {
  ok: boolean;
  data: MemorySessionDetail;
}

export async function getMemorySession(sessionId: string): Promise<MemorySessionDetail> {
  return httpClient.get(`/memory/sessions/${sessionId}`) as Promise<MemorySessionDetail>;
}
