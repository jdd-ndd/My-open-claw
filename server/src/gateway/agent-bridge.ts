/**
 * AgentBridge 鈥斺€?Gateway 鈫?Agent Runtime 妗ユ帴灞?*
 * 瀹炵幇 IAgentInvoker 鎺ュ彛锛屽皢缃戝叧鐨勬秷鎭浆鍙戝埌 Agent Runtime銆?
 * 闆嗘垚 CircuitBreaker 淇濇姢涓嬫父璋冪敤锛岃秴鏃跺拰閲嶈瘯鐢?GatewayServer 灞傞潰鎺у埗銆?
 *
 * @module @myopenclaw/server/gateway
 */

import type { Message } from '../core/types/message.js';
import { createLogger } from '../core/utils/logger.js';
import { CircuitBreaker, CircuitOpenError } from './security/circuit-breaker.js';
import type { AuditLogger } from './audit/index.js';
import type { StateManager } from './state/index.js';
import type { SessionManager } from './sessions/index.js';
import type { IAgentInvoker, AgentInvokeParams, AgentInvokeResult } from './types/api.js';
import type { Messenger } from './server/messaging.js';

const log = createLogger('gateway:agent-bridge');

/** Agent Runtime 鎺ュ彛锛堜緷璧栨敞鍏ワ級 */
export interface AgentRuntime {
  /** 澶勭悊娑堟伅 */
  processMessage(message: Message): Promise<Message>;
  /** 鍒涘缓浼氳瘽 */
  createSession?(params: {
    agentId: string;
    model?: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<unknown>;
  /** 鍏抽棴浼氳瘽 */
  closeSession?(sessionId: string): Promise<void>;
  /** 鑾峰彇 Agent 鐘舵€?*/
  getStatus?(): Promise<unknown>;
}

/** AgentBridge 閰嶇疆 */
export interface AgentBridgeConfig {
  /** 调用超时（毫秒），默认 180000（3分钟） */
  timeout: number;
  /** 熔断器配置 */
  circuitBreaker?: {
    failureThreshold?: number;
    cooldownMs?: number;
  };
}

const DEFAULT_CONFIG: AgentBridgeConfig = {
  // 默认 3 分钟：覆盖 Agent 六阶段循环（感知→思考→规划→执行→观察→反思）
  // 单次 LLM 调用可能 5-15 秒，多轮 ReAct 循环 + 工具执行（如 exec/shell）需更长时间
  timeout: 180_000,
};

export class AgentBridge implements IAgentInvoker {
  private readonly config: AgentBridgeConfig;
  private readonly breaker: CircuitBreaker;
  private agentRuntime: AgentRuntime | null = null;
  /** 跨端消息广播器（可选，用于将外部渠道消息推送到 Web 端监控会话） */
  private readonly messenger?: Messenger;

  constructor(
    private readonly audit: AuditLogger,
    private readonly stateManager: StateManager,
    private readonly sessions: SessionManager,
    config?: Partial<AgentBridgeConfig>,
    messenger?: Messenger,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.messenger = messenger;
    this.breaker = new CircuitBreaker('agent-runtime', {
      failureThreshold: this.config.circuitBreaker?.failureThreshold ?? 5,
      cooldownMs: this.config.circuitBreaker?.cooldownMs ?? 30_000,
    });

    this.breaker.on('stateChange', ({ newState }) => {
      log.warn({ breakerState: newState }, 'Agent 鐔旀柇鍣ㄧ姸鎬佸彉鏇?');
      this.stateManager.updateAgentState('__bridge__', {
        status: newState === 'closed' ? 'idle' : 'error',
        errorMessage: newState !== 'closed' ? `鐔旀柇鍣ㄧ姸鎬? ${newState}` : undefined,
      });
    });
  }

  /**
   * 缁戝畾 Agent Runtime 瀹炰緥
   *
   * 鏀寔鍚屾浼犲叆鎴栧紓姝?Promise(涓?AgentRuntimeAdapter.create() 杩欑
   * 闇€瑕?async 鍒濆鍖栫殑宸ュ巶鏈嶅姟)銆傝嫢浼犲叆 Promise,鍦?resolve 涔嬪墠
   * invoke() 浠嶄細鎶?"AgentRuntime 鏈粦瀹?",杩欐槸棰勬湡琛屼负銆?
   */
  bind(runtime: AgentRuntime | Promise<AgentRuntime>): void {
    if (runtime instanceof Promise) {
      this.agentRuntime = null;
      runtime.then(
        (resolvedRuntime) => {
          this.agentRuntime = resolvedRuntime;
          log.info('AgentBridge 宸茬粦瀹?Agent Runtime(async)');
        },
        (err) => {
          log.error({ err: (err as Error).message }, 'AgentBridge 寮傛缁戝畾澶辫触');
        },
      );
      return;
    }

    this.agentRuntime = runtime;
    log.info('AgentBridge 宸茬粦瀹?Agent Runtime');
  }

  /**
   * 璋冪敤 Agent 澶勭悊娑堟伅
   */
  async invoke(params: AgentInvokeParams): Promise<AgentInvokeResult> {
    const startTime = Date.now();

    if (!this.agentRuntime) {
      throw new Error('Agent runtime is not ready yet. Please restart the gateway or wait for the runtime to finish loading.');
    }

    this.stateManager.updateAgentState(params.agentId, {
      status: 'busy',
      currentSessionId: params.sessionId,
    });

    try {
      const response = await this.breaker.execute(async () => {
        // ── 关键修复：从 Gateway 的 SessionManager 读取会话历史，注入给 Agent ──
        // 解决 Orchestrator 用独立的 sessionMemory 读不到真实历史的问题
        const gatewayHistory = this.extractGatewayHistory(params);

        const msg: Message = {
          id: params.taskId ?? `msg_${Date.now()}`,
          channelId: params.channelId ?? 'internal',
          userId: params.userId ?? 'system',
          sessionId: params.sessionId ?? '',
          agentId: params.agentId,
          type: 'text',
          content: params.message,
          role: 'user',
          timestamp: Date.now(),
          attachments: [],
          metadata: {
            // 注入 Gateway 层持久化的真实会话历史，Orchestrator 优先使用
            gatewayHistory,
          },
        };

        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Agent request timed out after ${this.config.timeout}ms`)), this.config.timeout);
        });

        const result = await Promise.race([
          this.agentRuntime!.processMessage(msg),
          timeoutPromise,
        ]);

        return result;
      });

      const duration = Date.now() - startTime;

      const session = this.sessions.resolve(
        params.channelId ?? 'internal',
        params.userId ?? 'system',
        params.agentId,
        params.sessionId,
      );
      this.sessions.persistMessage(session, {
        messageId: response.id,
        channelId: response.channelId,
        userId: response.userId,
        content: response.content,
        messageType: response.type as 'text',
        raw: { ...response, role: 'assistant', source: 'assistant' },
        timestamp: response.timestamp,
      });
      this.sessions.touch(session.sessionId);

      // ── 跨端同步：将外部渠道（QQBot/飞书/微信）的助手回复推送到 Web 端监控会话 ──
      // Web 端收到 channel.message 事件后，根据 sourceChannel 路由到对应监控会话
      // 只推送外部渠道消息，内部渠道（myopenclaw/webchat/tui）已有 WebSocket 流式推送，无需重复
      if (this.messenger && this.isExternalChannel(params.channelId)) {
        this.messenger.broadcastToChannel('myopenclaw', {
          type: 'event',
          id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: new Date().toISOString(),
          event: 'channel.message',
          payload: {
            sourceChannel: params.channelId,
            sourceUserId: params.userId,
            sourceSessionId: session.sessionId,
            message: {
              role: 'assistant',
              content: response.content,
              messageId: response.id,
              timestamp: response.timestamp,
            },
          },
        });
      }

      this.stateManager.updateAgentState(params.agentId, {
        status: 'idle',
        currentSessionId: undefined,
      });

      this.audit.logEntry({
        category: 'agent',
        event: 'agent.response',
        agentId: params.agentId,
        sessionId: session.sessionId,
        duration,
        success: true,
        details: { contentLength: response.content.length },
      });

      const meta = (response.metadata ?? {}) as {
        reasoningContent?: unknown;
        reasoningDurationMs?: unknown;
      };
      const reasoningContent =
        typeof meta.reasoningContent === 'string' ? meta.reasoningContent : '';
      const reasoningDurationMs =
        typeof meta.reasoningDurationMs === 'number' ? meta.reasoningDurationMs : undefined;

      log.info({
        agentId: params.agentId,
        sessionId: session.sessionId,
        duration,
        responseLength: response.content.length,
        reasoningLength: reasoningContent.length,
      }, 'AgentBridge invoke completed');

      return {
        response: response.content,
        sessionId: session.sessionId,
        tokensUsed: 0,
        duration,
        reasoningContent: reasoningContent || undefined,
        reasoningDurationMs,
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);
      const isCircuitOpen = err instanceof CircuitOpenError;

      this.stateManager.updateAgentState(params.agentId, {
        status: 'error',
        currentSessionId: undefined,
        errorMessage,
      });

      this.audit.logEntry({
        category: 'agent',
        event: isCircuitOpen ? 'agent.circuit_open' : 'agent.error',
        agentId: params.agentId,
        duration,
        success: false,
        error: errorMessage,
        details: { params: params.message.slice(0, 200) },
      });

      log.error(
        { agentId: params.agentId, duration, error: errorMessage },
        'Agent 璋冪敤澶辫触',
      );

      throw err;
    }
  }

  /**
   * 鑾峰彇鐔旀柇鍣ㄧ姸鎬佸揩鐓?
   */
  getBreakerState() {
    return this.breaker.getState();
  }

  /**
   * 閲嶇疆鐔旀柇鍣?
   */
  resetBreaker(): void {
    this.breaker.reset();
  }

  /**
   * 判断是否为外部渠道（需要跨端同步到 Web 监控会话的渠道）
   *
   * 内部渠道（myopenclaw/webchat/tui）已有 WebSocket 流式推送机制，无需重复推送
   * 外部渠道（qqbot/feishu/wechat 等）的消息需要主动推送到 Web 端监控会话
   */
  private isExternalChannel(channelId?: string): boolean {
    if (!channelId) return false;
    const internalChannels = ['myopenclaw', 'webchat', 'tui', 'internal'];
    return !internalChannels.includes(channelId);
  }

  /**
   * 从 Gateway 的 SessionManager 读取真实会话历史，转换为 Orchestrator 可用的 LLMMessage[]
   *
   * 背景：系统原本有两套独立的会话存储，SessionManager(Gateway层/sessions.json) 和
   * Orchestrator.sessionMemory(Agent层/memory目录)，两者互不通信。
   * 导致 LLM 在 phasePerceive 感知阶段读取的是过期或空的历史，出现上下文错乱。
   *
   * 本方法直接从 Gateway 层的真实持久化存储（即前端显示的内容）读取历史，
   * 注入到 Orchestrator，确保 LLM 的上下文与用户看到的完全一致。
   */
  private extractGatewayHistory(params: AgentInvokeParams): { role: 'user' | 'assistant'; content: string }[] {
    try {
      // 如果没有 sessionId，说明是全新会话，无需回填历史
      if (!params.sessionId) return [];

      // 通过 sessions 管理器的底层存储查询该会话的所有历史消息
      const historyRows = this.sessions.getHistory
        ? this.sessions.getHistory(params.sessionId, 50) // 最多取最近50条避免上下文爆炸
        : null;

      // 如果 sessions 暴露了 getHistory 方法直接用
      if (historyRows && Array.isArray(historyRows) && historyRows.length > 0) {
        return (historyRows as { messageType: string; content: string; raw?: { role?: string } }[])
          .map((row) => {
            // 优先使用 raw.role 判断角色，其次根据 messageType 推断
            const role = row.raw?.role === 'assistant' ? 'assistant' : 'user';
            return { role: role as 'user' | 'assistant', content: String(row.content ?? '') };
          })
          .filter((m) => m.content && m.content.trim().length > 0);
      }

      // 兜底：通过 sessions 内部 storage 直接读取（兼容 SessionManager 不暴露 getHistory 的情况）
      const storage = (this.sessions as unknown as { storage?: { list?: (t: string, opt?: { orderBy?: string; limit?: number }) => unknown[] } }).storage;
      if (storage?.list) {
        const rows = storage.list('messages', { orderBy: '+timestamp', limit: 100 }) as { sessionId?: string; messageType?: string; content?: string; raw?: { role?: string } }[];
        if (Array.isArray(rows)) {
          return rows
            .filter((r) => r.sessionId === params.sessionId) // 只取当前会话
            .filter((r) => r.content && r.content.trim().length > 0) // 过滤空消息
            .map((r) => ({
              role: (r.raw?.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
              content: String(r.content),
            }));
        }
      }

      return [];
    } catch (err) {
      // 读取历史失败不要中断主流程，打印日志即可
      log.warn(
        { sessionId: params.sessionId, err: err instanceof Error ? err.message : String(err) },
        '读取 Gateway 会话历史失败，将使用默认空历史',
      );
      return [];
    }
  }
}
