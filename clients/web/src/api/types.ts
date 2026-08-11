import type { GatewayMessage } from '@/types/gateway';

export interface ChatDeltaEvent {
  sessionId: string;
  delta: string;
  accumulated: string;
  reasoning?: string;
}

export interface ChatDoneEvent {
  sessionId: string;
  messageId: string;
  totalContent: string;
  totalReasoning?: string;
  reasoningDurationMs?: number;
  durationMs: number;
  error?: boolean;
}

export type WsEventHandler<T = unknown> = (event: GatewayMessage<T>) => void;
