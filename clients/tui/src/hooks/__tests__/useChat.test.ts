/**
 * useChat Hook 单元测试
 *
 * 覆盖范围:
 * 1. chat.delta 累加到 streamingContent
 * 2. chat.reasoning_delta 累加到 reasoningContent + 触发 reasoningStartedAt
 * 3. chat.delta 与 chat.reasoning_delta 任意顺序交错都能正确落定
 * 4. chat.done 把 streamingContent 落定为 ChatMessage(附 reasoning + duration)
 * 5. chat.done 携带的 totalReasoning 优先于客户端累加的 reasoningContent
 *    (server 给的是权威值)
 * 6. 没有任何 chat.reasoning_delta 时,落定消息的 reasoning 为 undefined
 * 7. clear() 干净重置所有 state(TDZ 修复验证)
 * 8. maxMessages 截断(超过上限时丢弃最早的)
 * 9. cancelStream 清空 activeStream 与 streamingContent
 * 10. 订阅生命周期:hook 卸载时 off 被调用
 * 11. chat.error 写系统错误消息并清空流
 *
 * 设计:
 * - onEvent 注入一个 let 变量 captured,这样测试在 hook 挂载后可以拿到当前 handler
 * - 配合 vi.useFakeTimers 让 reasoningStartedAt 差异可断言
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChat } from '../useChat.js';
import type { EventMessage } from '../../types/message.js';
import type { ChatMessage } from '../../types/ui.js';

// ─── 测试工具 ─────────────────────────────────────────────

/**
 * 构造一个 onEvent 注入器
 *  - 把 handler 存到 captured 闭包
 *  - off 是 noop(我们自己管 cleanup)
 *  - 测试通过 captured(e) 主动推 server 事件
 */
function makeSubscriber(): {
  captured: { current: (e: EventMessage) => void };
  offSpy: ReturnType<typeof vi.fn>;
  /** 给 useChat 用的 onEvent 注入函数 */
  onEvent: (h: (e: EventMessage) => void) => () => void;
} {
  const obj = {
    captured: { current: (_e: EventMessage) => undefined },
    offSpy: vi.fn(),
    onEvent: (_h: (e: EventMessage) => void) => {
      // 这个函数会在 useEffect 里被调用,我们用 ref 替换
      return () => undefined;
    },
  };
  // 实际上 onEvent 每次会拿到新 handler,我们用 ref 模式
  obj.onEvent = (h: (e: EventMessage) => void) => {
    obj.captured.current = h;
    return () => {
      obj.offSpy();
    };
  };
  return obj;
}

/** 构造一个可注入的 request,默认返回 success */
function makeFakeRequest(impl?: (action: string, payload: unknown) => Promise<unknown>) {
  return vi.fn(async (action: string, payload: unknown) => {
    if (impl) return impl(action, payload);
    if (action === 'chat.send') {
      return { matched: true, sessionId: 'sess-1', agentId: 'default' };
    }
    if (action === 'chat.history') {
      return {
        sessionId: 'sess-1',
        messages: [],
        hasMore: false,
        total: 0,
        offset: 0,
        limit: 20,
      };
    }
    if (action === 'chat.cancel') return { ok: true };
    return { ok: true };
  });
}

function makeEvent(name: string, payload: Record<string, unknown>): EventMessage {
  return {
    type: 'event',
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    event: name,
    payload,
  };
}

// ─── 测试 ─────────────────────────────────────────────────

describe('hooks/useChat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // 1) chat.delta 累加
  it('chat.delta 累加到 streamingContent', async () => {
    const sub = makeSubscriber();
    const request = makeFakeRequest();
    const { result } = renderHook(() =>
      useChat({
        request: request as never,
        onEvent: sub.onEvent,
      }),
    );
    const emit = (e: EventMessage) => sub.captured.current(e);

    // 先发一条消息启动 activeStream(hook 的 chat.delta 守卫要求 activeStream 存在)
    await act(async () => {
      await result.current.sendMessage('hi');
    });
    expect(result.current.activeStream).not.toBeNull();

    act(() => {
      emit(makeEvent('chat.delta', { sessionId: 's1', delta: '你好' }));
    });
    expect(result.current.streamingContent).toBe('你好');

    act(() => {
      emit(makeEvent('chat.delta', { sessionId: 's1', delta: ',世界' }));
    });
    expect(result.current.streamingContent).toBe('你好,世界');

    // accumulated 优先
    act(() => {
      emit(makeEvent('chat.delta', { sessionId: 's1', delta: '!', accumulated: '你好,世界!' }));
    });
    expect(result.current.streamingContent).toBe('你好,世界!');
  });

  // 2) chat.reasoning_delta 累加 + reasoningStartedAt
  it('chat.reasoning_delta 累加到 reasoningContent 并触发 reasoningStartedAt', () => {
    const sub = makeSubscriber();
    const request = makeFakeRequest();
    const { result } = renderHook(() =>
      useChat({
        request: request as never,
        onEvent: sub.onEvent,
      }),
    );
    const emit = (e: EventMessage) => sub.captured.current(e);

    act(() => {
      emit(makeEvent('chat.reasoning_delta', { sessionId: 's1', delta: '我需要' }));
    });
    expect(result.current.reasoningContent).toBe('我需要');
    expect(result.current.reasoningStartedAt).toBeTypeOf('number');

    const startedAt1 = result.current.reasoningStartedAt!;
    act(() => {
      vi.advanceTimersByTime(50);
      emit(makeEvent('chat.reasoning_delta', { sessionId: 's1', delta: '思考一下' }));
    });
    expect(result.current.reasoningContent).toBe('我需要思考一下');
    // reasoningStartedAt 是首条 reasoning 事件触发的时间,后续事件不应改写
    expect(result.current.reasoningStartedAt).toBe(startedAt1);
  });

  // 3) reasoning 与 answer 任意顺序交错
  it('chat.delta 与 chat.reasoning_delta 任意顺序交错,落定时都正确归属', async () => {
    const sub = makeSubscriber();
    const request = makeFakeRequest();
    const { result } = renderHook(() =>
      useChat({
        request: request as never,
        onEvent: sub.onEvent,
      }),
    );
    const emit = (e: EventMessage) => sub.captured.current(e);

    // 先发消息启动 activeStream(chat.delta 守卫要求)
    await act(async () => {
      await result.current.sendMessage('hi');
    });

    // 模拟真实顺序:reasoning 先来一截,answer 中间夹,reasoning 又来,最后都 done
    act(() => {
      emit(makeEvent('chat.reasoning_delta', { sessionId: 's1', delta: '先想' }));
      emit(makeEvent('chat.delta', { sessionId: 's1', delta: '答: ' }));
      emit(makeEvent('chat.reasoning_delta', { sessionId: 's1', delta: '再想' }));
      emit(makeEvent('chat.delta', { sessionId: 's1', delta: '你好' }));
    });
    expect(result.current.reasoningContent).toBe('先想再想');
    expect(result.current.streamingContent).toBe('答: 你好');

    // 落定
    act(() => {
      emit(
        makeEvent('chat.done', {
          sessionId: 's1',
          messageId: 'm-1',
          totalContent: '答: 你好',
          totalReasoning: '先想再想',
          reasoningDurationMs: 200,
          durationMs: 1000,
        }),
      );
    });

    expect(result.current.messages).toHaveLength(2);
    // 第一条是 sendMessage 加的 user,第二条是落定的 assistant
    const m1 = result.current.messages[1]!;
    expect(m1.role).toBe('assistant');
    expect(m1.content).toBe('答: 你好');
    expect(m1.reasoning).toBe('先想再想');
    expect(m1.reasoningDurationMs).toBeGreaterThanOrEqual(0);
    // 流式状态应清空
    expect(result.current.streamingContent).toBe('');
    expect(result.current.reasoningContent).toBe('');
    expect(result.current.reasoningStartedAt).toBeNull();
    expect(result.current.activeStream).toBeNull();
  });

  // 4) chat.done 没收到 reasoning_delta → message.reasoning 为 undefined
  it('无 reasoning_delta 时,落定消息的 reasoning 为 undefined', () => {
    const sub = makeSubscriber();
    const request = makeFakeRequest();
    const { result } = renderHook(() =>
      useChat({
        request: request as never,
        onEvent: sub.onEvent,
      }),
    );
    const emit = (e: EventMessage) => sub.captured.current(e);

    act(() => {
      emit(makeEvent('chat.delta', { sessionId: 's1', delta: '只有正文' }));
      emit(
        makeEvent('chat.done', {
          sessionId: 's1',
          messageId: 'm-2',
          totalContent: '只有正文',
          durationMs: 100,
        }),
      );
    });

    expect(result.current.messages).toHaveLength(1);
    const m = result.current.messages[0]!;
    expect(m.reasoning).toBeUndefined();
    expect(m.reasoningDurationMs).toBeUndefined();
  });

  // 5) totalReasoning(server 给的)优先于客户端累加的 reasoningContent
  it('chat.done.totalReasoning 覆盖客户端累加值(server 权威)', () => {
    const sub = makeSubscriber();
    const request = makeFakeRequest();
    const { result } = renderHook(() =>
      useChat({
        request: request as never,
        onEvent: sub.onEvent,
      }),
    );
    const emit = (e: EventMessage) => sub.captured.current(e);

    act(() => {
      // 客户端累加了不完整片段
      emit(makeEvent('chat.reasoning_delta', { sessionId: 's1', delta: '片段1' }));
      emit(
        makeEvent('chat.done', {
          sessionId: 's1',
          messageId: 'm-3',
          totalContent: '正文',
          // server 给的权威值(可能包含 prefix 等客户端看不见的部分)
          totalReasoning: '[完整思考链]片段1[continuation]',
          reasoningDurationMs: 500,
          durationMs: 800,
        }),
      );
    });

    const m = result.current.messages[0]!;
    expect(m.reasoning).toBe('[完整思考链]片段1[continuation]');
    expect(m.reasoningDurationMs).toBe(500);
  });

  // 6) clear() 完整重置所有 state(验证 TDZ 修复)
  it('clear() 干净重置 messages / activeStream / streamingContent / reasoningContent / 历史状态', async () => {
    const sub = makeSubscriber();
    const request = makeFakeRequest();
    const { result } = renderHook(() =>
      useChat({
        request: request as never,
        onEvent: sub.onEvent,
      }),
    );
    const emit = (e: EventMessage) => sub.captured.current(e);

    // 先发一条 user 消息
    await act(async () => {
      await result.current.sendMessage('测试消息');
    });
    // 推一些流
    act(() => {
      emit(makeEvent('chat.delta', { sessionId: 's1', delta: '回' }));
      emit(makeEvent('chat.reasoning_delta', { sessionId: 's1', delta: '想' }));
    });
    expect(result.current.messages.length).toBeGreaterThanOrEqual(1);
    expect(result.current.streamingContent).toBe('回');
    expect(result.current.reasoningContent).toBe('想');

    // clear
    act(() => {
      result.current.clear();
    });
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.activeStream).toBeNull();
    expect(result.current.streamingContent).toBe('');
    expect(result.current.reasoningContent).toBe('');
    expect(result.current.reasoningStartedAt).toBeNull();
    expect(result.current.lastError).toBeNull();
    // 历史状态也应重置
    expect(result.current.loadingHistory).toBe(false);
    expect(result.current.hasMoreHistory).toBe(false);
    expect(result.current.totalHistoryCount).toBe(0);
    expect(result.current.loadedHistoryCount).toBe(0);
  });

  // 7) maxMessages 截断
  it('maxMessages 截断:超过上限时丢弃最早的消息', () => {
    const sub = makeSubscriber();
    const request = makeFakeRequest();
    const { result } = renderHook(() =>
      useChat({
        request: request as never,
        onEvent: sub.onEvent,
        maxMessages: 3,
      }),
    );
    const emit = (e: EventMessage) => sub.captured.current(e);

    // 推 5 条 done 事件 → 应保留最后 3 条
    for (let i = 0; i < 5; i++) {
      act(() => {
        emit(
          makeEvent('chat.done', {
            sessionId: 's1',
            messageId: `m-${i}`,
            totalContent: `内容 ${i}`,
            durationMs: 100,
          }),
        );
      });
    }
    expect(result.current.messages).toHaveLength(3);
    // 应该是 m-2, m-3, m-4
    expect(result.current.messages.map((m: ChatMessage) => m.id)).toEqual(['m-2', 'm-3', 'm-4']);
  });

  // 8) cancelStream 清空 activeStream + streamingContent
  it('cancelStream 清空 activeStream 与 streamingContent,并发 chat.cancel', async () => {
    const sub = makeSubscriber();
    const request = makeFakeRequest();
    const { result } = renderHook(() =>
      useChat({
        request: request as never,
        onEvent: sub.onEvent,
      }),
    );
    const emit = (e: EventMessage) => sub.captured.current(e);

    await act(async () => {
      await result.current.sendMessage('hi');
    });
    act(() => {
      emit(makeEvent('chat.delta', { sessionId: 's1', delta: '正在写' }));
    });
    expect(result.current.activeStream).not.toBeNull();
    expect(result.current.streamingContent).toBe('正在写');

    act(() => {
      result.current.cancelStream();
    });
    expect(result.current.activeStream).toBeNull();
    expect(result.current.streamingContent).toBe('');
    // cancelStream 用 defaultSessionId(没经过 server 分配),不是 server 返回的 sess-1
    expect(request).toHaveBeenCalledWith('chat.cancel', expect.objectContaining({ sessionId: 'session-local' }), 3_000);
  });

  // 9) 订阅生命周期:hook 卸载时 off 应被调用
  it('hook 卸载时 onEvent 返回的 off 被调用(避免内存泄漏)', () => {
    const sub = makeSubscriber();
    const request = makeFakeRequest();
    const { unmount } = renderHook(() =>
      useChat({
        request: request as never,
        onEvent: sub.onEvent,
      }),
    );
    expect(sub.offSpy).not.toHaveBeenCalled();
    unmount();
    expect(sub.offSpy).toHaveBeenCalledTimes(1);
  });

  // 10) chat.error 写系统错误消息并清空流
  it('chat.error 写入 [error code] 消息并清空所有流状态', () => {
    const sub = makeSubscriber();
    const request = makeFakeRequest();
    const { result } = renderHook(() =>
      useChat({
        request: request as never,
        onEvent: sub.onEvent,
      }),
    );
    const emit = (e: EventMessage) => sub.captured.current(e);

    act(() => {
      emit(makeEvent('chat.delta', { sessionId: 's1', delta: '部分内容' }));
      emit(
        makeEvent('chat.error', {
          sessionId: 's1',
          code: 'RATE_LIMIT',
          message: '请求太频繁',
        }),
      );
    });

    expect(result.current.messages).toHaveLength(1);
    const errMsg = result.current.messages[0]!;
    expect(errMsg.role).toBe('system');
    expect(errMsg.content).toContain('RATE_LIMIT');
    expect(errMsg.content).toContain('请求太频繁');
    expect(result.current.lastError).toContain('RATE_LIMIT');
    expect(result.current.activeStream).toBeNull();
    expect(result.current.streamingContent).toBe('');
    expect(result.current.reasoningContent).toBe('');
  });
});
