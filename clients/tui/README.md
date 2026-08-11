# TUI 客户端

`@myopenclaw/tui` 是 MyOpenClaw 的终端 TUI 客户端,基于 [Ink](https://github.com/vadimdemedes/ink) + React 实现。

## 目录结构

```
src/
├── main.ts                       # 入口
├── api/types.ts                  # Gateway HTTP 响应类型
├── components/                   # 视图组件
│   ├── App.tsx                   # 顶层应用
│   ├── ErrorBoundary.tsx
│   ├── HelpPanel.tsx
│   ├── chat/                     # 聊天视图:InputBox / MessageList / MessageItem / ScrollIndicator
│   ├── sidebar/                  # 侧栏:SystemInfo / AgentStatus / SessionList / Sidebar
│   ├── statusbar/                # 状态栏:StatusBar / ConnectionBadge / ModelIndicator
│   └── connection/               # 连接:ConnectionStatus / ReconnectPrompt
├── config/defaults.ts            # 默认配置
├── hooks/                        # 自定义 Hook
│   ├── useTerminalSize.ts
│   ├── useWebSocket.ts
│   ├── useChat.ts
│   └── useScroll.ts
├── types/                        # 类型定义
│   ├── ui.ts
│   ├── message.ts
│   └── session.ts
└── utils/                        # 工具
    ├── format.ts
    ├── colors.ts
    └── keyboard.ts
```

## 命令

| 命令 | 作用 |
|------|------|
| `pnpm dev` | `tsx watch src/main.ts` — 开发热重载 |
| `pnpm dev:clean` | 先 `kill-port 18790` 再启动 |
| `pnpm start:watch` | `nodemon --config nodemon.json` — 监视 `dist/` 重启 `node dist/main.js` |
| `pnpm build:watch` | `tsc --watch` — 持续类型检查 + 编译 |
| `pnpm start` | `node dist/main.js` — 生产启动 |
| `pnpm build` | `tsc -p tsconfig.json` — 编译到 `dist/` |
| `pnpm typecheck` | `tsc --noEmit` — 仅类型检查 |
| `pnpm clean` | `rm -rf dist` |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TUI_GATEWAY_URL` | `ws://localhost:18790/ws` | Gateway WebSocket 地址 |
| `TUI_HTTP_URL` | `http://localhost:18790` | Gateway HTTP 地址 |
| `TUI_SESSION_ID` | `session-local` | 默认会话 ID |
| `TUI_USER_ID` | `tui-user` | 当前用户 ID |
| `TUI_MOCK` | `false` | mock 模式(无 server 时降级) |
