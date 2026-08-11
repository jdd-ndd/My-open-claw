# Agent Runtime 模块

> 参考设计：[docs/05-Agent运行时模块.md](../../../docs/05-Agent运行时模块.md)

本目录实现 MyOpenClaw Agent 运行时（Lobster 循环）模块。当前阶段状态：

- ✅ **LLM Adapter**：完整实现，支持 DeepSeek / OpenAI / Claude / 本地（Ollama）四类厂商，含主备回退、SSE 流式、统一异常分类。
- ✅ **Orchestrator**：状态机 + 感知/思考阶段完整实装；规划/执行/观察/反思为占位流程。
- ✅ **Planner**：黑名单工具 + 黑名单命令 + 路径白名单 + CoT 解析 + 执行计划编排。
- ✅ **ReActLoop**：迭代计数器与阶段事件记录。
- ⚠️ **Lobster 完整六阶段循环、SubTask 拆解**：占位实现，将作为后续 Agent Runtime 阶段目标。

## 目录结构

```
src/agents/
├── index.ts            # 聚合导出
├── orchestrator.ts     # Lobster 主循环调度器
├── planner.ts          # 任务规划引擎
├── loop/
│   └── index.ts        # ReAct 循环计数器
├── llm/
│   ├── index.ts        # LLM 子模块统一导出
│   ├── types.ts        # 公共类型（Provider/Message/ToolCall 等）
│   ├── errors.ts       # LLMError / NotSupportedLLMError / LLMTimeoutError
│   ├── prompt.ts       # PromptBuilder 系统提示词构造器
│   ├── factory.ts      # LLMAdapterFactory + 自定义 Provider 注册
│   ├── llm-adapter.ts  # UnifiedLLMAdapter（主备回退封装）
│   ├── base-http-adapter.ts  # OpenAI 协议基类（DeepSeek / OpenAI / Local 复用）
│   ├── deepseek.ts     # DeepSeekAdapter
│   ├── openai.ts       # OpenAIAdapter
│   ├── claude.ts       # ClaudeAdapter（Anthropic Messages API）
│   └── local.ts        # LocalLLMAdapter（Ollama 等）
└── README.md
```

## LLM Adapter 使用示例

### 1. 基础对话（DeepSeek）

```typescript
import { LLMAdapterFactory } from '@/agents/llm';

const adapter = LLMAdapterFactory.create({
  provider: 'deepseek',
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY!,
});

const output = await adapter.chat({
  messages: [
    { role: 'system', content: '你是 MyOpenClaw 助手' },
    { role: 'user', content: '你好' },
  ],
  options: { temperature: 0.7, maxTokens: 2000 },
});

console.log(output.content);          // '你好！'
console.log(output.usage.totalTokens); // 12
console.log(output.finishReason);      // 'stop'
```

### 2. 切换到 Claude（仅修改配置）

```typescript
const adapter = LLMAdapterFactory.create({
  provider: 'claude',
  model: 'claude-3-5-sonnet-20241022',
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

// 调用方式完全一致 — 业务逻辑无需修改
const output = await adapter.chat({ messages: [...] });
```

### 3. 主备回退（DeepSeek 主 + OpenAI 备）

```typescript
import { LLMAdapterFactory, UnifiedLLMAdapter } from '@/agents/llm';

const primary = LLMAdapterFactory.create({
  provider: 'deepseek',
  model: 'deepseek-chat',
  apiKey: process.env.DEEPSEEK_API_KEY!,
});

const fallback = LLMAdapterFactory.create({
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
});

const adapter = new UnifiedLLMAdapter({
  primary,
  fallbacks: [fallback],
});

// 主失败时自动回退，主成功时无感使用主模型
await adapter.chat({ messages: [...] });
```

### 4. 工具调用（Function Calling）

```typescript
const output = await adapter.chat({
  messages: [{ role: 'user', content: '读取 /tmp/config.json' }],
  tools: [
    {
      name: 'fs/read_file',
      description: '读取本地文件',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  ],
  options: { toolChoice: 'auto' },
});

if (output.finishReason === 'tool_calls') {
  for (const call of output.toolCalls!) {
    console.log('调用工具:', call.function.name);
    console.log('参数:', call.function.arguments);
  }
}
```

### 5. 流式输出

```typescript
for await (const chunk of adapter.streamChat({ messages: [...] })) {
  process.stdout.write(chunk.delta); // 增量文本
  if (chunk.done && chunk.usage) {
    console.log(`\nToken: ${chunk.usage.totalTokens}`);
  }
}
```

### 6. 注册自定义厂商

```typescript
import { LLMAdapterFactory } from '@/agents/llm';
import type { LLMAdapter, LLMAdapterConfig, LLMChatInput, LLMChatOutput } from '@/agents/llm';

class CustomAdapter implements LLMAdapter {
  readonly id = 'custom:m';
  readonly displayName = 'Custom';
  readonly provider = 'custom' as const;
  readonly model = 'm';
  readonly supportsToolCalls = false;
  readonly supportsStreaming = false;
  readonly contextWindow = 4096;

  async chat(_input: LLMChatInput): Promise<LLMChatOutput> {
    // 实现自定义协议 ...
    return {
      content: 'ok',
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      model: this.model,
    };
  }
  // ... 其他方法
}

LLMAdapterFactory.register('custom', (cfg) => new CustomAdapter());
```

## Orchestrator 使用示例

```typescript
import { AgentOrchestrator } from '@/agents';

const orch = new AgentOrchestrator({
  llm: LLMAdapterFactory.create({
    provider: 'deepseek',
    model: 'deepseek-chat',
    apiKey: process.env.DEEPSEEK_API_KEY!,
  }),
  maxIterations: 10,
  llmTimeoutMs: 60_000,
});

// 监听状态变更
orch.onStateChange((state) => console.log('Agent 状态:', state));

// 监听阶段事件
orch.onStep((evt) => console.log(`[${evt.phase}] iter=${evt.iteration}: ${evt.detail}`));

// 执行
const result = await orch.run({
  message: '你好',
  sessionId: 's1',
  channelId: 'webchat',
  userId: 'u1',
});

console.log(result.reply);
console.log('iterations:', result.iterations);
console.log('tokens:', result.tokens);
```

## 配置文件示例

`config/agents/default.yaml` 中已配置三套 Agent：

| Agent ID | Provider | Model | 备注 |
|----------|----------|-------|------|
| `default` | deepseek | deepseek-chat | 默认 Agent |
| `code-reviewer` | claude | claude-3-5-sonnet | 高质量推理（默认未启用） |
| `local-assistant` | local | qwen2.5:7b | 本地 Ollama 隐私助手（默认未启用） |

### 环境变量

| 变量名 | 用途 |
|--------|------|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 |
| `OPENAI_API_KEY` | OpenAI API 密钥 |
| `ANTHROPIC_API_KEY` | Anthropic Claude API 密钥 |
| `LOCAL_LLM_API_KEY` / `OLLAMA_API_KEY` | 本地模型鉴权（Ollama 可不填） |

## DeepSeek 配置与参数参考

> 完整官方文档：[https://api-docs.deepseek.com/zh-cn/](https://api-docs.deepseek.com/zh-cn/)

### 支持的模型

| 模型 | 上下文窗口 | 默认 max_tokens | 默认思考模式 |
|------|-----------|----------------|------------|
| `deepseek-v4-flash` | 128k | 8192 | enabled |
| `deepseek-v4-pro` | 128k | 8192 | enabled |
| `deepseek-chat` | 32k | 4096 | disabled |
| `deepseek-reasoner` | 64k | 8192 | enabled |

> 注：`deepseek-chat` / `deepseek-reasoner` 将于 2026/07/24 弃用，分别对应 V4 flash 的非思考 / 思考模式。

### API 地址

| 协议 | baseUrl |
|------|---------|
| OpenAI 兼容 | `https://api.deepseek.com` |
| Anthropic 兼容 | `https://api.deepseek.com/anthropic` |

### 错误码

| HTTP | 含义 | 适配器分类 | 可重试 |
|------|------|-----------|-------|
| 400 | 请求体格式错误 | LLM_UNKNOWN | ❌ |
| 401 | 认证失败 / API Key 错误 | LLM_API_KEY_INVALID | ❌ |
| 402 | 余额不足 | LLM_UNKNOWN | ❌ |
| 422 | 请求体参数错误 | LLM_UNKNOWN | ❌ |
| 429 | 请求速率达到上限 | LLM_RATE_LIMIT | ✅ |
| 500 | 服务器内部故障 | LLM_UNKNOWN | ✅ |
| 503 | 服务器负载过高 | LLM_UNKNOWN | ✅ |

### 限速

| 模型 | 默认并发限制 |
|------|------------|
| `deepseek-v4-pro` | 500 |
| `deepseek-v4-flash` | 2500 |

> 超出并发限制将返回 HTTP 429。可通过 `user_id` 参数做 KVCache / 调度隔离。

### 思考模式（DeepSeek V4 / R1）

```typescript
import { LLMAdapterFactory } from '@/agents/llm';

const adapter = LLMAdapterFactory.create({
  provider: 'deepseek',
  model: 'deepseek-v4-pro',
  apiKey: process.env.DEEPSEEK_API_KEY!,
});

const output = await adapter.chat({
  messages: [{ role: 'user', content: '你好' }],
  deepseek: {
    thinking: { type: 'enabled' },  // 开启思考模式
    reasoningEffort: 'high',         // 推理强度：low/medium/high/xhigh/max
  },
});

console.log(output.content);         // 最终答案
console.log(output.reasoningContent); // 思考链（DeepSeek V4 / R1 特有）
console.log(output.usage.reasoningTokens); // 推理消耗的 token 数
```

### JSON 输出模式

```typescript
await adapter.chat({
  messages: [
    { role: 'system', content: '你是助手，请始终以 JSON 格式回复' },
    { role: 'user', content: '北京今天天气' },
  ],
  deepseek: { responseFormat: { type: 'json_object' } },
});
```

> 注意：使用 JSON 模式时需要在 system 或 user prompt 中明确指示模型生成 JSON，否则模型可能持续生成空白字符直到 `max_tokens` 上限。

### 工具调用（Function Calling）

```typescript
await adapter.chat({
  messages: [{ role: 'user', content: '读取 /tmp/config.json' }],
  tools: [
    {
      name: 'fs/read_file',
      description: '读取本地文件',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  ],
  options: { toolChoice: 'auto' },   // auto | none | required
  deepseek: { strictTools: true },   // Beta：严格模式确保输出符合 JSON Schema
});
```

> DeepSeek 单次请求最多支持 128 个 function 工具。

### 用户隔离（user_id）

```typescript
await adapter.chat({
  messages: [{ role: 'user', content: '...' }],
  deepseek: { userId: 'u_12345' },   // [a-zA-Z0-9\-_]+，最长 512
});
```

`user_id` 用于：
- 内容安全隔离
- KVCache 缓存隔离（隐私管理）
- 调度隔离（提升配额后生效）

### 流式输出（含思考链）

```typescript
for await (const chunk of adapter.streamChat({
  messages: [{ role: 'user', content: '你好' }],
  deepseek: {
    thinking: { type: 'enabled' },
    streamOptions: { includeUsage: true },
  },
})) {
  if (chunk.reasoningDelta) process.stdout.write(`[思考]${chunk.reasoningDelta}`);
  if (chunk.delta) process.stdout.write(chunk.delta);
  if (chunk.done && chunk.usage) {
    console.log(`\nToken: ${chunk.usage.totalTokens}`);
    console.log(`KVCache hit: ${chunk.usage.promptCacheHitTokens}`);
  }
}
```

### 对话前缀续写（Beta）

启用后模型以指定的 assistant 前缀续写（用于强制 JSON 输出、对话续写）：

```typescript
await adapter.chat({
  messages: [
    { role: 'user', content: '生成 3 个颜色' },
    {
      role: 'assistant',
      content: '',
      // 透传给 baseUrl="https://api.deepseek.com/beta"
    },
  ],
});
```

### 错误处理

所有适配器抛出 `LLMError`（继承 `AppError`），关键字段：

```typescript
{
  llmCode: 'LLM_API_KEY_INVALID' | 'LLM_RATE_LIMIT' | 'LLM_TIMEOUT' | 'LLM_INVALID_RESPONSE' | 'LLM_NOT_SUPPORTED' | 'LLM_UNKNOWN' | 'LLM_NETWORK' | 'LLM_CONTEXT_OVERFLOW',
  provider: string,
  model: string,
  httpStatus?: number,
  retryable: boolean,
  message: string,
  cause?: unknown,
}
```

`UnifiedLLMAdapter` 会自动根据 `retryable` 判断是否回退到备用适配器。

## 测试

```bash
# 仅跑 agents 模块单测
pnpm test:unit tests/unit/agents

# 跑全部单测并查看覆盖率
pnpm test:coverage
```

`src/agents` 模块当前覆盖率：
- 行：**93.76%**
- 分支：**86.76%**
- 函数：**95.83%**

均超出 80% 阈值要求。