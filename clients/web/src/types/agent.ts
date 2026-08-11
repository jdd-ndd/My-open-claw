export type AgentStatus = 'idle' | 'thinking' | 'tool_calling' | 'streaming' | 'error';

export interface ToolCall {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  startTime: string;
  endTime?: string;
  result?: unknown;
  status: 'pending' | 'running' | 'success' | 'error';
}

export interface AgentState {
  status: AgentStatus;
  activeToolCalls: ToolCall[];
  currentModel: string;
  statusSince: string;
}
