# 09 - API 接口文档

> **版本**：v1.0.1  
> **修订日期**：2026-07-23  
> **修订人**：MyOpenClaw Core Team  
> **文档状态**：正式发布（已同步 Fastify 迁移）

---

## 目录

- [1. 概述](#1-概述)
- [2. 通信协议说明](#2-通信协议说明)
  - [2.1 WebSocket 协议](#21-websocket-协议)
  - [2.2 HTTP REST 协议](#22-http-rest-协议)
- [3. WebSocket 接口](#3-websocket-接口)
  - [3.1 连接方式](#31-连接方式)
  - [3.2 消息协议格式](#32-消息协议格式)
  - [3.3 API 方法详解](#33-api-方法详解)
  - [3.4 事件类型说明](#34-事件类型说明)
- [4. HTTP REST 接口](#4-http-rest-接口)
  - [4.1 健康检查](#41-健康检查)
  - [4.2 会话管理](#42-会话管理)
  - [4.3 工具管理](#43-工具管理)
  - [4.4 系统状态](#44-系统状态)
- [5. 内部模块间 API](#5-内部模块间-api)
  - [5.1 Gateway ↔ Agent 接口](#51-gateway--agent-接口)
  - [5.2 Agent ↔ Tools 接口](#52-agent--tools-接口)
  - [5.3 Agent ↔ Memory 接口](#53-agent--memory-接口)
- [6. 错误码与错误处理](#6-错误码与错误处理)
- [7. 认证与鉴权](#7-认证与鉴权)
- [8. 限流策略](#8-限流策略)
- [9. 完整调用示例](#9-完整调用示例)

---

## 1. 概述

MyOpenClaw 通过基于 **Fastify** 框架的 **Gateway 网关** 对外提供两种通信接口，共享单一端口（默认 `18780`）：

| 接口类型 | 协议 | 连接方式 | 适用场景 |
|----------|------|----------|----------|
| **WebSocket** | ws/wss | `ws://127.0.0.1:18780/ws` | 实时双向通信、事件订阅、流式响应 |
| **HTTP REST** | http/https | `http://127.0.0.1:18780/api/*` | 无状态查询、健康检查、运维监控 |

两种接口共享同一套业务逻辑与会话状态，仅传输层不同。Gateway 内部通过统一的消息路由机制处理两类请求，保证行为一致性。

**设计原则**：

1. **协议中立**：业务逻辑不感知传输层，同一方法可经 WebSocket 或 HTTP 调用。
2. **强类型契约**：所有请求/响应使用 TypeBox Schema 校验，保证类型安全。
3. **事件驱动**：WebSocket 支持事件订阅，HTTP 通过长轮询或 Webhook 回调获取事件。
4. **统一错误**：两类接口使用相同的错误码体系，错误响应结构一致。

---

## 2. 通信协议说明

### 2.1 WebSocket 协议

WebSocket 是 MyOpenClaw 的**主要通信协议**，适用于需要实时交互、流式响应、事件订阅的场景。

**协议特点**：

- 基于 JSON 文本帧传输，每帧一条 JSON 消息。
- 支持双向通信：客户端可发请求，服务端可推事件。
- 内置心跳机制，30 秒间隔，90 秒无响应判定断连。
- 单连接支持多会话并发，通过 `sessionId` 路由。

**消息分三类**：

| 类型 | 方向 | 说明 |
|------|------|------|
| `request` | 客户端 → 服务端 | 请求方法调用 |
| `response` | 服务端 → 客户端 | 请求的响应（含成功与失败） |
| `event` | 服务端 → 客户端 | 主动推送的事件通知 |

### 2.2 HTTP REST 协议

HTTP REST 适用于无状态查询、简单集成、健康检查、运维监控等场景。

**协议特点**：

- 标准 RESTful 风格，资源导向的 URL 设计。
- JSON 请求体与响应体，`Content-Type: application/json`。
- 无状态，每次请求需携带认证 Token。
- 不支持事件订阅（需配合 Webhook 或轮询）。

**通用响应结构**：

```jsonc
// 成功响应
{
  "ok": true,
  "data": { /* 业务数据 */ }
}

// 失败响应
{
  "ok": false,
  "error": {
    "code": 200001,
    "message": "数据校验失败",
    "details": [{ "field": "userId", "message": "不能为空" }],
    "retryable": false
  }
}
```

---

## 3. WebSocket 接口

### 3.1 连接方式

**连接 URL**：

```
ws://127.0.0.1:18780/ws
```

**带认证 Token 的连接**（推荐通过 query 参数传递）：

```
ws://127.0.0.1:18780/ws?token=sk-myopenclaw-xxxxx
```

**或通过 Header 传递**（需客户端支持自定义 Header）：

```
Authorization: Bearer sk-myopenclaw-xxxxx
```

**连接示例（浏览器）**：

```javascript
// 浏览器原生 WebSocket 连接
const ws = new WebSocket('ws://127.0.0.1:18780/ws?token=sk-myopenclaw-xxxxx');

ws.onopen = () => console.log('已连接到 MyOpenClaw Gateway');
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log('收到消息:', msg);
};
ws.onerror = (err) => console.error('连接错误:', err);
ws.onclose = () => console.log('连接已关闭');
```

**连接生命周期**：

```
[客户端发起连接]
        │
        ▼
[Gateway 接受握手] ──失败──► [关闭连接，返回 401]
        │
        ▼
[认证 Token 校验]
        │
        ▼
[发送 connected 事件] ──► {"type":"event","event":"connected","data":{"serverVersion":"1.0.0"}}
        │
        ▼
[正常通信阶段] ◄──── 心跳保活（30s ping/pong）
        │
        ▼
[客户端关闭 / 超时 / 错误] ──► [发送 disconnected 事件] ──► [关闭连接]
```

### 3.2 消息协议格式

#### 3.2.1 request 请求消息

客户端发送的请求，需指定 `id`（用于关联响应）、`method`、`params`。

```jsonc
{
  "type": "request",        // 固定为 "request"
  "id": "req-001",          // 请求 ID，客户端生成，用于关联响应
  "method": "sendMessage",  // 调用的方法名
  "params": {               // 方法参数，结构因 method 而异
    "sessionId": "01JXXXX...",
    "content": "你好"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 是 | 固定 `"request"` |
| `id` | string | 是 | 请求唯一 ID，用于关联响应 |
| `method` | string | 是 | 方法名，见 [3.3 API 方法详解](#33-api-方法详解) |
| `params` | object | 否 | 方法参数 |

#### 3.2.2 response 响应消息

服务端对 request 的响应，携带相同的 `id` 用于关联。

```jsonc
// 成功响应
{
  "type": "response",
  "id": "req-001",          // 对应请求的 id
  "ok": true,               // 是否成功
  "result": {               // 成功时的返回数据
    "messageId": "01JXXXX...",
    "content": "你好！有什么可以帮助你的？"
  }
}

// 失败响应
{
  "type": "response",
  "id": "req-001",
  "ok": false,
  "error": {                // 失败时的错误对象
    "code": 500001,
    "message": "会话不存在",
    "retryable": false
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 是 | 固定 `"response"` |
| `id` | string | 是 | 对应请求的 id |
| `ok` | boolean | 是 | 是否成功 |
| `result` | any | 否 | 成功时的返回数据 |
| `error` | object | 否 | 失败时的错误对象 |

#### 3.2.3 event 事件消息

服务端主动推送的事件通知，无需客户端请求。

```jsonc
{
  "type": "event",          // 固定为 "event"
  "event": "agentThinking", // 事件名，见 3.4 事件类型说明
  "data": {                 // 事件数据，结构因 event 而异
    "sessionId": "01JXXXX...",
    "taskId": "01JXXXX...",
    "thought": "用户想了解天气，我需要调用天气查询工具..."
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 是 | 固定 `"event"` |
| `event` | string | 是 | 事件名 |
| `data` | object | 是 | 事件数据 |

### 3.3 API 方法详解

#### 3.3.1 sendMessage - 发送消息

向指定会话发送消息，触发 Agent 处理并返回响应。

| 项目 | 说明 |
|------|------|
| **方法名** | `sendMessage` |
| **描述** | 发送消息到会话，Agent 异步处理后返回响应消息 |
| **是否需要订阅事件** | 建议配合 `subscribeEvents` 订阅 `agentThinking`、`toolExecuting` 事件获取实时进度 |

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | 是 | 目标会话 ID |
| `content` | string | 是 | 消息文本内容 |
| `attachments` | Attachment[] | 否 | 附件列表 |
| `type` | string | 否 | 消息类型，默认 `text` |
| `metadata` | object | 否 | 扩展元数据 |

**请求示例**：

```jsonc
{
  "type": "request",
  "id": "req-send-001",
  "method": "sendMessage",
  "params": {
    "sessionId": "01JXXXX9KQ4V7M8N2P3R6T5XWY",
    "content": "帮我查询北京今天的天气",
    "attachments": [],
    "type": "text"
  }
}
```

**响应格式**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `result.messageId` | string | 响应消息 ID |
| `result.content` | string | Agent 回复内容 |
| `result.taskId` | string | 关联的任务 ID |
| `result.tokensUsed` | number | 本次消耗 token 数 |
| `result.durationMs` | number | 处理耗时（毫秒） |

**响应示例**：

```jsonc
{
  "type": "response",
  "id": "req-send-001",
  "ok": true,
  "result": {
    "messageId": "01JXXXX9KQ4V7M8N2P3R6T5XWZ",
    "content": "北京今天晴，气温 25-32°C，空气质量良好。",
    "taskId": "01JXXXX9KQ4V7M8N2P3R6T5XX0",
    "tokensUsed": 350,
    "durationMs": 2400
  }
}
```

#### 3.3.2 createSession - 创建会话

创建新的对话会话，返回会话 ID。

| 项目 | 说明 |
|------|------|
| **方法名** | `createSession` |
| **描述** | 创建会话，绑定 Agent、模型、工具等配置 |

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agentId` | string | 是 | 绑定的 Agent ID |
| `model` | string | 否 | LLM 模型，默认使用 Agent 配置 |
| `systemPrompt` | string | 否 | 自定义系统提示词 |
| `memoryWindowSize` | number | 否 | 短期记忆窗口，默认 20 |
| `longTermMemoryEnabled` | boolean | 否 | 是否启用长期记忆，默认 false |
| `allowedTools` | string[] | 否 | 允许的工具白名单 |
| `temperature` | number | 否 | 温度参数，默认 0.7 |
| `maxTokens` | number | 否 | 最大响应 token，默认 4096 |
| `title` | string | 否 | 会话标题 |
| `metadata` | object | 否 | 自定义元数据 |

**请求示例**：

```jsonc
{
  "type": "request",
  "id": "req-session-001",
  "method": "createSession",
  "params": {
    "agentId": "default-agent",
    "model": "gpt-4o",
    "memoryWindowSize": 20,
    "longTermMemoryEnabled": true,
    "allowedTools": ["search", "calculator"],
    "temperature": 0.7,
    "title": "天气查询助手"
  }
}
```

**响应格式**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `result.sessionId` | string | 新建会话 ID |
| `result.createdAt` | number | 创建时间戳 |
| `result.status` | string | 会话状态（active） |

**响应示例**：

```jsonc
{
  "type": "response",
  "id": "req-session-001",
  "ok": true,
  "result": {
    "sessionId": "01JXXXX9KQ4V7M8N2P3R6T5XWY",
    "createdAt": 1784600000000,
    "status": "active"
  }
}
```

#### 3.3.3 getSession - 获取会话信息

查询指定会话的详细信息，包括配置与统计数据。

| 项目 | 说明 |
|------|------|
| **方法名** | `getSession` |
| **描述** | 获取会话详情 |

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | 是 | 会话 ID |

**请求示例**：

```jsonc
{
  "type": "request",
  "id": "req-get-001",
  "method": "getSession",
  "params": {
    "sessionId": "01JXXXX9KQ4V7M8N2P3R6T5XWY"
  }
}
```

**响应格式**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `result.id` | string | 会话 ID |
| `result.userId` | string | 用户 ID |
| `result.status` | string | 会话状态 |
| `result.config` | object | 会话配置 |
| `result.stats` | object | 统计信息 |
| `result.createdAt` | number | 创建时间 |
| `result.lastActiveAt` | number | 最后活跃时间 |

**响应示例**：

```jsonc
{
  "type": "response",
  "id": "req-get-001",
  "ok": true,
  "result": {
    "id": "01JXXXX9KQ4V7M8N2P3R6T5XWY",
    "userId": "user-001",
    "status": "active",
    "config": {
      "agentId": "default-agent",
      "model": "gpt-4o",
      "memoryWindowSize": 20,
      "temperature": 0.7
    },
    "stats": {
      "messageCount": 12,
      "toolCallCount": 3,
      "totalTokens": 4500,
      "totalLatencyMs": 18000
    },
    "createdAt": 1784600000000,
    "lastActiveAt": 1784600500000
  }
}
```

#### 3.3.4 listSessions - 列出所有会话

分页列出当前用户的所有会话。

| 项目 | 说明 |
|------|------|
| **方法名** | `listSessions` |
| **描述** | 列出用户会话，支持分页与状态过滤 |

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `status` | string | 否 | 按状态过滤（active/idle/closed） |
| `page` | number | 否 | 页码，默认 1 |
| `pageSize` | number | 否 | 每页数量，默认 20，最大 100 |

**请求示例**：

```jsonc
{
  "type": "request",
  "id": "req-list-001",
  "method": "listSessions",
  "params": {
    "status": "active",
    "page": 1,
    "pageSize": 20
  }
}
```

**响应格式**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `result.items` | Session[] | 会话列表 |
| `result.total` | number | 总数 |
| `result.page` | number | 当前页码 |
| `result.pageSize` | number | 每页数量 |

**响应示例**：

```jsonc
{
  "type": "response",
  "id": "req-list-001",
  "ok": true,
  "result": {
    "items": [
      {
        "id": "01JXXXX9KQ4V7M8N2P3R6T5XWY",
        "title": "天气查询助手",
        "status": "active",
        "lastActiveAt": 1784600500000
      }
    ],
    "total": 1,
    "page": 1,
    "pageSize": 20
  }
}
```

#### 3.3.5 closeSession - 关闭会话

关闭指定会话，释放资源，持久化历史。

| 项目 | 说明 |
|------|------|
| **方法名** | `closeSession` |
| **描述** | 关闭会话，不可恢复 |

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sessionId` | string | 是 | 会话 ID |
| `reason` | string | 否 | 关闭原因 |

**请求示例**：

```jsonc
{
  "type": "request",
  "id": "req-close-001",
  "method": "closeSession",
  "params": {
    "sessionId": "01JXXXX9KQ4V7M8N2P3R6T5XWY",
    "reason": "用户主动结束"
  }
}
```

**响应示例**：

```jsonc
{
  "type": "response",
  "id": "req-close-001",
  "ok": true,
  "result": {
    "sessionId": "01JXXXX9KQ4V7M8N2P3R6T5XWY",
    "status": "closed",
    "closedAt": 1784600600000
  }
}
```

#### 3.3.6 listTools - 列出可用工具

列出系统中已注册的所有工具及其 Schema。

| 项目 | 说明 |
|------|------|
| **方法名** | `listTools` |
| **描述** | 列出所有已注册工具 |

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `category` | string | 否 | 按分类过滤 |

**请求示例**：

```jsonc
{
  "type": "request",
  "id": "req-tools-001",
  "method": "listTools",
  "params": {}
}
```

**响应格式**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `result[].name` | string | 工具名称 |
| `result[].description` | string | 工具描述 |
| `result[].category` | string | 工具分类 |
| `result[].inputSchema` | object | 入参 JSON Schema |
| `result[].enabled` | boolean | 是否启用 |

**响应示例**：

```jsonc
{
  "type": "response",
  "id": "req-tools-001",
  "ok": true,
  "result": [
    {
      "name": "search",
      "description": "网络搜索工具，获取实时信息",
      "category": "information",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "搜索关键词" }
        },
        "required": ["query"]
      },
      "enabled": true
    },
    {
      "name": "calculator",
      "description": "数学计算工具",
      "category": "utility",
      "inputSchema": {
        "type": "object",
        "properties": {
          "expression": { "type": "string", "description": "数学表达式" }
        },
        "required": ["expression"]
      },
      "enabled": true
    }
  ]
}
```

#### 3.3.7 executeTool - 执行工具

直接执行指定工具（绕过 Agent），用于工具测试或集成。

| 项目 | 说明 |
|------|------|
| **方法名** | `executeTool` |
| **描述** | 直接调用工具，返回执行结果 |

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `toolName` | string | 是 | 工具名称 |
| `arguments` | object | 是 | 工具入参，需符合工具 Schema |
| `timeout` | number | 否 | 超时（ms），默认 30000 |

**请求示例**：

```jsonc
{
  "type": "request",
  "id": "req-exec-001",
  "method": "executeTool",
  "params": {
    "toolName": "calculator",
    "arguments": {
      "expression": "(25 + 17) * 3"
    },
    "timeout": 10000
  }
}
```

**响应格式**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `result.success` | boolean | 是否成功 |
| `result.result` | any | 工具返回结果 |
| `result.durationMs` | number | 执行耗时 |
| `result.error` | string | 失败时的错误信息 |

**响应示例**：

```jsonc
{
  "type": "response",
  "id": "req-exec-001",
  "ok": true,
  "result": {
    "success": true,
    "result": 126,
    "durationMs": 12
  }
}
```

#### 3.3.8 listChannels - 列出渠道状态

列出所有已注册渠道及其连接状态。

| 项目 | 说明 |
|------|------|
| **方法名** | `listChannels` |
| **描述** | 列出渠道状态，用于运维监控 |

**请求参数**：无

**请求示例**：

```jsonc
{
  "type": "request",
  "id": "req-channels-001",
  "method": "listChannels",
  "params": {}
}
```

**响应示例**：

```jsonc
{
  "type": "response",
  "id": "req-channels-001",
  "ok": true,
  "result": [
    {
      "id": "ws-18780",
      "type": "websocket",
      "status": "running",
      "port": 18780,
      "connections": 5,
      "startedAt": 1784599000000
    },
    {
      "id": "cli-stdio",
      "type": "cli",
      "status": "running",
      "connections": 1,
      "startedAt": 1784599000000
    }
  ]
}
```

#### 3.3.9 getAgentStatus - 获取 Agent 状态

查询 Agent 运行时的状态信息，包括负载、任务队列等。

| 项目 | 说明 |
|------|------|
| **方法名** | `getAgentStatus` |
| **描述** | 获取 Agent 运行状态 |

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agentId` | string | 否 | Agent ID，默认返回所有 |

**请求示例**：

```jsonc
{
  "type": "request",
  "id": "req-status-001",
  "method": "getAgentStatus",
  "params": {}
}
```

**响应示例**：

```jsonc
{
  "type": "response",
  "id": "req-status-001",
  "ok": true,
  "result": {
    "agents": [
      {
        "agentId": "default-agent",
        "status": "idle",
        "activeSessions": 3,
        "pendingTasks": 0,
        "model": "gpt-4o",
        "uptime": 3600000,
        "stats": {
          "totalRequests": 150,
          "totalTokens": 45000,
          "avgLatencyMs": 2200
        }
      }
    ]
  }
}
```

#### 3.3.10 subscribeEvents - 订阅事件

订阅指定类型的事件，订阅后服务端会主动推送匹配的事件。

| 项目 | 说明 |
|------|------|
| **方法名** | `subscribeEvents` |
| **描述** | 订阅事件，支持按类型与会话过滤 |

**请求参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `events` | string[] | 是 | 订阅的事件类型列表 |
| `sessionId` | string | 否 | 仅订阅指定会话的事件 |

**请求示例**：

```jsonc
{
  "type": "request",
  "id": "req-sub-001",
  "method": "subscribeEvents",
  "params": {
    "events": ["agentThinking", "toolExecuting", "taskCompleted", "error"],
    "sessionId": "01JXXXX9KQ4V7M8N2P3R6T5XWY"
  }
}
```

**响应示例**：

```jsonc
{
  "type": "response",
  "id": "req-sub-001",
  "ok": true,
  "result": {
    "subscriptionId": "sub-001",
    "events": ["agentThinking", "toolExecuting", "taskCompleted", "error"]
  }
}
```

订阅后，匹配的事件会以 `event` 消息推送：

```jsonc
{
  "type": "event",
  "event": "agentThinking",
  "data": {
    "sessionId": "01JXXXX9KQ4V7M8N2P3R6T5XWY",
    "taskId": "01JXXXX9KQ4V7M8N2P3R6T5XX0",
    "thought": "用户想查天气，我需要调用 search 工具"
  }
}
```

**取消订阅**：再次调用 `subscribeEvents` 传入空数组，或关闭连接自动取消。

### 3.4 事件类型说明

| 事件名 | 触发时机 | data 字段 |
|--------|----------|-----------|
| `connected` | WebSocket 连接建立 | `serverVersion`, `serverTime` |
| `disconnected` | 连接断开 | `reason` |
| `messageReceived` | 收到新用户消息 | `message` |
| `agentThinking` | Agent 开始思考（ReAct 的 thought 阶段） | `sessionId`, `taskId`, `thought` |
| `toolExecuting` | 开始执行工具 | `sessionId`, `taskId`, `toolName`, `arguments` |
| `toolCompleted` | 工具执行完成 | `sessionId`, `taskId`, `toolName`, `result`, `durationMs` |
| `taskCompleted` | 任务完成 | `sessionId`, `taskId`, `result` |
| `sessionCreated` | 会话创建 | `session` |
| `sessionClosed` | 会话关闭 | `sessionId`, `reason` |
| `error` | 系统错误 | `code`, `message`, `sessionId?` |

**事件示例**：

```jsonc
// messageReceived 事件
{
  "type": "event",
  "event": "messageReceived",
  "data": {
    "message": {
      "id": "01JXXXX...",
      "sessionId": "01JXXXX...",
      "type": "text",
      "role": "user",
      "content": "你好",
      "timestamp": 1784600000000
    }
  }
}

// toolExecuting 事件
{
  "type": "event",
  "event": "toolExecuting",
  "data": {
    "sessionId": "01JXXXX...",
    "taskId": "01JXXXX...",
    "toolName": "search",
    "arguments": { "query": "北京天气" }
  }
}

// error 事件
{
  "type": "event",
  "event": "error",
  "data": {
    "code": 700002,
    "message": "LLM 调用超时",
    "sessionId": "01JXXXX..."
  }
}
```

---

## 4. HTTP REST 接口

所有 HTTP 接口基础路径为 `/api`，共享 Gateway 统一端口 `18780`。

### 4.1 健康检查

#### GET /api/health

检查服务健康状态，无需认证。

**请求示例**：

```bash
curl http://127.0.0.1:18780/api/health
```

**响应示例**：

```jsonc
{
  "ok": true,
  "data": {
    "status": "healthy"
  }
}
```

### 4.2 系统状态

#### GET /api/status

获取网关运行状态，包括连接数、会话数、运行时间等。

**请求示例**：

```bash
curl http://127.0.0.1:18780/api/status
```

**响应示例**：

```jsonc
{
  "ok": true,
  "data": {
    "status": "running",
    "uptime": 3600.5,
    "connectionCount": 5,
    "maxConnections": 1000,
    "activeSessions": 3,
    "ruleCount": 2,
    "host": "127.0.0.1",
    "port": 18780
  }
}
```

### 4.3 连接列表

#### GET /api/connections

列出当前所有 WebSocket 连接信息。

**请求示例**：

```bash
curl http://127.0.0.1:18780/api/connections
```

**响应示例**：

```jsonc
{
  "ok": true,
  "data": {
    "total": 2,
    "connections": [
      { "connectionId": "uuid-1", "channelId": "webchat", "userId": "user-001" },
      { "connectionId": "uuid-2", "channelId": "cli", "userId": "user-002" }
    ]
  }
}
```

### 4.4 会话列表

#### GET /api/sessions

获取在线会话列表和当前路由规则配置。

**请求示例**：

```bash
curl http://127.0.0.1:18780/api/sessions
```

**响应示例**：

```jsonc
{
  "ok": true,
  "data": {
    "activeSessionCount": 3,
    "ruleCount": 2,
    "rules": [
      { "id": "default", "priority": 50, "channelId": "webchat", "agentId": "default", "enabled": true },
      { "id": "support", "priority": 100, "channelId": "webchat", "agentId": "support", "enabled": true }
    ]
  }
}
```

---

## 5. 内部模块间 API

以下接口为 MyOpenClaw 内部模块间通信使用，不对外暴露，仅供框架开发者参考。

### 5.1 Gateway ↔ Agent 接口

Gateway 将外部请求转换为内部调用，转发给 Agent Runtime。

```typescript
// src/gateway/agent-bridge.ts

/**
 * Gateway 调用 Agent Runtime 的内部接口
 * 通过进程内调用或 IPC 通信
 */
export interface AgentRuntimeInterface {
  /** 处理消息（核心入口） */
  processMessage(message: Message): Promise<Message>;

  /** 创建会话 */
  createSession(params: CreateSessionParams): Promise<Session>;

  /** 获取会话 */
  getSession(sessionId: string): Promise<Session | null>;

  /** 关闭会话 */
  closeSession(sessionId: string, reason?: string): Promise<void>;

  /** 获取 Agent 状态 */
  getStatus(): Promise<AgentStatus>;
}
```

**调用流程**：

```
[Gateway 收到 WebSocket request]
            │
            ▼
[认证 / 限流 / Schema 校验]
            │
            ▼
[路由到对应方法]
            │
            ├──► AgentRuntime.processMessage()  ──► 返回 response
            ├──► AgentRuntime.createSession()   ──► 返回 response
            └──► AgentRuntime.getStatus()       ──► 返回 response
```

### 5.2 Agent ↔ Tools 接口

Agent Runtime 在 ReAct 循环中调用工具层。

```typescript
// src/agent/tool-bridge.ts

/**
 * Agent 调用 Tools 层的内部接口
 */
export interface ToolExecutorInterface {
  /** 列出已注册工具 */
  listTools(): Promise<ToolInfo[]>;

  /** 执行工具 */
  execute(params: {
    toolName: string;
    arguments: Record<string, unknown>;
    sessionId: string;
    timeout?: number;
  }): Promise<ToolExecutionResult>;

  /** 校验工具入参（执行前预校验） */
  validateInput(toolName: string, args: unknown): Promise<boolean>;
}

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
  durationMs: number;
}
```

**调用流程**：

```
[Agent ReAct 循环 - Action 阶段]
            │
            ▼
[LLM 输出 tool_call]
            │
            ▼
[ToolExecutor.validateInput()] ──失败──► [返回错误给 LLM，进入下一轮]
            │ 通过
            ▼
[触发 tool.pre 钩子]
            │
            ▼
[ToolExecutor.execute()] ──► 执行工具
            │
            ▼
[触发 tool.post 钩子]
            │
            ▼
[返回 tool_result 给 LLM，进入 Observation 阶段]
```

### 5.3 Agent ↔ Memory 接口

Agent Runtime 调用 Memory 层进行记忆读写。

```typescript
// src/agent/memory-bridge.ts

/**
 * Agent 调用 Memory 层的内部接口
 */
export interface MemoryInterface {
  /** 写入消息到会话历史 */
  appendMessage(sessionId: string, message: Message): Promise<void>;

  /** 读取会话历史消息 */
  getHistory(sessionId: string, options?: {
    limit?: number;
    before?: number; // 时间戳，获取此之前的消息
  }): Promise<Message[]>;

  /** 语义检索相关记忆（长期记忆） */
  search(params: {
    sessionId: string;
    query: string;
    topK?: number;
    threshold?: number;
  }): Promise<MemoryItem[]>;

  /** 清除会话记忆 */
  clear(sessionId: string): Promise<void>;

  /** 获取会话摘要（压缩历史） */
  summarize(sessionId: string): Promise<string>;
}

export interface MemoryItem {
  id: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
  createdAt: number;
}
```

**调用流程**：

```
[Agent 收到新消息]
        │
        ▼
[Memory.getHistory()] ──► 获取近期对话历史
        │
        ▼
[Memory.search()] ──► 语义检索相关长期记忆
        │
        ▼
[拼接上下文 → LLM 推理]
        │
        ▼
[Memory.appendMessage()] ──► 写入用户消息
[Memory.appendMessage()] ──► 写入 Agent 响应
        │
        ▼
[若历史过长 → Memory.summarize()] ──► 压缩旧历史
```

---

## 6. 错误码与错误处理

### 6.1 错误响应结构

所有接口（WebSocket 与 HTTP）使用统一的错误结构：

```jsonc
{
  // WebSocket 失败响应
  "type": "response",
  "id": "req-001",
  "ok": false,
  "error": {
    "code": 500001,           // 错误码，见 6.2 错误码表
    "message": "会话不存在",   // 人类可读的错误信息
    "details": [              // 字段级错误（校验错误时填充）
      { "field": "sessionId", "message": "会话 ID 格式错误" }
    ],
    "retryable": false        // 是否可重试
  }
}

// HTTP 失败响应
{
  "ok": false,
  "error": {
    "code": 500001,
    "message": "会话不存在",
    "retryable": false
  }
}
```

### 6.2 错误码表

| 错误码 | HTTP 状态码 | 说明 | 可重试 |
|--------|-------------|------|--------|
| 100000 | 500 | 未知错误 | 否 |
| 100001 | 500 | 内部错误 | 否 |
| 100003 | 503 | 服务不可用 | 是 |
| 100004 | 504 | 超时 | 是 |
| 200001 | 400 | 数据校验失败 | 否 |
| 200003 | 400 | 缺少必填字段 | 否 |
| 300001 | 401 | 未认证 | 否 |
| 300002 | 403 | 无权限 | 否 |
| 300003 | 401 | Token 过期 | 否 |
| 300004 | 401 | Token 无效 | 否 |
| 400001 | 429 | 限流 | 是 |
| 400003 | 429 | 并发超限 | 是 |
| 500001 | 404 | 会话不存在 | 否 |
| 500002 | 409 | 会话已关闭 | 否 |
| 600001 | 404 | 工具不存在 | 否 |
| 600002 | 500 | 工具执行失败 | 否 |
| 600003 | 504 | 工具执行超时 | 是 |
| 700001 | 502 | LLM 调用错误 | 是 |
| 700002 | 504 | LLM 调用超时 | 是 |
| 700003 | 429 | LLM 限流 | 是 |

> 完整错误码见 [08-Core公共模块 - 错误码总表](./08-Core公共模块.md#72-错误码总表)

### 6.3 错误处理最佳实践

```typescript
// 客户端错误处理示例
async function callApi(method: string, params: object) {
  const response = await sendRequest(method, params);
  if (!response.ok) {
    const { code, message, retryable } = response.error;

    // 可重试错误：指数退避重试
    if (retryable && [100004, 400001, 700002, 700003].includes(code)) {
      await sleep(1000 * Math.pow(2, retryCount));
      return callApi(method, params);
    }

    // 认证错误：跳转登录
    if ([300001, 300003, 300004].includes(code)) {
      redirectToLogin();
      return;
    }

    // 其他错误：展示给用户
    showError(message);
  }
}
```

---

## 7. 认证与鉴权

### 7.1 Token 机制

MyOpenClaw 使用 Bearer Token 进行认证，Token 通过管理界面或 CLI 生成。

**Token 格式**：

```
sk-myopenclaw-<random32hex>.<signature>
```

**Token 结构（JWT 解码后）**：

```jsonc
{
  "sub": "user-001",          // 用户 ID
  "iat": 1784600000,          // 签发时间
  "exp": 1787200000,          // 过期时间（30 天后）
  "scope": ["session:read", "session:write", "tool:execute"],  // 权限范围
  "rateLimit": {              // 限流配置
    "requestsPerMinute": 60,
    "tokensPerDay": 1000000
  }
}
```

### 7.2 认证流程

```
[客户端请求]
    │
    │ Authorization: Bearer sk-myopenclaw-xxxxx
    ▼
[Gateway 提取 Token]
    │
    ▼
[验证签名] ──失败──► [返回 300004 Token 无效]
    │
    ▼
[检查过期] ──过期──► [返回 300003 Token 过期]
    │
    ▼
[检查权限 scope] ──不足──► [返回 300002 无权限]
    │
    ▼
[注入 userId 到请求上下文]
    │
    ▼
[放行到业务逻辑]
```

### 7.3 Token 管理 API

| 方法 | 路径 | 说明 |
|------|------|------|
| 生成 Token | `POST /api/tokens` | 创建新 Token，需管理员权限 |
| 列出 Token | `GET /api/tokens` | 列出当前用户 Token |
| 撤销 Token | `DELETE /api/tokens/:id` | 撤销指定 Token |

### 7.4 权限范围（Scope）

| Scope | 说明 |
|-------|------|
| `session:read` | 读取会话 |
| `session:write` | 创建/关闭会话 |
| `message:write` | 发送消息 |
| `tool:read` | 查看工具列表 |
| `tool:execute` | 执行工具 |
| `system:read` | 读取系统状态 |
| `admin` | 管理员权限（包含以上全部） |

---

## 8. 限流策略

### 8.1 限流维度

MyOpenClaw 采用多维度限流：

| 维度 | 默认限制 | 说明 |
|------|----------|------|
| 每 Token 每分钟请求数 | 60 | 防止单用户高频请求 |
| 每 Token 并发会话数 | 5 | 防止资源占用过多 |
| 每会话每分钟消息数 | 30 | 防止单会话刷屏 |
| 全局每秒请求数 | 1000 | 保护系统整体 |
| LLM 每分钟调用数 | 100 | 防止 LLM 成本失控 |

### 8.2 限流算法

采用 **滑动窗口 + 令牌桶** 混合算法：

- **滑动窗口**：用于统计分钟级请求数，精确防瞬时高峰。
- **令牌桶**：用于平滑请求速率，允许短暂突发。

### 8.3 限流响应

触发限流时返回错误码 `400001`，并附带 `Retry-After` 信息：

```jsonc
// WebSocket 限流响应
{
  "type": "response",
  "id": "req-001",
  "ok": false,
  "error": {
    "code": 400001,
    "message": "请求频率超限，每分钟最多 60 次",
    "retryable": true,
    "retryAfter": 30
  }
}

// HTTP 限流响应（附带 Header）
// HTTP/1.1 429 Too Many Requests
// Retry-After: 30
// X-RateLimit-Limit: 60
// X-RateLimit-Remaining: 0
// X-RateLimit-Reset: 1784600030
{
  "ok": false,
  "error": {
    "code": 400001,
    "message": "请求频率超限",
    "retryable": true
  }
}
```

### 8.4 限流配置

限流参数可通过配置文件或环境变量调整：

```yaml
# config.yaml
rateLimit:
  perToken:
    requestsPerMinute: 60
    concurrentSessions: 5
  perSession:
    messagesPerMinute: 30
  global:
    requestsPerSecond: 1000
  llm:
    callsPerMinute: 100
```

---

## 9. 完整调用示例

### 9.1 TypeScript WebSocket 客户端示例

```typescript
// client.ts - MyOpenClaw WebSocket 客户端完整示例

/**
 * MyOpenClaw WebSocket 客户端封装
 * 演示完整的连接、认证、会话管理、消息收发、事件订阅流程
 */

interface WsRequest {
  type: 'request';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

interface WsResponse {
  type: 'response';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: number; message: string; retryable: boolean };
}

interface WsEvent {
  type: 'event';
  event: string;
  data: Record<string, unknown>;
}

export class MyOpenClawClient {
  private ws: WebSocket | null = null;
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private eventHandlers = new Map<string, ((data: unknown) => void)[]>();
  private requestCounter = 0;

  constructor(
    private url: string = 'ws://127.0.0.1:18780',
    private token: string
  ) {}

  /** 建立 WebSocket 连接 */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // 通过 query 参数传递 Token
      this.ws = new WebSocket(`${this.url}/ws?token=${this.token}`);

      this.ws.onopen = () => {
        console.log('[MyOpenClaw] 已连接');
        resolve();
      };

      this.ws.onmessage = (event) => {
        const msg: WsResponse | WsEvent = JSON.parse(event.data);
        this.handleMessage(msg);
      };

      this.ws.onerror = (err) => {
        console.error('[MyOpenClaw] 连接错误', err);
        reject(new Error('连接失败'));
      };

      this.ws.onclose = () => {
        console.log('[MyOpenClaw] 连接关闭');
        // 拒绝所有待处理请求
        for (const [, promise] of this.pendingRequests) {
          promise.reject(new Error('连接已关闭'));
        }
        this.pendingRequests.clear();
      };
    });
  }

  /** 处理收到的消息 */
  private handleMessage(msg: WsResponse | WsEvent): void {
    if (msg.type === 'response') {
      // 响应消息：匹配待处理请求
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        if (msg.ok) {
          pending.resolve(msg.result);
        } else {
          pending.reject(new Error(msg.error?.message ?? '未知错误'));
        }
        this.pendingRequests.delete(msg.id);
      }
    } else if (msg.type === 'event') {
      // 事件消息：分发给订阅者
      const handlers = this.eventHandlers.get(msg.event) ?? [];
      for (const handler of handlers) {
        handler(msg.data);
      }
    }
  }

  /** 发送请求 */
  async request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = `req-${++this.requestCounter}`;
    const wsRequest: WsRequest = { type: 'request', id, method, params };

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.ws?.send(JSON.stringify(wsRequest));

      // 30 秒超时
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('请求超时'));
        }
      }, 30000);
    });
  }

  /** 订阅事件 */
  on(event: string, handler: (data: unknown) => void): void {
    const handlers = this.eventHandlers.get(event) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(event, handlers);
  }

  // ===== 高级 API 封装 =====

  /** 创建会话 */
  async createSession(params: {
    agentId: string;
    model?: string;
    title?: string;
  }): Promise<string> {
    const result = await this.request<{ sessionId: string }>('createSession', params);
    return result.sessionId;
  }

  /** 发送消息 */
  async sendMessage(sessionId: string, content: string): Promise<string> {
    const result = await this.request<{ content: string }>('sendMessage', {
      sessionId,
      content,
    });
    return result.content;
  }

  /** 关闭会话 */
  async closeSession(sessionId: string): Promise<void> {
    await this.request('closeSession', { sessionId });
  }

  /** 订阅事件 */
  async subscribeEvents(events: string[], sessionId?: string): Promise<void> {
    await this.request('subscribeEvents', { events, sessionId });
  }

  /** 关闭连接 */
  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}

// ===== 使用示例 =====
async function main() {
  const client = new MyOpenClawClient('ws://127.0.0.1:18780', 'sk-myopenclaw-xxxxx');
  await client.connect();

  // 订阅事件（在创建会话前订阅，确保不漏事件）
  client.on('agentThinking', (data) => {
    console.log('[Agent 思考]', (data as any).thought);
  });
  client.on('toolExecuting', (data) => {
    console.log('[工具执行]', (data as any).toolName, (data as any).arguments);
  });

  // 创建会话
  const sessionId = await client.createSession({
    agentId: 'default-agent',
    model: 'gpt-4o',
    title: '天气查询助手',
  });
  console.log('会话已创建:', sessionId);

  // 订阅该会话的事件
  await client.subscribeEvents(['agentThinking', 'toolExecuting', 'taskCompleted'], sessionId);

  // 发送消息
  const reply = await client.sendMessage(sessionId, '帮我查询北京今天的天气');
  console.log('Agent 回复:', reply);

  // 关闭会话
  await client.closeSession(sessionId);
  client.disconnect();
}

main().catch(console.error);
```

### 9.2 curl 调用示例

```bash
# 1. 健康检查（无需认证）
curl http://127.0.0.1:18780/api/health

# 2. 创建会话
curl -X POST http://127.0.0.1:18780/api/sessions \
  -H "Authorization: Bearer sk-myopenclaw-xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "default-agent",
    "model": "gpt-4o",
    "title": "天气查询助手"
  }'

# 3. 获取会话列表
curl -H "Authorization: Bearer sk-myopenclaw-xxxxx" \
  "http://127.0.0.1:18780/api/sessions?status=active"

# 4. 获取会话详情
curl -H "Authorization: Bearer sk-myopenclaw-xxxxx" \
  http://127.0.0.1:18780/api/sessions/01JXXXX9KQ4V7M8N2P3R6T5XWY

# 5. 列出工具
curl -H "Authorization: Bearer sk-myopenclaw-xxxxx" \
  http://127.0.0.1:18780/api/tools

# 6. 执行工具
curl -X POST http://127.0.0.1:18780/api/tools/execute \
  -H "Authorization: Bearer sk-myopenclaw-xxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "toolName": "calculator",
    "arguments": { "expression": "(25 + 17) * 3" }
  }'

# 7. 系统状态
curl -H "Authorization: Bearer sk-myopenclaw-xxxxx" \
  http://127.0.0.1:18780/api/status
```

### 9.3 wscat 交互式调试示例

```bash
# 使用 wscat 进行交互式 WebSocket 调试
wscat -c "ws://127.0.0.1:18780/ws?token=sk-myopenclaw-xxxxx"

# 连接后输入 JSON 请求：
> {"type":"request","id":"1","method":"createSession","params":{"agentId":"default-agent"}}
< {"type":"response","id":"1","ok":true,"result":{"sessionId":"01JXXX...","status":"active"}}

> {"type":"request","id":"2","method":"sendMessage","params":{"sessionId":"01JXXX...","content":"你好"}}
< {"type":"event","event":"agentThinking","data":{"thought":"用户打招呼，我应该友好回应"}}
< {"type":"response","id":"2","ok":true,"result":{"content":"你好！有什么可以帮助你的？"}}

> {"type":"request","id":"3","method":"closeSession","params":{"sessionId":"01JXXX..."}}
< {"type":"response","id":"3","ok":true,"result":{"status":"closed"}}
```

### 9.4 Python 调用示例

```python
# client.py - MyOpenClaw Python 客户端示例
import asyncio
import json
import websockets

async def main():
    """Python WebSocket 客户端示例"""
    url = "ws://127.0.0.1:18780/ws?token=sk-myopenclaw-xxxxx"

    async with websockets.connect(url) as ws:
        # 创建会话
        await ws.send(json.dumps({
            "type": "request",
            "id": "1",
            "method": "createSession",
            "params": {"agentId": "default-agent", "model": "gpt-4o"}
        }))
        response = json.loads(await ws.recv())
        session_id = response["result"]["sessionId"]
        print(f"会话已创建: {session_id}")

        # 发送消息
        await ws.send(json.dumps({
            "type": "request",
            "id": "2",
            "method": "sendMessage",
            "params": {"sessionId": session_id, "content": "你好"}
        }))

        # 接收事件与响应（可能收到多条事件后才收到响应）
        while True:
            msg = json.loads(await ws.recv())
            if msg["type"] == "event":
                print(f"[事件] {msg['event']}: {msg['data']}")
            elif msg["type"] == "response" and msg["id"] == "2":
                print(f"[响应] {msg['result']['content']}")
                break

asyncio.run(main())
```

---

## 附录：API 方法速查表

| 方法 | 协议 | 说明 |
|------|------|------|
| `sendMessage` | WS | 发送消息 |
| `createSession` | WS / HTTP POST | 创建会话 |
| `getSession` | WS / HTTP GET | 获取会话 |
| `listSessions` | WS / HTTP GET | 列出会话 |
| `closeSession` | WS | 关闭会话 |
| `listTools` | WS / HTTP GET | 列出工具 |
| `executeTool` | WS / HTTP POST | 执行工具 |
| `listChannels` | WS | 列出渠道 |
| `getAgentStatus` | WS | Agent 状态 |
| `subscribeEvents` | WS | 订阅事件 |
| - | HTTP GET /api/health | 健康检查 | 无 |
| - | HTTP GET /api/status | 系统状态 | - |
| - | HTTP GET /api/connections | 连接列表 | - |
| - | HTTP GET /api/sessions | 会话列表 | - |

---

> **相关文档**
> - [08-Core 公共模块](./08-Core公共模块.md)
> - [10-开发指南](./10-开发指南.md)
