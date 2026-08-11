import { wsClient } from './gateway';

export interface GatewayHistoryMessage {
  messageId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface GatewayHistoryResponse {
  sessionId: string;
  messages: GatewayHistoryMessage[];
  hasMore: boolean;
  total: number;
  offset: number;
  limit: number;
}

export async function fetchChatHistory(sessionId: string, offset = 0, limit = 100): Promise<GatewayHistoryResponse> {
  return wsClient.request<GatewayHistoryResponse>('chat.history', {
    sessionId,
    offset,
    limit,
  });
}
