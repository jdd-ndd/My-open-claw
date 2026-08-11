/**
 * TUI 顶层 App 组件
 *
 * 视图模式机:launch → connecting → chat
 * 焦点循环:input → messages → sidebar → input
 *
 * 布局(简化版,目标:Chat 界面更简洁):
 * ┌─────────────────────────────────────────────────┐
 * │ openclaw                          ● connected  │  ← Header(1 行)
 * ├─────────────────────────────────────────────────┤
 * │ ┌─ MessageList (按行虚拟滚动) ─┐                │
 * │ │  You              14:32     │                │
 * │ │  第一行内容                  │                │
 * │ │  ── 14:32 ────────────────  │                │
 * │ │  Assistant       14:33     │                │
 * │ │  ...                        │                │
 * │ │  ⠋ Assistant ... [streaming]│ ← StreamingBubble
 * │ └────────────────────────────┘                 │
 * ├─────────────────────────────────────────────────┤
 * │ > 输入框                                        │  ← InputBox(1 行)
 * ├─────────────────────────────────────────────────┤
 * │ cwd · N msgs · provider/model · [focus hint]   │  ← StatusBar(1 行)
 * └─────────────────────────────────────────────────┘
 *
 * 关键修复(对比上一版):
 * - 删去"Ask anything" 提示框、状态 pill、focus hint 行(冗余信息)
 * - 修 Esc 链:help 关闭 / cancel stream / 退回 launch 三种互斥
 * - 修 LaunchScreen 双 useInput:launch 模式只让 LaunchScreen 自己的 useInput 激活
 * - 修底部跟随(dead code):由 MessageList 自己负责 sticky bottom
 * - 修 focus 状态机:Tab 循环,MessageList 与 InputBox 各自处理键盘
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { color } from '../utils/colors.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useWebSocket } from '../hooks/useWebSocket.js';
import { useChat } from '../hooks/useChat.js';
import type { AgentInfo, ConnectionInfo, Session } from '../types/session.js';
import type { FocusArea, ViewMode } from '../types/ui.js';
import { defaultConfig } from '../config/defaults.js';
import { SHARED_CHANNEL_ID, SHARED_USER_ID } from '../config/sync-defaults.js';
import { HelpPanel } from './HelpPanel.js';
import { InputBox } from './chat/InputBox.js';
import { MessageList, type MessageListHandle } from './chat/MessageList.js';
import { Sidebar } from './sidebar/Sidebar.js';
import { useMouse } from '../hooks/useMouse.js';
import { StatusBar } from './statusbar/StatusBar.js';
import { ReconnectPrompt } from './connection/ReconnectPrompt.js';
import { ErrorBoundary } from './ErrorBoundary.js';

// ---------------------------------------------------------------------------
// 静态配置(目前来自 server / 默认,后续可由 useSession/useAgent 替换)
// ---------------------------------------------------------------------------
const SESSIONS: Session[] = [
  { id: 's1', title: 'Greeting' },
  { id: 's2', title: 'Context' },
  { id: 's3', title: 'Build Debug' },
];

const AGENTS: AgentInfo[] = [
  { id: 'default', name: 'default', enabled: true, model: 'deepseek-v4-pro', status: 'idle' },
];

const CONTEXT_WINDOW = 128_000;
const CONTEXT_USED = 0;
const SPENT = 0;
const CWD = '~/Desktop/myopenclaw';
const CLI_VERSION = 'TUI 1.0.0';

// ─────────────────────────────────────────────────────────────
// 启动页
// ─────────────────────────────────────────────────────────────
interface LaunchScreenProps {
  onHelp: () => void;
  onSubmit: (message: string) => void;
}

const LaunchScreen: React.FC<LaunchScreenProps> = memo(({ onHelp, onSubmit }) => {
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(0);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (trimmed) onSubmit(trimmed);
  }, [input, onSubmit]);

  useInput(
    (value, key) => {
      // 守卫 1:readline 把 ESC 序列的 ESC 剥掉后,key.escape=true
      if (key.escape) return;
      // 守卫 2:value 首字符是 ESC
      if (value && value.charCodeAt(0) === 0x1b) return;
      // 守卫 3:SGR mouse / 未识别 CSI 序列 — value 以 "[<" 开头
      if (value && value.startsWith('[<')) return;
      // 守卫 4:含其他控制字符 / ANSI 序列碎片
      // 放行 \t (0x09) \n (0x0a) \r (0x0d) 三个合法控制字符
      if (value && /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) return;
      if (key.return && !key.shift) {
        handleSend();
        return;
      }
      if (key.return && key.shift) {
        setInput((p) => p.slice(0, cursor) + '\n' + p.slice(cursor));
        setCursor((p) => p + 1);
        return;
      }
      if (key.backspace || key.delete) {
        if (cursor > 0) {
          setInput((p) => p.slice(0, cursor - 1) + p.slice(cursor));
          setCursor((p) => p - 1);
        }
        return;
      }
      if (key.leftArrow) {
        setCursor((p) => Math.max(0, p - 1));
        return;
      }
      if (key.rightArrow) {
        setCursor((p) => Math.min(input.length, p + 1));
        return;
      }
      if (value === '?') {
        onHelp();
        return;
      }
      if (value && !key.ctrl && !key.meta && !key.tab) {
        setInput((p) => p.slice(0, cursor) + value + p.slice(cursor));
        setCursor((p) => p + value.length);
      }
    },
    { isActive: true },
  );

  return (
    <Box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center">
      {[
        '  ╔═══════════════════════════════════════════════════════════════════════════════════╗',
        '  ║      ██╗     ██████╗ ██████╗ ███████╗███╗   ██╗ ██████╗██╗      █████╗ ██╗    ██╗ ║',
        '  ║      ██║    ██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔════╝██║     ██╔══██╗██║    ██║ ║',
        '  ║      ██║    ██║   ██║██████╔╝█████╗  ██╔██╗ ██║██║     ██║     ███████║██║ █╗ ██║ ║',
        '  ║ ██   ██║    ██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║██║     ██║     ██╔══██║██║███╗██║ ║',
        '  ║ ╚█████╔╝    ╚██████╔╝██║     ███████╗██║ ╚████║╚██████╗███████╗██║  ██║╚███╔███╔╝ ║',
        '  ║  ╚════╝      ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝  ║',
        '  ╚═══════════════════════════════════════════════════════════════════════════════════╝',
      ].map((line, i) => (
        <Text key={i} color={color.primary}>
          {line}
        </Text>
      ))}

      <Box marginTop={2} borderStyle="single" borderColor={input ? color.primary : color.muted} paddingX={2} paddingY={1}>
        <Text color={color.primary} bold>
          {'> '}
        </Text>
        <Text color={input ? color.highlight : color.muted}>
          {input || '输入消息,按 Enter 开始对话...'}
        </Text>
        <Text backgroundColor={color.primary} color="black">
          {' '}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color={color.primary}>Sisyphus</Text>
        <Text color={color.muted}> - Ultrabworker  </Text>
        <Text color={color.success}>ready</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={color.muted}>? help  ·  Ctrl+C exit</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={color.muted} dimColor>
          {defaultConfig.gatewayUrl}
        </Text>
      </Box>
    </Box>
  );
});
LaunchScreen.displayName = 'LaunchScreen';

const ConnectingScreen: React.FC<{ gatewayUrl: string }> = memo(({ gatewayUrl }) => (
  <Box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center">
    <Text color={color.primary} bold>
      Connecting to Gateway...
    </Text>
    <Box marginTop={1}>
      <Text color={color.muted} dimColor>
        {gatewayUrl}
      </Text>
    </Box>
    <Box marginTop={1}>
      <Text color={color.muted}>WebSocket handshake in progress</Text>
    </Box>
  </Box>
));
ConnectingScreen.displayName = 'ConnectingScreen';

// ─────────────────────────────────────────────────────────────
// Chat 视图(简化布局)
// ─────────────────────────────────────────────────────────────
interface ChatViewProps {
  focus: FocusArea;
  columns: number;
  rows: number;
  streaming: boolean;
  streamingContent: string;
  streamingReasoning: string;
  messages: ReturnType<typeof useChat>['messages'];
  activeStream: ReturnType<typeof useChat>['activeStream'];
  connection: ConnectionInfo;
  selectedSessionIndex: number;
  onSend: (m: string) => void;
  onCancel: () => void;
  loadingHistory: boolean;
  hasMoreHistory: boolean;
  loadMoreHistory: (limit?: number) => Promise<void>;
  /** imperative handle for mouse wheel / external scroll */
  messageListRef: React.RefObject<MessageListHandle>;
}

const FOCUS_LABEL: Record<FocusArea, string> = {
  input: '输入',
  messages: '消息',
  sidebar: '侧边栏',
};

// ── 终端行号到 MessageList 内容行号的偏移 ──────────────────────
// chat 模式下,从终端顶部到「第一条可见消息内容行」的固定偏移(1-based):
//   row 1          = ChatView padding top
//   row 2          = ChatView Header
//   row 3          = marginBottom=1(空行)
//   row 4          = MessageList 顶部 border
//   row 5          = MessageList 内部 header(History · N msgs)
//   row 6          = 第一条消息内容 ← 这里开始
// 转换公式:contentLine = sgrRow - 6
const MESSAGE_LIST_CONTENT_ROW = 6;

const ChatView: React.FC<ChatViewProps> = memo(
  ({
    focus,
    columns,
    rows,
    streaming,
    streamingContent,
    streamingReasoning,
    messages,
    activeStream,
    connection,
    selectedSessionIndex,
    onSend,
    onCancel,
    loadingHistory,
    hasMoreHistory,
    loadMoreHistory,
    messageListRef,
  }) => {
    const showSidebar = columns > 100;
    // 布局行数(外层):
    //   Header(1) + margin(1) + MessageList(?) + margin(1) + Input(1) + StatusBar(1) + padding(2) = 7
    // MessageList 自己带 border,viewport = 消息区总高 - border 2
    const outerChrome = 1 + 1 + 1 + 1 + 1 + 2; // 7
    const listViewport = Math.max(6, rows - outerChrome);
    const sidebarWidth = 30;
    // main 区域宽度 = 总宽 - 侧边栏 - 间隔 - 消息区自己的 padding
    const mainWidth = Math.max(
      30,
      showSidebar ? columns - sidebarWidth - 3 : columns - 2 /* outer padding */,
    );

    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
        {/* Header(单行,简洁) — 在消息区外 */}
        <Box justifyContent="space-between" marginBottom={1}>
          <Box>
            <Text color={color.muted}>open</Text>
            <Text color={color.highlight}>claw</Text>
            <Text color={color.muted}>  ·  </Text>
            <Text color={color.muted}>{FOCUS_LABEL[focus]}</Text>
          </Box>
          <Box>
            <Text
              color={
                connection.state === 'connected'
                  ? color.success
                  : connection.state === 'disconnected'
                    ? color.danger
                    : color.warning
              }
            >
              {connection.state === 'connected'
                ? '● connected'
                : connection.state === 'disconnected'
                  ? '○ offline'
                  : '◐ connecting'}
            </Text>
            {streaming && <Text color={color.warning}>  · generating</Text>}
          </Box>
        </Box>

        {/* 主区:消息列表(带边框,框内滚动) + (可选)侧边栏 */}
        <Box flexDirection="row" flexGrow={1}>
          <Box flexDirection="column" flexGrow={1} marginRight={showSidebar ? 1 : 0}>
            <MessageList
              ref={messageListRef}
              messages={messages}
              activeStream={activeStream}
              streamingContent={streamingContent}
              streamingReasoning={streamingReasoning}
              width={mainWidth}
              viewport={listViewport}
              loadingHistory={loadingHistory}
              hasMoreHistory={hasMoreHistory}
              onLoadMore={() => {
                void loadMoreHistory(20);
              }}
              focus={focus === 'messages'}
              onCancelStream={onCancel}
            />
          </Box>
          {showSidebar && (
            <Sidebar
              focus={focus}
              connection={connection}
              agents={AGENTS}
              sessions={SESSIONS}
              selectedSessionIndex={selectedSessionIndex}
              activeSessionId={SESSIONS[selectedSessionIndex]?.id}
              contextWindow={CONTEXT_WINDOW}
              contextUsed={CONTEXT_USED}
              spent={SPENT}
              cwd={CWD}
              cliVersion={CLI_VERSION}
            />
          )}
        </Box>

        {/* Input — 在消息区外,不被消息区滚动影响 */}
        <Box marginTop={1}>
          <InputBox
            focus={focus === 'input'}
            onSend={onSend}
            disabled={streaming}
            placeholder={
              streaming ? '生成中…按 Esc 取消' : '输入消息,Enter 发送,Shift+Enter 换行,Tab 切换'
            }
          />
        </Box>
      </Box>
    );
  },
);
ChatView.displayName = 'ChatView';

// ─────────────────────────────────────────────────────────────
// App 根组件
// ─────────────────────────────────────────────────────────────
export interface AppProps {
  gatewayUrl?: string;
  token?: string;
  sessionId?: string;
  channelId?: string;
  userId?: string;
  mockFallback?: boolean;
}

export const App: React.FC<AppProps> = ({
  gatewayUrl = defaultConfig.gatewayUrl,
  token,
  sessionId = defaultConfig.defaultSessionId,
  channelId = SHARED_CHANNEL_ID,
  userId = SHARED_USER_ID,
  mockFallback = defaultConfig.mockMode,
}) => {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();
  const [mode, setMode] = useState<ViewMode>('launch');
  const [focus, setFocus] = useState<FocusArea>('input');
  const [selectedSession, setSelectedSession] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [initialMessage, setInitialMessage] = useState<string | null>(null);

  // ── Mouse 路由 ──────────────────────────────────────
  const messageListRef = useRef<MessageListHandle>(null!);
  useMouse((ev) => {
    if (mode !== 'chat' || showHelp) return;
    if (ev.type === 'wheel') {
      // 滚轮:总是滚消息区(用户期望"消息区是滚动的",不论当前 focus)
      if (ev.button === 'wheel-up') messageListRef.current?.lineUp();
      if (ev.button === 'wheel-down') messageListRef.current?.lineDown();
      return;
    }
    if (ev.type === 'press' && ev.button === 'left') {
      // 左键点击:先看是不是点在了「▶ 思考过程」折叠指示行 — 若是,展开/收起
      const contentLine = ev.row - MESSAGE_LIST_CONTENT_ROW;
      if (contentLine >= 0) {
        const target = messageListRef.current?.getClickTarget(contentLine);
        if (target?.isFoldLine) {
          messageListRef.current?.toggleReasoning(target.messageId);
          return;
        }
      }
      // 否则按 row 切焦点:
      // 整个可视区域大致 1..rows,我们在 chat 模式下的 layout 是:
      //   row 1           = ChatView padding top
      //   row 2           = ChatView Header
      //   row 3           = marginBottom
      //   row 4 ~ rows-4  = MessageList(主区)
      //   row rows-3      = marginTop
      //   row rows-2      = InputBox
      //   row rows-1      = padding bottom
      //   row rows        = StatusBar
      // 简化:row 接近顶部 -> messages,接近底部 -> input
      const totalRows = rows;
      if (ev.row >= totalRows - 2) {
        setFocus('input');
      } else if (ev.row <= totalRows - 3 && ev.row >= 2) {
        setFocus('messages');
      }
    }
  });

  // ── WebSocket 接入 ────────────────────────────────────
  const ws = useWebSocket({
    url: gatewayUrl,
    token,
    autoConnect: mode === 'chat' || mode === 'connecting',
  });

  // ── Chat(挂接 ws.request / ws.onEvent) ────────────────
  const chat = useChat({
    request: ws.request,
    onEvent: ws.onEvent,
    defaultSessionId: sessionId,
    channelId,
    userId,
  });

  // ── 模式机:launch → connecting → chat ────────────────
  const chatRef = useRef(chat);
  chatRef.current = chat;
  // 关键:守门 — initialMessage 只能被消费一次,避免 useEffect 多次重跑时重复 send
  // 之前依赖 [initialMessage] 会导致 setMode('chat') 触发 effect 重跑时,
  // 旧的 initialMessage 还没被 setInitialMessage(null) 清掉,又 send 一次。
  // 6 次相同回复就是这个原因。
  const initialMessageSentRef = useRef(false);
  useEffect(() => {
    // 调试日志:每次 effect 跑都打,看是否多次触发
    // eslint-disable-next-line no-console
    console.error(`[DEBUG] mode-effect 触发: mode=${mode} conn=${ws.connectionState} initialMsg=${initialMessage ? 'YES' : 'NO'} sentRef=${initialMessageSentRef.current}`);
    if (mode !== 'connecting') return;
    if (ws.connectionState === 'connected') {
      setMode('chat');
      if (initialMessage && !initialMessageSentRef.current) {
        initialMessageSentRef.current = true;
        void chatRef.current.sendMessage(initialMessage);
        setInitialMessage(null);
      }
      return;
    }
    if (ws.connectionState === 'disconnected' && mockFallback) {
      setMode('chat');
      if (initialMessage && !initialMessageSentRef.current) {
        initialMessageSentRef.current = true;
        void chatRef.current.sendMessage(initialMessage);
        setInitialMessage(null);
      }
    }
    // 依赖故意只放 mode / connectionState / mockFallback,
    // initialMessage 通过 ref 守门,避免 effect 反复重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, ws.connectionState, mockFallback]);

  // ── 顶层快捷键 ─────────────────────────────────────────
  // chat 模式时永远激活,处理全局键(Tab / Esc / Ctrl+C / ? 等)。
  // 子组件(InputBox / MessageList)在自己的 useInput 里也响应特定键。
  // 多个 useInput 同时激活时,所有都会被调用,这里只处理 App 顶层独享的键,
  // 其他键(messages 焦点的 ↑↓ / input 焦点的 Enter 等)由子组件自己处理。
  useInput(
    (value, key) => {
      // 全局: Ctrl+C 退出
      if (key.ctrl && value === 'c') {
        exit();
        return;
      }

      // Tab 循环 — 全局响应,所有焦点都能切
      if (key.tab && mode === 'chat' && !showHelp) {
        setFocus((f) => {
          if (f === 'input') return 'messages';
          if (f === 'messages') return 'sidebar';
          return 'input';
        });
        return;
      }

      // help 面板:Esc / ? 关闭
      if (showHelp) {
        if (key.escape || value === '?') {
          setShowHelp(false);
          return;
        }
        // 其它键在 help 面板下不响应
        return;
      }

      // chat 模式
      if (mode === 'chat') {
        // ? 显示 help
        if (value === '?') {
          setShowHelp(true);
          return;
        }

        // Ctrl+P 暂未实现,占位
        if (key.ctrl && value === 'p') {
          return;
        }

        // sidebar 焦点:上下键选 session (Sidebar 内部没自己处理,App 顶层统一)
        if (focus === 'sidebar') {
          if (key.upArrow) {
            setSelectedSession((i) => Math.max(0, i - 1));
            return;
          }
          if (key.downArrow) {
            setSelectedSession((i) => Math.min(SESSIONS.length - 1, i + 1));
            return;
          }
        }

        // messages 焦点:R / r 切换最近一条 reasoning 折叠(兜底,主要靠鼠标点击)
        if (focus === 'messages' && (value === 'R' || value === 'r') && !key.ctrl && !key.meta) {
          messageListRef.current?.toggleLastReasoning();
          return;
        }

        // input 焦点:Esc 统一由 App 顶层处理(cancel stream > back to launch)
        // messages / sidebar 焦点的 Esc 让子组件处理(App 顶层 noop)
        if (key.escape && focus === 'input') {
          if (chatRef.current.activeStream) {
            chatRef.current.cancelStream();
            return;
          }
          // 没有流:退回 launch
          setMode('launch');
          ws.disconnect();
          return;
        }
      }
    },
    // launch 模式时 useInput 不激活(交给 LaunchScreen 自己)
    // chat 模式 + help 模式时都激活
    {
      isActive: showHelp || mode === 'chat',
    },
  );

  const connectionInfo: ConnectionInfo = useMemo(
    () => ({
      state: ws.connectionState,
      endpoint: gatewayUrl,
      lastError: chat.lastError ?? undefined,
    }),
    [ws.connectionState, gatewayUrl, chat.lastError],
  );

  return (
    <ErrorBoundary>
      <Box flexDirection="column" height={rows}>
        {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
        {!showHelp && mode === 'launch' && (
          <LaunchScreen
            onHelp={() => setShowHelp(true)}
            onSubmit={(message) => {
              setInitialMessage(message);
              setMode('connecting');
            }}
          />
        )}
        {!showHelp && mode === 'connecting' && <ConnectingScreen gatewayUrl={gatewayUrl} />}
        {!showHelp && mode === 'chat' && (
          <ChatView
            messageListRef={messageListRef}
            focus={focus}
            columns={columns}
            rows={rows}
            streaming={Boolean(chat.activeStream)}
            streamingContent={chat.streamingContent}
            streamingReasoning={chat.reasoningContent}
            messages={chat.messages}
            activeStream={chat.activeStream}
            connection={connectionInfo}
            selectedSessionIndex={selectedSession}
            onSend={(m) => {
              void chat.sendMessage(m);
            }}
            onCancel={chat.cancelStream}
            loadingHistory={chat.loadingHistory}
            hasMoreHistory={chat.hasMoreHistory}
            loadMoreHistory={chat.loadMoreHistory}
          />
        )}
        {!showHelp && ws.connectionState === 'disconnected' && mode === 'chat' && !mockFallback && (
          <ReconnectPrompt onReconnect={ws.reconnect} onCancel={() => setMode('launch')} />
        )}
        <StatusBar
          cwd={CWD}
          messageCount={messagesCount(chat.messages, chat.activeStream)}
          connection={ws.connectionState}
          provider="gateway"
          model="deepseek-v4-pro"
          focus={focus}
        />
      </Box>
    </ErrorBoundary>
  );
};

function messagesCount(messages: ReturnType<typeof useChat>['messages'], active: ReturnType<typeof useChat>['activeStream']): number {
  return messages.length + (active ? 1 : 0);
}

export default App;
