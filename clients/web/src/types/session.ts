export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinnedAt?: string | null;
  status: 'active' | 'idle' | 'closed';
  channelId?: string;
  userId?: string;
  agentId?: string;
  modelId?: string;
  metadata?: Record<string, unknown>;
}
