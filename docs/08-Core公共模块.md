# 08 - Core 公共模块

> **版本**：v1.0.2  
> **修订日期**：2026-07-23  
> **修订人**：MyOpenClaw Core Team  
> **文档状态**：正式发布（已同步代码实际状态）

---

## 目录

- [1. 模块概述](#1-模块概述)
  - [1.1 src/core 目录职责](#11-srccore-目录职责)
  - [1.2 在六层架构中的定位](#12-在六层架构中的定位)
  - [1.3 目录结构](#13-目录结构)
- [2. 统一消息结构体 Message](#2-统一消息结构体-message)
  - [2.1 TypeScript 类型定义](#21-typescript-类型定义)
  - [2.2 字段说明](#22-字段说明)
  - [2.3 消息生命周期](#23-消息生命周期)
- [3. 会话 Session 类型定义](#3-会话-session-类型定义)
  - [3.1 类型定义](#31-类型定义)
  - [3.2 字段说明](#32-字段说明)
  - [3.3 会话状态机](#33-会话状态机)
- [4. 任务 Task 类型定义](#4-任务-task-类型定义)
  - [4.1 类型定义](#41-类型定义)
  - [4.2 字段说明](#42-字段说明)
- [5. TypeBox / Zod 数据校验机制](#5-typebox--zod-数据校验机制)
  - [5.1 校验框架选型](#51-校验框架选型)
  - [5.2 Schema 定义示例](#52-schema-定义示例)
  - [5.3 校验流程](#53-校验流程)
  - [5.4 自定义校验规则](#54-自定义校验规则)
- [6. 全局通用工具函数](#6-全局通用工具函数)
  - [6.1 工具函数一览](#61-工具函数一览)
  - [6.2 工具函数详细说明](#62-工具函数详细说明)
- [7. 常量与错误码定义](#7-常量与错误码定义)
  - [7.1 系统常量](#71-系统常量)
  - [7.2 错误码总表](#72-错误码总表)
  - [7.3 错误对象结构](#73-错误对象结构)
- [8. 生命周期钩子 Hooks 机制](#8-生命周期钩子-hooks-机制)
  - [8.1 src/hooks 目录结构](#81-srchooks-目录结构)
  - [8.2 钩子类型定义](#82-钩子类型定义)
  - [8.3 钩子执行顺序](#83-钩子执行顺序)
  - [8.4 消息前置/后置拦截](#84-消息前置后置拦截)
- [9. 使用示例代码](#9-使用示例代码)
  - [9.1 创建并校验消息](#91-创建并校验消息)
  - [9.2 会话管理示例](#92-会话管理示例)
  - [9.3 注册自定义钩子](#93-注册自定义钩子)
  - [9.4 错误处理示例](#94-错误处理示例)

---

## 1. 模块概述

### 1.1 src/core 目录职责

`src/core` 是 MyOpenClaw 框架的公共基础模块，承担以下核心职责：

| 职责领域 | 说明 |
|---------|------|
| **类型契约** | 定义全框架共享的数据结构（`Message`、`Session`、`Task` 等），所有模块通过 `@core/types` 引用，保证类型一致性 |
| **数据校验** | 提供 TypeBox / Zod 校验 Schema 与运行时校验器，在模块边界处统一拦截非法数据 |
| **错误体系** | 定义统一错误码、错误类（`AppError`）、错误工厂方法，避免散落的字符串错误 |
| **工具函数** | 提供 ID 生成、时间戳、深拷贝、日志、重试、防抖等无状态工具 |
| **常量定义** | 集中维护端口、超时、事件名、协议版本等全局常量 |
| **钩子机制** | 通过 `src/hooks` 暴露生命周期钩子，支持消息前置/后置拦截、会话生命周期监听 |
| **配置加载** | 提供环境变量、配置文件加载与合并的通用能力 |

Core 模块不依赖任何业务模块（Channels、Gateway、Agent Runtime、Tools、Memory），是整个 Hub-Spoke 架构的"地基"，所有上层模块都依赖 Core，而 Core 不反向依赖任何上层模块。

> **实现状态**：Core 模块已完整实现，包括类型系统（types/）、错误体系（errors/）、Schema 校验（schemas/）、配置加载（config/）、常量定义（constants/）和工具函数（utils/）。所有单元测试均已通过。

### 1.2 在六层架构中的定位

```
┌─────────────────────────────────────────────────────────┐
│                  Channels 渠道层                          │
│  (HTTP / WebSocket / CLI / Slack / WeChat ...)          │
└───────────────────────────┬─────────────────────────────┘
                            │ 依赖
┌───────────────────────────▼─────────────────────────────┐
│                  Gateway 网关层 (:18780)                  │
│  (路由 / 协议转换 / 鉴权 / 限流 / 事件分发)               │
└───────────────────────────┬─────────────────────────────┘
                            │ 依赖
┌───────────────────────────▼─────────────────────────────┐
│                Agent Runtime 运行时层                     │
│  (ReAct 循环 / LLM 调用 / 任务编排)                      │
└──────────┬────────────────────────────────┬─────────────┘
           │ 依赖                           │ 依赖
┌──────────▼──────────┐         ┌──────────▼──────────────┐
│   Tools/Skills 工具层 │         │     Memory 记忆层         │
│ (工具注册 / 执行)     │         │ (短期/长期记忆 / 向量存储)│
└──────────┬──────────┘         └──────────┬──────────────┘
           │                                │
           └────────────┬───────────────────┘
                        │ 全部依赖
           ┌────────────▼────────────┐
           │      Core 公共模块       │  ← 本文档
           │ (Types / Utils / Errors │
           │  / Hooks / Constants)   │
           └─────────────────────────┘
```

Core 位于架构最底层，是所有模块的共同依赖，自身零外部业务依赖，确保框架的可移植性与可测试性。

### 1.3 目录结构

```
src/
├── core/                       # 公共基础模块
│   ├── types/                  # 类型契约定义
│   │   ├── message.ts          # Message 消息结构
│   │   ├── session.ts          # Session 会话结构
│   │   ├── task.ts             # Task 任务结构
│   │   ├── channel.ts          # Channel 渠道接口
│   │   ├── tool.ts             # Tool 工具接口
│   │   ├── agent.ts            # Agent 运行时接口
│   │   ├── llm.ts              # LLM 模型相关类型
│   │   └── index.ts            # 统一导出
│   ├── schemas/                # TypeBox / Zod 校验 Schema
│   │   ├── message.schema.ts
│   │   ├── session.schema.ts
│   │   ├── validator.ts        # 统一校验器接口
│   │   ├── extensions.ts       # 自定义校验规则
│   │   └── index.ts
│   ├── errors/                 # 错误体系
│   │   ├── codes.ts            # 错误码常量
│   │   ├── AppError.ts         # 统一错误类
│   │   └── index.ts
│   ├── utils/                  # 通用工具函数
│   │   ├── id.ts               # ID 生成
│   │   ├── time.ts             # 时间处理
│   │   ├── logger.ts           # 日志器
│   │   ├── retry.ts            # 重试机制
│   │   ├── debounce.ts         # 防抖节流
│   │   ├── deep-merge.ts       # 深合并
│   │   ├── string.ts           # 字符串工具
│   │   └── index.ts
│   ├── constants/              # 全局常量
│   │   ├── ports.ts            # 端口常量
│   │   ├── timeouts.ts         # 超时常量
│   │   ├── events.ts           # 事件名常量
│   │   └── index.ts
│   ├── config/                 # 配置加载
│   │   ├── loader.ts
│   │   └── index.ts
│   └── index.ts                # Core 模块统一导出
├── hooks/                      # 生命周期钩子（跨层共享）
│   ├── types.ts                # 钩子类型定义
│   ├── registry.ts             # 钩子注册中心
│   ├── pipeline.ts             # 钩子执行管线
│   └── builtin/                # 内置钩子
│       ├── logging.ts          # 日志钩子
│       ├── metrics.ts          # 指标采集钩子
│       └── sanitize.ts         # 数据脱敏钩子
├── channels/                   # 渠道层
├── gateway/                    # 网关层
├── agent/                      # Agent 运行时层
├── tools/                      # 工具层
└── memory/                     # 记忆层
```

---

## 2. 统一消息结构体 Message

`Message` 是 MyOpenClaw 中最重要的数据结构，贯穿 Channels → Gateway → Agent Runtime → Tools → Memory 全链路。所有模块之间的数据交换都以 `Message` 为载体，避免各模块自定义格式导致的转换开销。

### 2.1 TypeScript 类型定义

```typescript
// src/core/types/message.ts

/**
 * 消息类型枚举
 * - text:      纯文本消息（最常见）
 * - image:     图片消息（含 URL 或 base64）
 * - audio:     语音消息
 * - video:     视频消息
 * - file:      文件消息
 * - system:    系统消息（不展示给用户，用于内部状态同步）
 * - tool_call: 工具调用请求（Agent 发起）
 * - tool_result: 工具执行结果（Tools 层返回）
 * - error:     错误消息
 * - control:   控制消息（如心跳、取消信号）
 */
export type MessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'file'
  | 'system'
  | 'tool_call'
  | 'tool_result'
  | 'error'
  | 'control';

/**
 * 消息发送者角色
 * - user:    终端用户
 * - agent:   AI Agent
 * - tool:    工具执行器
 * - system:  系统进程
 */
export type MessageRole = 'user' | 'agent' | 'tool' | 'system';

/**
 * 附件结构体，用于承载图片、文件、音频等富媒体内容
 */
export interface MessageAttachment {
  /** 附件唯一 ID，使用 ulid 生成，保证时序可排序 */
  id: string;
  /** 附件类型，与 MessageType 的媒体类型对齐 */
  type: 'image' | 'audio' | 'video' | 'file';
  /** 附件来源 URL（远程资源）或本地路径 */
  url?: string;
  /** base64 编码的内容（小文件直传场景） */
  data?: string;
  /** MIME 类型，如 image/png、application/pdf */
  mimeType: string;
  /** 附件文件名（含扩展名） */
  filename?: string;
  /** 附件字节大小，用于限制校验 */
  size?: number;
  /** 附件附加元数据，如图片宽高、PDF 页数 */
  metadata?: Record<string, unknown>;
}

/**
 * 工具调用载荷，当 type === 'tool_call' 时填充
 */
export interface ToolCallPayload {
  /** 被调用的工具名称，需在 Tools 层已注册 */
  toolName: string;
  /** 工具调用参数，符合工具的入参 Schema */
  arguments: Record<string, unknown>;
  /** 调用 ID，用于关联 tool_result */
  callId: string;
}

/**
 * 工具结果载荷，当 type === 'tool_result' 时填充
 */
export interface ToolResultPayload {
  /** 关联的 tool_call.callId */
  callId: string;
  /** 工具执行结果数据 */
  result: unknown;
  /** 是否执行成功 */
  success: boolean;
  /** 失败时的错误信息 */
  error?: string;
  /** 执行耗时（毫秒） */
  durationMs?: number;
}

/**
 * 统一消息结构体 Message
 *
 * MyOpenClaw 全链路数据交换的标准载体。
 * 任何模块产生或消费的数据，都应先封装为 Message 再传递。
 */
export interface Message {
  /**
   * 消息全局唯一 ID
   * 使用 ulid 生成，26 位字符，包含时间戳，可按生成时序排序
   * 示例：01ARZ3NDEKTSV4RRFFQ69G5FAV
   */
  id: string;

  /**
   * 渠道 ID，标识消息来源渠道
   * 例如：'http-default'、'ws-18780'、'cli-stdio'、'slack-xxx'
   * Gateway 通过此字段路由消息到对应渠道
   */
  channelId: string;

  /**
   * 用户 ID，标识消息所属的终端用户
   * 用于会话隔离、鉴权、计费等场景
   */
  userId: string;

  /**
   * 会话 ID，标识消息所属的会话
   * 同一会话内的消息共享上下文与记忆
   */
  sessionId: string;

  /**
   * 消息类型，见 MessageType 枚举
   */
  type: MessageType;

  /**
   * 消息发送者角色，见 MessageRole 枚举
   * 用于区分消息方向（user→agent 或 agent→user）
   */
  role: MessageRole;

  /**
   * 消息文本内容
   * - text 类型：用户输入或 Agent 回复的文本
   * - tool_call / tool_result 类型：可留空，内容放 payload
   * - 其他类型：可选的描述性文本
   */
  content: string;

  /**
   * 附件列表，可包含多个图片、文件等
   * 默认为空数组，避免 null 检查
   */
  attachments: MessageAttachment[];

  /**
   * 消息生成时间戳（Unix 毫秒）
   * 由发送方填充，接收方以此为准，不依赖接收时间
   */
  timestamp: number;

  /**
   * 扩展元数据，用于携带渠道特定信息或业务自定义字段
   * 例如：Slack 的 channel_id、企业微信的 corp_id
   * 建议使用扁平结构，避免深层嵌套
   */
  metadata: Record<string, unknown>;

  /**
   * 工具调用载荷
   * 仅当 type === 'tool_call' 时有意义
   */
  toolCall?: ToolCallPayload;

  /**
   * 工具结果载荷
   * 仅当 type === 'tool_result' 时有意义
   */
  toolResult?: ToolResultPayload;

  /**
   * 父消息 ID，用于消息树（如 Agent 思维链追溯）
   * 可选，单轮对话无需填写
   */
  parentMessageId?: string;

  /**
   * 引用的消息 ID 列表（如回复、引用历史消息）
   */
  referencedMessageIds?: string[];

  /**
   * 消息优先级（0-9，默认 5）
   * 用于 Gateway 限流与队列调度，数字越大优先级越高
   */
  priority?: number;

  /**
   * 消息 TTL（毫秒），超时后视为过期，Agent 不再处理
   * 可选，未设置表示永不过期
   */
  ttl?: number;
}
```

### 2.2 字段说明

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | string | 是 | - | 消息全局唯一 ID（ulid） |
| `channelId` | string | 是 | - | 来源渠道 ID |
| `userId` | string | 是 | - | 用户 ID |
| `sessionId` | string | 是 | - | 会话 ID |
| `type` | MessageType | 是 | - | 消息类型 |
| `role` | MessageRole | 是 | - | 发送者角色 |
| `content` | string | 是 | `''` | 文本内容 |
| `attachments` | MessageAttachment[] | 是 | `[]` | 附件列表 |
| `timestamp` | number | 是 | - | 生成时间戳（ms） |
| `metadata` | Record | 是 | `{}` | 扩展元数据 |
| `toolCall` | ToolCallPayload | 否 | - | 工具调用载荷 |
| `toolResult` | ToolResultPayload | 否 | - | 工具结果载荷 |
| `parentMessageId` | string | 否 | - | 父消息 ID |
| `referencedMessageIds` | string[] | 否 | - | 引用消息 ID 列表 |
| `priority` | number | 否 | `5` | 优先级（0-9） |
| `ttl` | number | 否 | - | 过期时间（ms） |

### 2.3 消息生命周期

一条消息从产生到归档，经历以下阶段：

```
[用户输入]
     │
     ▼
[Channels 构造 Message]  ← 填充 id/channelId/userId/sessionId/type/content/timestamp
     │
     ▼
[Hooks: message.pre]     ← 前置钩子（鉴权、脱敏、限流）
     │
     ▼
[Gateway 路由]           ← 按 sessionId 分发到对应 Agent
     │
     ▼
[Agent Runtime 处理]      ← LLM 推理、工具调用、记忆检索
     │
     ▼
[Hooks: message.post]    ← 后置钩子（日志、指标、归档）
     │
     ▼
[Memory 持久化]           ← 写入会话历史
     │
     ▼
[Channels 回传]          ← 转换为渠道协议返回用户
```

---

## 3. 会话 Session 类型定义

`Session` 表示一次完整的对话上下文，聚合该上下文内的所有消息、Agent 状态与记忆引用。

### 3.1 类型定义

```typescript
// src/core/types/session.ts

/**
 * 会话状态枚举
 * - active:   活跃中，可接收新消息
 * - idle:     空闲，超过 idleTimeout 未有消息
 * - paused:   暂停，用户或系统主动暂停
 * - closing:  关闭中，正在持久化与清理
 * - closed:   已关闭，不可再操作
 * - error:    异常状态，需人工介入
 */
export type SessionStatus =
  | 'active'
  | 'idle'
  | 'paused'
  | 'closing'
  | 'closed'
  | 'error';

/**
 * 会话配置，创建会话时传入，运行期不可变
 */
export interface SessionConfig {
  /** 绑定的 Agent ID，决定使用哪个 Agent Runtime 处理 */
  agentId: string;
  /** 绑定的 LLM 模型标识，如 'gpt-4o'、'claude-3-5-sonnet' */
  model?: string;
  /** 系统提示词，覆盖 Agent 默认 system prompt */
  systemPrompt?: string;
  /** 短期记忆窗口大小（保留最近 N 条消息） */
  memoryWindowSize?: number;
  /** 是否启用长期记忆（向量检索） */
  longTermMemoryEnabled?: boolean;
  /** 允许调用的工具白名单，未设置表示允许全部 */
  allowedTools?: string[];
  /** 会话级温度参数（覆盖 Agent 默认值） */
  temperature?: number;
  /** 单次响应最大 token 数 */
  maxTokens?: number;
  /** 空闲超时（毫秒），超时后转为 idle */
  idleTimeout?: number;
  /** 会话最大存活时间（毫秒），超时自动关闭 */
  maxLifetime?: number;
  /** 自定义元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 会话统计信息
 */
export interface SessionStats {
  /** 累计消息数（含用户与 Agent） */
  messageCount: number;
  /** 累计工具调用次数 */
  toolCallCount: number;
  /** 累计 token 消耗（输入 + 输出） */
  totalTokens: number;
  /** 累计 LLM 调用耗时（毫秒） */
  totalLatencyMs: number;
  /** 首条消息时间戳 */
  firstMessageAt?: number;
  /** 最后一条消息时间戳 */
  lastMessageAt?: number;
}

/**
 * 会话 Session 结构体
 *
 * 代表一次完整的对话上下文，是 Agent Runtime 的工作单元。
 * 一个用户可同时拥有多个活跃会话，会话间相互隔离。
 */
export interface Session {
  /** 会话全局唯一 ID（ulid） */
  id: string;

  /** 会话所属用户 ID */
  userId: string;

  /** 创建会话的渠道 ID */
  channelId: string;

  /** 会话标题，默认取首条用户消息前 30 字 */
  title?: string;

  /** 会话当前状态 */
  status: SessionStatus;

  /** 会话配置（创建时确定，运行期只读） */
  config: SessionConfig;

  /** 会话统计信息（运行期实时更新） */
  stats: SessionStats;

  /** 会话创建时间戳（ms） */
  createdAt: number;

  /** 最后更新时间戳（ms），任何状态变更都会更新 */
  updatedAt: number;

  /** 最后活跃时间戳（ms），用于 idle 检测 */
  lastActiveAt: number;

  /** 关闭时间戳（ms），仅 status === 'closed' 时有值 */
  closedAt?: number;

  /** 会话级元数据 */
  metadata: Record<string, unknown>;

  /** 关闭原因（status === 'closed' 或 'error' 时填充） */
  closeReason?: string;

  /** 错误信息（status === 'error' 时填充） */
  error?: string;
}
```

### 3.2 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 会话全局唯一 ID |
| `userId` | string | 是 | 所属用户 ID |
| `channelId` | string | 是 | 创建渠道 ID |
| `title` | string | 否 | 会话标题 |
| `status` | SessionStatus | 是 | 当前状态 |
| `config` | SessionConfig | 是 | 会话配置（只读） |
| `stats` | SessionStats | 是 | 运行统计 |
| `createdAt` | number | 是 | 创建时间戳 |
| `updatedAt` | number | 是 | 最后更新时间戳 |
| `lastActiveAt` | number | 是 | 最后活跃时间戳 |
| `closedAt` | number | 否 | 关闭时间戳 |
| `metadata` | Record | 是 | 元数据 |
| `closeReason` | string | 否 | 关闭原因 |
| `error` | string | 否 | 错误信息 |

### 3.3 会话状态机

```
                      createSession()
                            │
                            ▼
                       ┌─────────┐
            ┌──────────│ active  │◄──────────┐
            │          └────┬────┘           │
            │   idleTimeout │                │ sendMessage()
            │        超时    │                │
            │               ▼                │
            │          ┌─────────┐           │
            │          │  idle   │───────────┘
            │          └────┬────┘
            │   resume()    │
            └───────────────┘
                            │ pause() / error
                            ▼
                       ┌─────────┐
                       │ paused  │
                       │ / error │
                       └────┬────┘
                  closeSession()
                            │
                            ▼
                       ┌─────────┐
                       │ closing │
                       └────┬────┘
                            │ 持久化完成
                            ▼
                       ┌─────────┐
                       │ closed  │  (终态)
                       └─────────┘
```

---

## 4. 任务 Task 类型定义

`Task` 表示 Agent 在一次 ReAct 循环中要完成的工作单元，可能拆分为多个子任务。Task 是 Agent Runtime 编排的核心数据结构。

### 4.1 类型定义

```typescript
// src/core/types/task.ts

/**
 * 任务状态枚举
 * - pending:   待执行（已创建，未开始）
 * - running:   执行中
 * - waiting:   等待中（等待工具返回、用户输入或外部事件）
 * - completed: 已完成（成功）
 * - failed:    已失败
 * - cancelled: 已取消
 */
export type TaskStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * 任务步骤，记录 ReAct 循环的每一步
 */
export interface TaskStep {
  /** 步骤唯一 ID */
  id: string;
  /** 步骤序号，从 1 开始 */
  index: number;
  /** 步骤类型：思考(thought) / 行动(action) / 观察(observation) */
  kind: 'thought' | 'action' | 'observation';
  /** 步骤内容（思考文本、工具调用、工具结果） */
  content: string;
  /** 关联的消息 ID */
  messageId?: string;
  /** 关联的工具调用 ID（kind === 'action' 时） */
  toolCallId?: string;
  /** 步骤开始时间戳 */
  startedAt: number;
  /** 步骤结束时间戳 */
  endedAt?: number;
}

/**
 * 任务 Task 结构体
 *
 * Agent Runtime 的工作单元。一次用户消息可能触发一个或多个 Task，
 * Task 之间可存在父子关系，形成任务树。
 */
export interface Task {
  /** 任务全局唯一 ID（ulid） */
  id: string;

  /** 所属会话 ID */
  sessionId: string;

  /** 触发该任务的用户消息 ID */
  triggerMessageId: string;

  /** 父任务 ID（子任务时填写，根任务为空） */
  parentTaskId?: string;

  /** 任务目标描述（自然语言，由 LLM 生成或用户指定） */
  goal: string;

  /** 任务当前状态 */
  status: TaskStatus;

  /** 任务步骤列表（ReAct 循环的每一步） */
  steps: TaskStep[];

  /** 任务创建时间戳 */
  createdAt: number;

  /** 任务开始执行时间戳 */
  startedAt?: number;

  /** 任务结束时间戳（完成/失败/取消） */
  endedAt?: number;

  /** 任务结果（status === 'completed' 时填充） */
  result?: string;

  /** 失败原因（status === 'failed' 时填充） */
  error?: string;

  /** 任务级元数据 */
  metadata: Record<string, unknown>;

  /** 任务优先级（0-9，默认 5） */
  priority?: number;

  /** 重试次数 */
  retryCount?: number;

  /** 最大重试次数 */
  maxRetries?: number;
}
```

### 4.2 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 任务全局唯一 ID |
| `sessionId` | string | 是 | 所属会话 ID |
| `triggerMessageId` | string | 是 | 触发消息 ID |
| `parentTaskId` | string | 否 | 父任务 ID |
| `goal` | string | 是 | 任务目标描述 |
| `status` | TaskStatus | 是 | 当前状态 |
| `steps` | TaskStep[] | 是 | 步骤列表 |
| `createdAt` | number | 是 | 创建时间戳 |
| `startedAt` | number | 否 | 开始时间戳 |
| `endedAt` | number | 否 | 结束时间戳 |
| `result` | string | 否 | 任务结果 |
| `error` | string | 否 | 失败原因 |
| `metadata` | Record | 是 | 元数据 |
| `priority` | number | 否 | 优先级 |
| `retryCount` | number | 否 | 重试次数 |
| `maxRetries` | number | 否 | 最大重试次数 |

---

## 5. TypeBox / Zod 数据校验机制

### 5.1 校验框架选型

MyOpenClaw 同时支持 TypeBox 与 Zod 两种校验框架，二者可通过适配层互换：

| 框架 | 优势 | 适用场景 |
|------|------|----------|
| **TypeBox** | 编译期类型推导与运行时校验统一；JSON Schema 友好，可直接生成 API 文档 | 对外 API 边界校验、工具入参 Schema 暴露 |
| **Zod** | 生态丰富、API 友好、错误信息可定制 | 内部业务逻辑校验、配置文件解析 |

默认配置：**对外边界（Gateway、Tools 入参）使用 TypeBox**，**内部逻辑使用 Zod**。Core 模块提供统一的 `Validator` 接口屏蔽底层差异。

```typescript
// src/core/schemas/validator.ts

/**
 * 统一校验器接口
 * 无论底层是 TypeBox 还是 Zod，都实现该接口
 */
export interface Validator<T> {
  /** 校验数据，成功返回类型化数据，失败抛出 ValidationError */
  validate(data: unknown): T;
  /** 校验数据，成功返回 true，失败返回 false（不抛异常） */
  isvalid(data: unknown): data is T;
  /** 校验数据，返回结果对象（不抛异常） */
  safeValidate(data: unknown): { success: true; data: T } | { success: false; error: AppError };
  /** 生成 JSON Schema（仅 TypeBox 后端支持，Zod 后端返回 undefined） */
  toJsonSchema?: () => Record<string, unknown>;
}
```

### 5.2 Schema 定义示例

#### 5.2.1 TypeBox Schema（Message）

```typescript
// src/core/schemas/message.schema.ts
import { Type, type Static } from '@sinclair/typebox';
import { TypeSystem } from '@sinclair/typebox/system';

/**
 * Message 的 TypeBox Schema 定义
 * Static<typeof MessageSchema> 等价于 Message 接口，
 * 保证类型与运行时校验一致
 */
export const MessageSchema = Type.Object({
  // 消息 ID：ulid 格式，26 位 Base32 字符
  id: Type.String({ pattern: '^[0-9A-HJKMNP-TV-Z]{26}$', description: '消息唯一 ID（ulid）' }),

  // 渠道 ID：非空字符串
  channelId: Type.String({ minLength: 1, description: '来源渠道 ID' }),

  // 用户 ID：非空字符串
  userId: Type.String({ minLength: 1, description: '用户 ID' }),

  // 会话 ID：非空字符串
  sessionId: Type.String({ minLength: 1, description: '会话 ID' }),

  // 消息类型：枚举
  type: Type.Union(
    [
      Type.Literal('text'),
      Type.Literal('image'),
      Type.Literal('audio'),
      Type.Literal('video'),
      Type.Literal('file'),
      Type.Literal('system'),
      Type.Literal('tool_call'),
      Type.Literal('tool_result'),
      Type.Literal('error'),
      Type.Literal('control'),
    ],
    { description: '消息类型' }
  ),

  // 发送者角色：枚举
  role: Type.Union(
    [Type.Literal('user'), Type.Literal('agent'), Type.Literal('tool'), Type.Literal('system')],
    { description: '发送者角色' }
  ),

  // 文本内容：可为空字符串
  content: Type.String({ default: '', description: '消息文本内容' }),

  // 附件列表：默认空数组
  attachments: Type.Array(
    Type.Object({
      id: Type.String(),
      type: Type.Union([
        Type.Literal('image'),
        Type.Literal('audio'),
        Type.Literal('video'),
        Type.Literal('file'),
      ]),
      url: Type.Optional(Type.String()),
      data: Type.Optional(Type.String()),
      mimeType: Type.String(),
      filename: Type.Optional(Type.String()),
      size: Type.Optional(Type.Number({ minimum: 0 })),
      metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
    { default: [] }
  ),

  // 时间戳：正整数
  timestamp: Type.Integer({ minimum: 0, description: '生成时间戳（ms）' }),

  // 元数据：默认空对象
  metadata: Type.Record(Type.String(), Type.Unknown(), { default: {} }),

  // 可选字段
  toolCall: Type.Optional(
    Type.Object({
      toolName: Type.String(),
      arguments: Type.Record(Type.String(), Type.Unknown()),
      callId: Type.String(),
    })
  ),
  toolResult: Type.Optional(
    Type.Object({
      callId: Type.String(),
      result: Type.Unknown(),
      success: Type.Boolean(),
      error: Type.Optional(Type.String()),
      durationMs: Type.Optional(Type.Number({ minimum: 0 })),
    })
  ),
  parentMessageId: Type.Optional(Type.String()),
  referencedMessageIds: Type.Optional(Type.Array(Type.String())),
  priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 9, default: 5 })),
  ttl: Type.Optional(Type.Integer({ minimum: 0 })),
});

// Static 类型推导，与手写 Message 接口保持一致
export type MessageSchemaType = Static<typeof MessageSchema>;
```

#### 5.2.2 Zod Schema（SessionConfig）

```typescript
// src/core/schemas/session.schema.ts
import { z } from 'zod';

/**
 * SessionConfig 的 Zod Schema
 * 用于内部配置校验，提供更友好的错误信息
 */
export const SessionConfigSchema = z
  .object({
    agentId: z.string().min(1, 'Agent ID 不能为空'),
    model: z.string().optional(),
    systemPrompt: z.string().max(8192, '系统提示词不能超过 8192 字符').optional(),
    memoryWindowSize: z.number().int().min(1).max(100).default(20),
    longTermMemoryEnabled: z.boolean().default(false),
    allowedTools: z.array(z.string()).optional(),
    temperature: z.number().min(0).max(2).default(0.7),
    maxTokens: z.number().int().min(1).max(32768).default(4096),
    idleTimeout: z.number().int().min(1000).default(30 * 60 * 1000), // 默认 30 分钟
    maxLifetime: z.number().int().min(60000).optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict(); // 严格模式，拒绝未知字段

// 推导类型
export type SessionConfigType = z.infer<typeof SessionConfigSchema>;

/**
 * 创建会话时的请求 Schema
 */
export const CreateSessionRequestSchema = z.object({
  userId: z.string().min(1),
  channelId: z.string().min(1),
  title: z.string().max(100).optional(),
  config: SessionConfigSchema,
});
```

### 5.3 校验流程

```
┌──────────────────────────────────────────────────────────┐
│  入口层（Gateway / Tool Executor）                        │
│  数据来源：网络、文件、用户输入（不可信）                  │
│                                                          │
│  1. 使用 TypeBox Schema 校验（对外边界）                  │
│     const validator = createTypeBoxValidator(MessageSchema)│
│     const message = validator.validate(rawData)          │
│     ↓ 失败 → 抛出 ValidationError(ErrorCode.VALIDATION) │
└──────────────────────────┬───────────────────────────────┘
                           │ 校验通过
                           ▼
┌──────────────────────────────────────────────────────────┐
│  业务层（Agent Runtime / Memory）                         │
│  数据来源：内部模块（半可信）                              │
│                                                          │
│  2. 使用 Zod Schema 校验业务约束                          │
│     const config = SessionConfigSchema.parse(rawConfig)   │
│     ↓ 失败 → 抛出 ValidationError(ErrorCode.CONFIG)     │
└──────────────────────────┬───────────────────────────────┘
                           │ 校验通过
                           ▼
┌──────────────────────────────────────────────────────────┐
│  核心层（Core 类型流转）                                   │
│  数据已类型安全，无需重复校验                              │
└──────────────────────────────────────────────────────────┘
```

校验原则：

1. **边界校验**：所有外部输入（网络、文件、用户）必须在入口层用 Schema 强制校验。
2. **内部信任**：通过校验进入核心层的数据视为类型安全，内部流转不再重复校验，避免性能损耗。
3. **失败即抛**：校验失败立即抛出 `ValidationError`，由上层统一捕获并转换为错误响应。
4. **Schema 即文档**：TypeBox Schema 可直接导出为 JSON Schema，用于生成 API 文档与 OpenAPI 规范。

### 5.4 自定义校验规则

对于内置 Schema 无法覆盖的业务规则，MyOpenClaw 提供自定义校验扩展：

```typescript
// src/core/schemas/extensions.ts
import { TypeSystem } from '@sinclair/typebox/system';
import { z } from 'zod';

/**
 * 注册自定义 TypeBox 格式：ulid
 * 校验 26 位 Base32 字符（不含 I L O U）
 */
TypeSystem.Format('ulid', (value: string) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value));

// 使用自定义格式
const IdSchema = Type.String({ format: 'ulid' });

/**
 * Zod 自定义校验：工具名称必须为 snake_case
 */
export const ToolNameSchema = z
  .string()
  .min(1)
  .regex(/^[a-z][a-z0-9_]*$/, '工具名称必须为 snake_case 格式')
  .refine((name) => !name.includes('__'), '工具名称不能包含连续下划线');

/**
 * Zod 跨字段校验：maxTokens 不能超过模型上限
 */
export const ModelAwareConfigSchema = SessionConfigSchema.refine(
  (config) => {
    const modelMaxTokens: Record<string, number> = {
      'gpt-4o': 16384,
      'claude-3-5-sonnet': 8192,
    };
    const limit = modelMaxTokens[config.model ?? 'gpt-4o'] ?? 4096;
    return (config.maxTokens ?? 4096) <= limit;
  },
  { message: 'maxTokens 超过模型上限', path: ['maxTokens'] }
);
```

---

## 6. 全局通用工具函数

### 6.1 工具函数一览

| 函数 | 模块路径 | 说明 |
|------|----------|------|
| `generateId()` | `core/utils/id.ts` | 生成 ulid（时序可排序） |
| `generateUuid()` | `core/utils/id.ts` | 生成 UUID v4 |
| `now()` | `core/utils/time.ts` | 当前 Unix 毫秒时间戳 |
| `formatTimestamp(ts)` | `core/utils/time.ts` | 格式化时间戳为 ISO 字符串 |
| `sleep(ms)` | `core/utils/time.ts` | Promise 化的延时 |
| `createLogger(scope)` | `core/utils/logger.ts` | 创建带作用域的日志器 |
| `retry(fn, opts)` | `core/utils/retry.ts` | 指数退避重试 |
| `debounce(fn, ms)` | `core/utils/debounce.ts` | 防抖 |
| `throttle(fn, ms)` | `core/utils/debounce.ts` | 节流 |
| `deepMerge(target, ...sources)` | `core/utils/deep-merge.ts` | 深度合并对象 |
| `deepClone(obj)` | `core/utils/deep-merge.ts` | 结构化克隆 |
| `safeJsonParse(str, fallback)` | `core/utils/index.ts` | 安全 JSON 解析 |
| `truncate(str, maxLen)` | `core/utils/index.ts` | 字符串截断 |

### 6.2 工具函数详细说明

```typescript
// src/core/utils/id.ts
import { ulid } from 'ulid';

/**
 * 生成 ulid（Universally Unique Lexicographically Sortable Identifier）
 * 特点：26 字符、时序可排序、不冲突
 * 适用：消息 ID、会话 ID、任务 ID
 */
export function generateId(): string {
  return ulid();
}

/**
 * 生成 UUID v4
 * 适用：需要标准 UUID 格式的场景（如对接第三方系统）
 */
export function generateUuid(): string {
  return crypto.randomUUID();
}
```

```typescript
// src/core/utils/time.ts

/** 当前 Unix 毫秒时间戳 */
export function now(): number {
  return Date.now();
}

/** 格式化时间戳为 ISO 8601 字符串（带时区） */
export function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString();
}

/** Promise 化的延时，支持 AbortSignal 取消 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Sleep aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Sleep aborted'));
    });
  });
}
```

```typescript
// src/core/utils/logger.ts
import pino from 'pino';

/**
 * 创建带作用域的日志器
 * 作用域会作为字段写入日志，便于按模块过滤
 *
 * @example
 * const log = createLogger('gateway');
 * log.info({ sessionId }, 'Session created');
 */
export function createLogger(scope: string) {
  return pino({
    name: 'myopenclaw',
    level: process.env.LOG_LEVEL ?? 'info',
    mixin: { scope }, // 自动注入 scope 字段
  });
}
```

```typescript
// src/core/utils/retry.ts

interface RetryOptions {
  /** 最大重试次数（不含首次），默认 3 */
  maxRetries?: number;
  /** 初始退避延迟（ms），默认 100 */
  initialDelayMs?: number;
  /** 退避倍数，默认 2 */
  backoffFactor?: number;
  /** 最大退避延迟（ms），默认 10000 */
  maxDelayMs?: number;
  /** 判断错误是否可重试，默认所有错误都重试 */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

/**
 * 指数退避重试
 * 适用于网络请求、外部服务调用等可重试操作
 *
 * @example
 * const result = await retry(() => callLLM(prompt), {
 *   maxRetries: 3,
 *   shouldRetry: (err) => err.code === ErrorCode.RATE_LIMIT
 * });
 */
export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 100,
    backoffFactor = 2,
    maxDelayMs = 10000,
    shouldRetry = () => true,
  } = opts;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries || !shouldRetry(error, attempt)) {
        throw error;
      }
      const delay = Math.min(initialDelayMs * Math.pow(backoffFactor, attempt), maxDelayMs);
      await sleep(delay);
    }
  }
  throw lastError;
}
```

```typescript
// src/core/utils/deep-merge.ts

/**
 * 深度合并多个对象，后者覆盖前者
 * - 数组按索引合并（而非拼接）
 * - null/undefined 不覆盖已有值
 * - 支持任意嵌套层级
 *
 * @example
 * deepMerge({ a: { b: 1 } }, { a: { c: 2 } })
 * // => { a: { b: 1, c: 2 } }
 */
export function deepMerge<T extends Record<string, any>>(target: T, ...sources: Partial<T>[]): T {
  if (!sources.length) return target;
  const result = { ...target };
  for (const source of sources) {
    for (const key of Object.keys(source) as Array<keyof T>) {
      const targetVal = result[key];
      const sourceVal = source[key];
      if (
        isPlainObject(targetVal) &&
        isPlainObject(sourceVal)
      ) {
        result[key] = deepMerge(targetVal, sourceVal);
      } else if (sourceVal !== undefined) {
        result[key] = sourceVal;
      }
    }
  }
  return result;
}

/** 结构化克隆（使用原生 structuredClone，支持 Date/Map/Set 等） */
export function deepClone<T>(obj: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj)) as T;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}
```

---

## 7. 常量与错误码定义

### 7.1 系统常量

```typescript
// src/core/constants/ports.ts

/** Gateway WebSocket 默认端口 */
export const DEFAULT_GATEWAY_PORT = 18780;

/** HTTP REST API 默认端口（与 WebSocket 共用） */
export const DEFAULT_HTTP_PORT = 18780;

/** 内部 Agent ↔ Gateway 通信端口范围 */
export const AGENT_PORT_RANGE = { min: 19000, max: 19999 } as const;
```

```typescript
// src/core/constants/timeouts.ts

/** 默认 LLM 调用超时（ms） */
export const LLM_TIMEOUT_MS = 60_000;

/** 默认工具执行超时（ms） */
export const TOOL_TIMEOUT_MS = 30_000;

/** 默认会话空闲超时（ms），30 分钟 */
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** 心跳间隔（ms） */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** 心跳超时（ms），超过则判定连接断开 */
export const HEARTBEAT_TIMEOUT_MS = 90_000;
```

```typescript
// src/core/constants/events.ts

/**
 * 事件名常量
 * 所有跨模块事件使用此常量，避免字符串拼写错误
 */
export const EventType = {
  /** 收到新消息 */
  MESSAGE_RECEIVED: 'messageReceived',
  /** Agent 开始思考 */
  AGENT_THINKING: 'agentThinking',
  /** 开始执行工具 */
  TOOL_EXECUTING: 'toolExecuting',
  /** 工具执行完成 */
  TOOL_COMPLETED: 'toolCompleted',
  /** 任务完成 */
  TASK_COMPLETED: 'taskCompleted',
  /** 会话创建 */
  SESSION_CREATED: 'sessionCreated',
  /** 会话关闭 */
  SESSION_CLOSED: 'sessionClosed',
  /** 系统错误 */
  ERROR: 'error',
} as const;

export type EventTypeName = (typeof EventType)[keyof typeof EventType];
```

```typescript
// src/core/constants/index.ts

/** 协议版本 */
export const PROTOCOL_VERSION = '1.0.0';

/** 框架名称 */
export const FRAMEWORK_NAME = 'MyOpenClaw';

/** 默认每页数量 */
export const DEFAULT_PAGE_SIZE = 20;

/** 最大每页数量 */
export const MAX_PAGE_SIZE = 100;
```

### 7.2 错误码总表

MyOpenClaw 采用 6 位数字错误码，按模块分段：

| 错误码 | 常量名 | HTTP 状态码 | 说明 | 触发场景 |
|--------|--------|-------------|------|----------|
| **100000** | `UNKNOWN` | 500 | 未知错误 | 未捕获的异常 |
| **100001** | `INTERNAL` | 500 | 内部错误 | 内部逻辑异常 |
| **100002** | `NOT_IMPLEMENTED` | 501 | 功能未实现 | 调用未实现的接口 |
| **100003** | `SERVICE_UNAVAILABLE` | 503 | 服务不可用 | 模块未启动或过载 |
| **100004** | `TIMEOUT` | 504 | 超时 | 请求或操作超时 |
| **200001** | `VALIDATION` | 400 | 数据校验失败 | Schema 校验不通过 |
| **200002** | `INVALID_FORMAT` | 400 | 格式错误 | 字段格式不符合要求 |
| **200003** | `MISSING_FIELD` | 400 | 缺少必填字段 | 请求缺少必填参数 |
| **200004** | `INVALID_TYPE` | 400 | 类型错误 | 字段类型不匹配 |
| **200005** | `CONFIG` | 400 | 配置错误 | 配置项非法 |
| **300001** | `UNAUTHORIZED` | 401 | 未认证 | 缺少或无效的 Token |
| **300002** | `FORBIDDEN` | 403 | 无权限 | 权限不足 |
| **300003** | `TOKEN_EXPIRED` | 401 | Token 过期 | Token 已失效 |
| **300004** | `TOKEN_INVALID` | 401 | Token 无效 | Token 签名错误或格式错误 |
| **400001** | `RATE_LIMIT` | 429 | 限流 | 超过请求频率限制 |
| **400002** | `QUOTA_EXCEEDED` | 429 | 配额超限 | 超过调用配额 |
| **400003** | `CONCURRENT_LIMIT` | 429 | 并发超限 | 超过并发会话数 |
| **500001** | `SESSION_NOT_FOUND` | 404 | 会话不存在 | 操作不存在的会话 |
| **500002** | `SESSION_CLOSED` | 409 | 会话已关闭 | 对已关闭会话操作 |
| **500003** | `SESSION_EXPIRED` | 410 | 会话已过期 | 会话超过最大存活时间 |
| **500004** | `MESSAGE_NOT_FOUND` | 404 | 消息不存在 | 引用不存在的消息 |
| **500005** | `TASK_NOT_FOUND` | 404 | 任务不存在 | 操作不存在的任务 |
| **600001** | `TOOL_NOT_FOUND` | 404 | 工具不存在 | 调用未注册的工具 |
| **600002** | `TOOL_EXECUTION_FAILED` | 500 | 工具执行失败 | 工具内部异常 |
| **600003** | `TOOL_TIMEOUT` | 504 | 工具执行超时 | 工具执行超过超时时间 |
| **600004** | `TOOL_NOT_ALLOWED` | 403 | 工具未授权 | 会话未授权该工具 |
| **700001** | `LLM_ERROR` | 502 | LLM 调用错误 | LLM 服务返回错误 |
| **700002** | `LLM_TIMEOUT` | 504 | LLM 调用超时 | LLM 响应超时 |
| **700003** | `LLM_RATE_LIMIT` | 429 | LLM 限流 | LLM 服务限流 |
| **700004** | `LLM_INVALID_RESPONSE` | 502 | LLM 响应无效 | LLM 返回无法解析的内容 |
| **800001** | `MEMORY_ERROR` | 500 | 记忆模块错误 | 记忆读写异常 |
| **800002** | `MEMORY_FULL` | 507 | 记忆存储已满 | 向量存储空间不足 |
| **900001** | `CHANNEL_ERROR` | 500 | 渠道错误 | 渠道层异常 |
| **900002** | `CHANNEL_DISCONNECTED` | 503 | 渠道断开 | 渠道连接断开 |

### 7.3 错误对象结构

```typescript
// src/core/errors/codes.ts

/**
 * 错误码常量定义
 * 命名规则：模块前缀 + 含义
 * 取值规则：6 位数字，前 2 位为模块段
 */
export const ErrorCode = {
  // 通用错误 (100xxx)
  UNKNOWN: 100000,
  INTERNAL: 100001,
  NOT_IMPLEMENTED: 100002,
  SERVICE_UNAVAILABLE: 100003,
  TIMEOUT: 100004,

  // 校验错误 (200xxx)
  VALIDATION: 200001,
  INVALID_FORMAT: 200002,
  MISSING_FIELD: 200003,
  INVALID_TYPE: 200004,
  CONFIG: 200005,

  // 鉴权错误 (300xxx)
  UNAUTHORIZED: 300001,
  FORBIDDEN: 300002,
  TOKEN_EXPIRED: 300003,
  TOKEN_INVALID: 300004,

  // 限流错误 (400xxx)
  RATE_LIMIT: 400001,
  QUOTA_EXCEEDED: 400002,
  CONCURRENT_LIMIT: 400003,

  // 会话/消息/任务错误 (500xxx)
  SESSION_NOT_FOUND: 500001,
  SESSION_CLOSED: 500002,
  SESSION_EXPIRED: 500003,
  MESSAGE_NOT_FOUND: 500004,
  TASK_NOT_FOUND: 500005,

  // 工具错误 (600xxx)
  TOOL_NOT_FOUND: 600001,
  TOOL_EXECUTION_FAILED: 600002,
  TOOL_TIMEOUT: 600003,
  TOOL_NOT_ALLOWED: 600004,

  // LLM 错误 (700xxx)
  LLM_ERROR: 700001,
  LLM_TIMEOUT: 700002,
  LLM_RATE_LIMIT: 700003,
  LLM_INVALID_RESPONSE: 700004,

  // 记忆错误 (800xxx)
  MEMORY_ERROR: 800001,
  MEMORY_FULL: 800002,

  // 渠道错误 (900xxx)
  CHANNEL_ERROR: 900001,
  CHANNEL_DISCONNECTED: 900002,
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];
```

```typescript
// src/core/errors/AppError.ts

/**
 * 统一应用错误类
 * 所有业务错误都应抛出 AppError 或其子类，避免抛出原始 Error
 */
export class AppError extends Error {
  /** 错误码，见 ErrorCode 常量 */
  readonly code: number;
  /** 对应的 HTTP 状态码 */
  readonly statusCode: number;
  /** 错误详情（字段级错误信息，用于校验错误） */
  readonly details?: Array<{ field: string; message: string }>;
  /** 原始错误（用于链式追踪） */
  readonly cause?: unknown;
  /** 是否可重试 */
  readonly retryable: boolean;

  constructor(params: {
    code: number;
    message: string;
    statusCode?: number;
    details?: Array<{ field: string; message: string }>;
    cause?: unknown;
    retryable?: boolean;
  }) {
    super(params.message);
    this.name = 'AppError';
    this.code = params.code;
    this.statusCode = params.statusCode ?? 500;
    this.details = params.details;
    this.cause = params.cause;
    this.retryable = params.retryable ?? false;
    // 保持原型链（TypeScript 继承 Error 的已知问题修复）
    Object.setPrototypeOf(this, AppError.prototype);
  }

  /** 转换为 JSON 响应体 */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
    };
  }
}

/**
 * 校验错误工厂
 */
export function validationError(
  message: string,
  details: Array<{ field: string; message: string }>
): AppError {
  return new AppError({
    code: ErrorCode.VALIDATION,
    message,
    statusCode: 400,
    details,
    retryable: false,
  });
}

/**
 * 未认证错误工厂
 */
export function unauthorizedError(message = '未认证'): AppError {
  return new AppError({
    code: ErrorCode.UNAUTHORIZED,
    message,
    statusCode: 401,
    retryable: false,
  });
}

/**
 * 未找到错误工厂
 */
export function notFoundError(code: number, message: string): AppError {
  return new AppError({
    code,
    message,
    statusCode: 404,
    retryable: false,
  });
}
```

---

## 8. 生命周期钩子 Hooks 机制

### 8.1 src/hooks 目录结构

```
src/hooks/
├── types.ts          # 钩子类型定义
├── registry.ts       # 钩子注册中心（全局单例）
├── pipeline.ts       # 钩子执行管线（顺序执行、错误隔离）
└── builtin/          # 内置钩子
    ├── logging.ts    # 日志记录钩子
    ├── metrics.ts    # 指标采集钩子
    └── sanitize.ts   # 数据脱敏钩子
```

钩子机制允许在不修改核心业务逻辑的前提下，插入横切关注点（日志、指标、脱敏、审计、限流等）。Hooks 模块位于 Core 之上、业务模块之下，被所有业务模块共享。

### 8.2 钩子类型定义

```typescript
// src/hooks/types.ts
import type { Message, Session, Task } from '@/core/types';

/**
 * 钩子事件类型
 * 对应系统生命周期的关键节点
 */
export type HookEvent =
  | 'message.pre'        // 消息处理前（前置拦截）
  | 'message.post'       // 消息处理后（后置拦截）
  | 'session.create'     // 会话创建
  | 'session.close'      // 会话关闭
  | 'task.start'         // 任务开始
  | 'task.complete'      // 任务完成
  | 'task.fail'          // 任务失败
  | 'tool.pre'           // 工具执行前
  | 'tool.post'          // 工具执行后
  | 'llm.pre'            // LLM 调用前
  | 'llm.post';          // LLM 调用后

/**
 * 钩子上下文，传递给钩子函数
 * 包含当前事件相关的数据与可调用方法
 */
export interface HookContext<TEvent extends HookEvent> {
  /** 触发的事件名 */
  event: TEvent;
  /** 事件相关数据（类型根据事件不同） */
  data: HookEventData<TEvent>;
  /** 中止处理：调用后停止后续钩子与业务逻辑 */
  abort: (reason?: string) => never;
  /** 修改数据（前置钩子可修改将被处理的数据） */
  mutate: (newData: Partial<HookEventData<TEvent>>) => void;
  /** 日志器 */
  log: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: object) => void;
}

/**
 * 事件数据类型映射
 */
export interface HookEventData<TEvent extends HookEvent> {
  'message.pre': { message: Message };
  'message.post': { message: Message; response: Message };
  'session.create': { session: Session };
  'session.close': { session: Session; reason?: string };
  'task.start': { task: Task };
  'task.complete': { task: Task; result: string };
  'task.fail': { task: Task; error: string };
  'tool.pre': { toolName: string; args: Record<string, unknown> };
  'tool.post': { toolName: string; args: Record<string, unknown>; result: unknown; durationMs: number };
  'llm.pre': { prompt: string; model: string };
  'llm.post': { prompt: string; response: string; model: string; tokensIn: number; tokensOut: number; durationMs: number };
}

/**
 * 钩子函数签名
 * - 同步或异步均可
 * - 返回 void 表示继续；抛出错误表示中断
 */
export type HookHandler<TEvent extends HookEvent> = (
  ctx: HookContext<TEvent>
) => void | Promise<void>;

/**
 * 钩子注册项
 */
export interface HookRegistration<TEvent extends HookEvent> {
  /** 钩子名称，用于注销与日志 */
  name: string;
  /** 监听的事件 */
  event: TEvent;
  /** 钩子函数 */
  handler: HookHandler<TEvent>;
  /** 优先级（数字越小越先执行，默认 100） */
  priority?: number;
  /** 是否启用 */
  enabled?: boolean;
}
```

### 8.3 钩子执行顺序

同一事件的多个钩子按 `priority` 升序执行（数字小先执行）：

```
[message.pre 事件触发]
        │
        ▼
┌───────────────────────┐
│ priority=10: sanitize │  数据脱敏（最先执行）
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│ priority=50: auth     │  鉴权检查
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│ priority=80: ratelimit│  限流检查
└───────────┬───────────┘
            ▼
┌───────────────────────┐
│ priority=100: logging │  日志记录（默认）
└───────────┬───────────┘
            ▼
[业务逻辑执行]
```

执行规则：

1. **顺序执行**：同事件钩子按 priority 升序同步等待执行。
2. **错误隔离**：单个钩子抛错默认不中断后续钩子，记录日志后继续（可通过配置改为严格模式）。
3. **中止机制**：钩子调用 `ctx.abort()` 立即停止所有后续钩子与业务逻辑，抛出 `AbortError`。
4. **数据修改**：前置钩子可通过 `ctx.mutate()` 修改将被处理的数据（如脱敏后的消息）。

### 8.4 消息前置/后置拦截

`message.pre` 与 `message.post` 是最常用的两个钩子，分别用于消息处理前后的拦截：

```typescript
// src/hooks/builtin/sanitize.ts
import { registerHook } from '@/hooks/registry';
import type { HookContext, HookEvent } from '@/hooks/types';

/**
 * 数据脱敏钩子（前置拦截）
 * 在消息进入 Agent Runtime 前脱敏敏感信息
 */
registerHook({
  name: 'sanitize-sensitive-data',
  event: 'message.pre',
  priority: 10, // 最先执行
  handler: (ctx: HookContext<'message.pre'>) => {
    const { message } = ctx.data;
    // 脱敏手机号：138****1234
    const sanitized = message.content.replace(
      /1[3-9]\d{9}/g,
      (match) => match.slice(0, 3) + '****' + match.slice(-4)
    );
    // 脱敏身份证号
    const finalContent = sanitized.replace(
      /\d{17}[\dXx]/g,
      (match) => match.slice(0, 6) + '********' + match.slice(-4)
    );
    // 修改消息内容
    ctx.mutate({
      message: { ...message, content: finalContent },
    });
    ctx.log('debug', '消息已脱敏', { messageId: message.id });
  },
});
```

```typescript
// src/hooks/builtin/logging.ts
import { registerHook } from '@/hooks/registry';

/**
 * 消息日志钩子（后置记录）
 * 记录消息处理结果，用于审计与排查
 */
registerHook({
  name: 'message-logging',
  event: 'message.post',
  priority: 100,
  handler: (ctx) => {
    const { message, response } = ctx.data;
    ctx.log('info', '消息处理完成', {
      messageId: message.id,
      sessionId: message.sessionId,
      responseLength: response.content.length,
      durationMs: Date.now() - message.timestamp,
    });
  },
});
```

```typescript
// src/hooks/builtin/metrics.ts
import { registerHook } from '@/hooks/registry';

/**
 * 指标采集钩子
 * 统计 LLM 调用 token 消耗与延迟
 */
registerHook({
  name: 'llm-metrics',
  event: 'llm.post',
  priority: 100,
  handler: (ctx) => {
    const { model, tokensIn, tokensOut, durationMs } = ctx.data;
    // 上报到指标系统（Prometheus / StatsD）
    metrics.increment('llm.calls', { model });
    metrics.histogram('llm.tokens_in', tokensIn, { model });
    metrics.histogram('llm.tokens_out', tokensOut, { model });
    metrics.histogram('llm.latency_ms', durationMs, { model });
  },
});
```

---

## 9. 使用示例代码

### 9.1 创建并校验消息

```typescript
// 示例：构造一条用户消息并通过 TypeBox 校验
import { generateId, now } from '@/core/utils';
import { createTypeBoxValidator } from '@/core/schemas';
import { MessageSchema } from '@/core/schemas/message.schema';

// 1. 构造原始消息对象
const rawMessage = {
  id: generateId(), // 生成 ulid
  channelId: 'ws-18780',
  userId: 'user-001',
  sessionId: 'session-001',
  type: 'text' as const,
  role: 'user' as const,
  content: '请帮我分析这份销售数据',
  attachments: [
    {
      id: generateId(),
      type: 'file' as const,
      url: 'file:///data/sales-2026-q2.csv',
      mimeType: 'text/csv',
      filename: 'sales-2026-q2.csv',
      size: 102400,
    },
  ],
  timestamp: now(),
  metadata: { source: 'web-client', clientVersion: '1.2.0' },
};

// 2. 创建校验器并校验
const messageValidator = createTypeBoxValidator(MessageSchema);

try {
  // 校验通过返回类型化数据，失败抛出 ValidationError
  const message = messageValidator.validate(rawMessage);
  console.log('消息校验通过:', message.id);
  // 此处 message 类型为 Message，可安全使用
} catch (error) {
  // 校验失败，error 为 ValidationError，包含字段级错误详情
  console.error('消息校验失败:', error.details);
}
```

### 9.2 会话管理示例

```typescript
// 示例：创建会话、发送消息、查询会话状态
import { createLogger } from '@/core/utils';

const log = createLogger('demo-session');

// 1. 创建会话
const session = await agentRuntime.createSession({
  userId: 'user-001',
  channelId: 'ws-18780',
  config: {
    agentId: 'default-agent',
    model: 'gpt-4o',
    memoryWindowSize: 20,
    longTermMemoryEnabled: true,
    temperature: 0.7,
    maxTokens: 4096,
    allowedTools: ['search', 'calculator', 'data_analyzer'],
  },
});

log.info({ sessionId: session.id }, '会话已创建');

// 2. 发送消息（触发 Agent 处理）
const userMessage: Message = {
  id: generateId(),
  channelId: 'ws-18780',
  userId: 'user-001',
  sessionId: session.id,
  type: 'text',
  role: 'user',
  content: '帮我计算 Q2 总销售额',
  attachments: [],
  timestamp: now(),
  metadata: {},
};

const response = await agentRuntime.sendMessage(userMessage);
log.info({ responseId: response.id }, '收到 Agent 响应');

// 3. 查询会话状态（统计信息实时更新）
const updated = await agentRuntime.getSession(session.id);
log.info(
  {
    messageCount: updated.stats.messageCount,
    toolCallCount: updated.stats.toolCallCount,
    totalTokens: updated.stats.totalTokens,
  },
  '会话统计'
);

// 4. 关闭会话
await agentRuntime.closeSession(session.id, '用户主动关闭');
log.info({ sessionId: session.id }, '会话已关闭');
```

### 9.3 注册自定义钩子

```typescript
// 示例：注册自定义审计钩子，记录所有工具调用
import { registerHook } from '@/hooks/registry';

registerHook({
  name: 'audit-tool-call',
  event: 'tool.post',
  priority: 50,
  handler: async (ctx) => {
    const { toolName, args, result, durationMs } = ctx.data;

    // 写入审计日志（异步，不阻塞业务）
    await auditLog.write({
      timestamp: Date.now(),
      event: 'tool_call',
      toolName,
      args: JSON.stringify(args),
      result: JSON.stringify(result).slice(0, 1000), // 截断防过大
      durationMs,
      sessionId: ctx.data.sessionId, // 假设上下文携带
    });

    ctx.log('debug', '工具调用已审计', { toolName });
  },
});

// 注册前置限流钩子
registerHook({
  name: 'custom-rate-limit',
  event: 'message.pre',
  priority: 80,
  handler: (ctx) => {
    const { message } = ctx.data;
    const count = rateLimiter.getCount(message.userId);
    if (count > 100) {
      // 超过限流，中止处理
      ctx.abort('用户请求频率超限');
    }
  },
});
```

### 9.4 错误处理示例

```typescript
// 示例：统一的错误处理模式
import { AppError, ErrorCode } from '@/core/errors';

async function handleMessage(message: Message): Promise<Message> {
  try {
    // 业务逻辑
    return await agentRuntime.process(message);
  } catch (error) {
    // 区分 AppError 与未知错误
    if (error instanceof AppError) {
      // 已知业务错误，按错误码处理
      switch (error.code) {
        case ErrorCode.SESSION_CLOSED:
          // 会话已关闭，提示用户重新创建
          return createErrorMessage('会话已关闭，请重新开始对话');
        case ErrorCode.RATE_LIMIT:
          // 限流，提示稍后重试
          return createErrorMessage('请求过于频繁，请稍后再试');
        case ErrorCode.LLM_TIMEOUT:
          // LLM 超时，可重试
          if (error.retryable) {
            return await retry(() => agentRuntime.process(message), { maxRetries: 2 });
          }
          return createErrorMessage('AI 响应超时，请重试');
        default:
          // 其他业务错误，透传错误信息
          return createErrorMessage(error.message);
      }
    }
    // 未知错误，记录并返回通用错误
    logger.error({ err: error, messageId: message.id }, '未捕获异常');
    return createErrorMessage('系统内部错误，请联系管理员');
  }
}

/** 构造错误消息 */
function createErrorMessage(text: string): Message {
  return {
    id: generateId(),
    channelId: 'system',
    userId: 'system',
    sessionId: 'system',
    type: 'error',
    role: 'system',
    content: text,
    attachments: [],
    timestamp: now(),
    metadata: {},
  };
}
```

---

## 附录：Core 模块依赖关系

```
                ┌──────────────────────────────────┐
                │          业务模块层                │
                │  Channels / Gateway / Agent /     │
                │  Tools / Memory                   │
                └──────────────┬───────────────────┘
                               │ 全部依赖
                ┌──────────────▼───────────────────┐
                │           Core 模块               │
                │  ┌──────────────────────────┐    │
                │  │       types/             │ ◄── 无外部依赖
                │  │  message / session / task│    │
                │  └──────────────────────────┘    │
                │  ┌──────────────────────────┐    │
                │  │      schemas/            │ ◄── 依赖 types + typebox/zod
                │  │  校验 Schema + Validator │    │
                │  └──────────────────────────┘    │
                │  ┌──────────────────────────┐    │
                │  │      errors/             │ ◄── 依赖 types
                │  │  ErrorCode + AppError    │    │
                │  └──────────────────────────┘    │
                │  ┌──────────────────────────┐    │
                │  │      utils/              │ ◄── 依赖 errors（部分）
                │  │  id/time/logger/retry... │    │
                │  └──────────────────────────┘    │
                │  ┌──────────────────────────┐    │
                │  │     constants/           │ ◄── 无外部依赖
                │  │  ports/timeouts/events   │    │
                │  └──────────────────────────┘    │
                └──────────────────────────────────┘
                               │
                ┌──────────────▼───────────────────┐
                │          Hooks 模块               │
                │  registry / pipeline / builtin    │
                │  依赖 Core.types                  │
                └──────────────────────────────────┘
```

---

> **相关文档**
> - [07-Agent Runtime 运行时层](./07-Agent运行时层.md)
> - [09-API 接口文档](./09-API接口文档.md)
> - [10-开发指南](./10-开发指南.md)
