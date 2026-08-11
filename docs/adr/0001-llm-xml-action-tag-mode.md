# ADR 0001: LLM 走 XML action tag 模式而非 OpenAI function_calling

> **状态**：Accepted
> **日期**：2026-07-29
> **决策者**：MyOpenClaw Core Team

## 背景

`AgentOrchestrator.phaseThink` 调用 LLM 时，需要决定怎么让 LLM 表达"我想调工具"的意图。两种主流方案：

1. **OpenAI function_calling 协议**：在 `chat.completions.create({ tools: [...] })` 里声明工具列表，LLM 返回 `tool_calls` 字段
2. **XML action tag 模式**：在系统提示词里用文字描述工具列表，LLM 在文本里输出 `<action name="..." args='...' />` 这种结构化 XML

## 决策

**采用方案 2（XML action tag），不传 `tools` 给 LLM**。

## 原因

### 双路径冲突（最核心原因）

如果同时：
- 给 LLM 传 `tools` 数组（启用 function_calling）
- 系统提示词又教 LLM 输出 `<action>` XML

LLM 会**两条路都走**：
- 走 function_calling：`response.choices[0].message.tool_calls` 有内容
- 走 XML：LLM 同时在 `response.choices[0].message.content` 里输出 `<action ...>`

Orchestrator 的 Planner 只解析 XML，**function_calling 的 `tool_calls` 会被完全忽略**。结果：LLM 以为自己调了工具（甚至 response 里说"我已读取文件"），但实际上 **Planner 没拿到 action、ToolRegistry 没被调用**，整个 ReAct 循环就死锁了。

### 实测证据

- 之前我修过的 "agent 重复输出同一句话 + 问题不回答" bug，根因就是这个：LLM 走 function_calling 输出 `tool_calls`，Planner 不解析，phaseAct 永远空数组，loop 跑到 max_iterations 后 Orchestrator 把 LLM 的"我已调用 web-search"文字当 final_answer 输出，用户看到的就是 LLM 重复说同一句话。
- DeepSeek API 校验更严：第二次 LLM 调用时（Reflect 阶段），如果上一轮的 `assistant` 消息里有 `tool_calls` 声明但对应的 `role: 'tool'` 消息**缺 `tool_call_id`**，会报 `messages[N]: missing field 'tool_call_id' at line 1 column 3676` → 整个请求 400 拒绝。

### XML 模式的实际优势

- **透明可读**：`<action>` 标签人类可直接读懂，便于调试
- **协议灵活**：不绑定 OpenAI 协议，DeepSeek / Claude / Gemini / Qwen / 自部署模型都能用
- **工具列表动态**：提示词里描述工具比 function_calling 的 schema 灵活（可以写"使用场景"、"注意事项"等长描述）
- **可降级**：LLM 不支持 function_calling 也能跑

### 代价

- JSON args 解析需要容错（已在 `Planner.safeParseJson` 处理）
- 工具描述不能太长，否则撑爆 context window（限制 `<action>` 描述 ≤ 500 字符）

## 约束

- Orchestrator 内部**禁止**调用 `LLMAdapter.chat({ tools: [...] })`
- 工具列表必须在系统提示词的 `## 可用工具` 章节里以 Markdown 列表形式呈现
- LLM 输出必须包含 `<action>` 或 `<final_answer>` 二选一（Planner 检测两者都没有则视为"无子任务"）

## 实现位置

- `server/src/agents/orchestrator.ts:618-622` — `phaseThink` 不传 `tools`
- `server/src/agents/orchestrator.ts:1021-1040` — `buildSystemPrompt` 写工具描述
- `server/src/agents/planner.ts:360-373` — `parseCoT` 解析 XML

## 未来变更触发条件

- 如果未来想支持 function_calling 模式（如 OpenAI Assistants API），需要：
  1. 拆出独立的 LLMAdapter profile（"xml" vs "function_calling"）
  2. Planner 增加 tool_calls 解析路径
  3. Orchestrator 循环里区分两种模式的工具结果回填方式
  4. 新写一份 ADR 0002
