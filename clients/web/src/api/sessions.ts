import type { Session } from '@/types/session';
import { httpClient } from './http';

export interface SessionListResponse {
  total: number;
  sessions: Session[];
  activeSessionCount?: number;
}

export async function listSessions(params?: { channelId?: string; userId?: string; includeClosed?: boolean }): Promise<SessionListResponse> {
  return httpClient.get('/sessions', { params }) as Promise<SessionListResponse>;
}

export async function createSession(payload: {
  agentId: string;
  channelId: string;
  userId: string;
  title?: string;
}): Promise<Session> {
  return httpClient.post('/sessions', payload) as Promise<Session>;
}

export async function getSession(sessionId: string): Promise<Session> {
  return httpClient.get(`/sessions/${sessionId}`) as Promise<Session>;
}

export async function updateSession(sessionId: string, payload: Partial<Pick<Session, 'title' | 'pinnedAt' | 'status' | 'metadata'>>): Promise<Session> {
  const normalizedPayload = {
    ...payload,
    pinnedAt: typeof payload.pinnedAt === 'string' ? new Date(payload.pinnedAt).getTime() : payload.pinnedAt,
  };
  return httpClient.patch(`/sessions/${sessionId}`, normalizedPayload) as Promise<Session>;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await httpClient.delete(`/sessions/${sessionId}`);
}
