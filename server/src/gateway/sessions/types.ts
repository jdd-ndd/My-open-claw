export interface MessageAttachment {
  type: 'image' | 'file' | 'audio' | 'video';
  url: string;
  filename?: string;
  size?: number;
  mimeType?: string;
}

export interface NormalizedMessage {
  messageId: string;
  sessionId?: string;
  channelId: string;
  userId: string;
  userName?: string;
  content: string;
  messageType: 'text' | 'image' | 'file' | 'audio' | 'video';
  attachments?: MessageAttachment[];
  raw: unknown;
  timestamp: number;
}

export interface Session {
  sessionId: string;
  channelId: string;
  userId: string;
  agentId: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number;
  pinnedAt?: number | null;
  status: 'active' | 'idle' | 'closed';
  messageIds: string[];
  metadata?: Record<string, unknown>;
}
