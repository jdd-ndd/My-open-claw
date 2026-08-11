from __future__ import annotations

import re
import time
from collections.abc import Awaitable, Callable
from typing import Any
from uuid import uuid4

from .models import ActiveStream, ChatMessage, ChatState, HistoryMessage, HistoryResponse

RequestFn = Callable[[str, dict[str, Any], float | None], Awaitable[dict[str, Any]]]


def format_now() -> str:
    return time.strftime("%H:%M")


def now_ms() -> int:
    return int(time.time() * 1000)


FINAL_ANSWER_RE = re.compile(r"<final_answer>(.*?)</final_answer>", re.DOTALL)
THOUGHT_RE = re.compile(r"<thought>(.*?)</thought>", re.DOTALL)
ACTION_RE = re.compile(r"<action\b[^>]*?(?:/>|>.*?</action>)", re.DOTALL)
TAG_RE = re.compile(r"</?(?:thought|final_answer|action)\b[^>]*>", re.DOTALL)
ACTION_FRAGMENT_RE = re.compile(
    r"(<action\b|</action>|\bargs\s*=|\bexec/shell\b|%USERPROFILE%|New-Item|GetFolderPath|\btimeout\b)",
    re.IGNORECASE,
)
TOOL_PENDING_MESSAGE = "工具调用已发起，但没有收到最终回复。请查看思考过程中的工具参数与执行结果，或重新发送请求。"


def split_tagged_reasoning(raw_reasoning: str) -> tuple[str, str]:
    """Extract final_answer from models that put tagged output in reasoning."""
    content, reasoning = normalize_tagged_output("", raw_reasoning)
    return content, reasoning


def extract_visible_content(text: str) -> str:
    """Best-effort extraction of user-visible assistant text from mixed tagged/tool output."""
    if not text.strip():
        return ""
    cleaned = ACTION_RE.sub("", text)
    cleaned = THOUGHT_RE.sub("", cleaned)
    cleaned = FINAL_ANSWER_RE.sub(lambda m: m.group(1), cleaned)
    cleaned = TAG_RE.sub("", cleaned)
    lines = [line.strip() for line in cleaned.splitlines()]
    visible_lines = [line for line in lines if line and not looks_like_action_fragment(line)]
    return "\n".join(visible_lines).strip()


def normalize_tagged_output(raw_content: str, raw_reasoning: str) -> tuple[str, str]:
    """Convert model XML-ish scratchpad output into display content and folded reasoning."""
    combined = "\n".join(part for part in [raw_reasoning.strip(), raw_content.strip()] if part)
    action_fragment = looks_like_action_fragment(raw_content)
    final_matches = FINAL_ANSWER_RE.findall(combined)
    thought_matches = THOUGHT_RE.findall(combined)
    action_matches = ACTION_RE.findall(combined)

    if final_matches:
        content = final_matches[-1].strip()
    else:
        content = ACTION_RE.sub("", raw_content)
        content = THOUGHT_RE.sub("", content)
        content = FINAL_ANSWER_RE.sub(lambda m: m.group(1), content)
        content = TAG_RE.sub("", content).strip()

    reasoning_parts: list[str] = []
    reasoning_parts.extend(part.strip() for part in thought_matches if part.strip())
    if raw_reasoning.strip() and not thought_matches:
        cleaned_reasoning = FINAL_ANSWER_RE.sub("", raw_reasoning)
        cleaned_reasoning = TAG_RE.sub("", cleaned_reasoning).strip()
        if cleaned_reasoning:
            reasoning_parts.append(cleaned_reasoning)
    reasoning_parts.extend(part.strip() for part in action_matches if part.strip())
    if action_fragment and raw_content.strip():
        reasoning_parts.append(raw_content.strip())

    visible_content = extract_visible_content(combined)

    if action_fragment and not final_matches and not content:
        content = TOOL_PENDING_MESSAGE
    if not content and action_matches:
        content = visible_content or TOOL_PENDING_MESSAGE
    if not content and reasoning_parts:
        content = visible_content or TOOL_PENDING_MESSAGE
    return content.strip(), "\n\n".join(reasoning_parts).strip()


def looks_like_action_fragment(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return False
    if FINAL_ANSWER_RE.search(stripped):
        return False
    return bool(ACTION_FRAGMENT_RE.search(stripped))


class ChatController:
    """Framework-independent chat state manager.

    This mirrors the TypeScript `useChat` behavior while staying easy to unit test.
    """

    def __init__(
        self,
        request: RequestFn,
        *,
        session_id: str = "session-local",
        channel_id: str = "tui",
        user_id: str = "tui-user",
        max_messages: int = 500,
        work_mode: str = "build",
        intensity: str = "max",
        model: str = "deepseek-v4-pro",
    ) -> None:
        self.request = request
        self.session_id = session_id
        self.channel_id = channel_id
        self.user_id = user_id
        self.max_messages = max_messages
        self.work_mode = work_mode
        self.intensity = intensity
        self.model = model
        self.state = ChatState(active_session_id=session_id)

    async def send_message(self, content: str) -> None:
        trimmed = content.strip()
        if not trimmed:
            return
        self.state.last_error = None
        stream_id = f"stream-{uuid4()}"
        message_time = format_now()
        self._append(ChatMessage(id=f"user-{uuid4()}", role="user", content=trimmed, time=message_time))
        self.state.active_stream = ActiveStream(
            id=stream_id,
            prompt=trimmed,
            time=message_time,
            session_id=self.state.active_session_id or self.session_id,
        )
        self.state.streaming_content = ""
        self.state.reasoning_content = ""
        self.state.reasoning_started_at_ms = None

        payload = {
            "sessionId": self.state.active_session_id or self.session_id,
            "content": trimmed,
            "channelId": self.channel_id,
            "userId": self.user_id,
            "messageType": "text",
            "workMode": self.work_mode,
            "intensity": self.intensity,
            "model": self.model,
        }
        try:
            response = await self.request("chat.send", payload, 10.0)
        except Exception as exc:  # noqa: BLE001 - user-facing failure capture
            self._fail_send(str(exc))
            return

        if response.get("sessionId"):
            new_session_id = str(response["sessionId"])
            self.state.active_session_id = new_session_id
            # 关键：用服务器返回的 sessionId 更新 WebSocket 连接的绑定
            # 这样服务器才能通过 broadcastToSession 广播 AI 回复到本端
            try:
                await self.request("session.bind", {
                    "sessionId": new_session_id,
                    "channelId": self.channel_id,
                    "userId": self.user_id,
                }, 3.0)
            except Exception:
                pass  # 绑定失败不阻断主流程，因为服务器已经通过 broadcastToChannel 广播了
        if response.get("matched") is False:
            self._append(ChatMessage(
                id=f"sys-{uuid4()}",
                role="system",
                content="[no agent matched] No routing rule handled this message.",
                time=format_now(),
            ))
            self.state.active_stream = None
            self.state.streaming_content = ""

    async def cancel_stream(self) -> None:
        self.state.active_stream = None
        self.state.streaming_content = ""
        self.state.reasoning_content = ""
        self.state.reasoning_started_at_ms = None
        try:
            await self.request("chat.cancel", {"sessionId": self.state.active_session_id or self.session_id}, 3.0)
        except Exception:
            pass

    async def load_history(self, offset: int = 0, limit: int = 20) -> None:
        if self.state.loading_history:
            return
        self.state.loading_history = True
        try:
            result = await self.request(
                "chat.history",
                {"sessionId": self.state.active_session_id or self.session_id, "offset": offset, "limit": limit},
                5.0,
            )
            history = self._history_from_payload(result)
            converted = [
                ChatMessage(id=m.message_id, role=m.role, content=m.content, time=format_now())
                for m in history.messages
            ]
            self.state.messages = converted + self.state.messages
            self.state.has_more_history = history.has_more
            self.state.total_history_count = history.total
            self.state.loaded_history_count = offset + len(converted)
        except Exception as exc:  # noqa: BLE001
            self.state.last_error = f"history load failed: {exc}"
        finally:
            self.state.loading_history = False

    async def load_more_history(self, limit: int = 20) -> None:
        if self.state.loading_history or not self.state.has_more_history:
            return
        await self.load_history(self.state.loaded_history_count, limit)

    def handle_event(self, event_name: str, payload: dict[str, Any]) -> None:
        self.state.last_event_name = event_name
        self.state.last_event_preview = str(payload)[:220]
        if payload.get("sessionId"):
            self.state.active_session_id = str(payload["sessionId"])
        if event_name == "chat.delta":
            accumulated = payload.get("accumulated")
            delta = payload.get("delta", "")
            if isinstance(accumulated, str):
                self.state.streaming_content = accumulated
            else:
                self.state.streaming_content += str(delta)
        elif event_name == "chat.reasoning_delta":
            if self.state.reasoning_started_at_ms is None:
                self.state.reasoning_started_at_ms = now_ms()
            accumulated = payload.get("accumulated")
            delta = payload.get("delta", "")
            if isinstance(accumulated, str):
                self.state.reasoning_content = accumulated
            else:
                self.state.reasoning_content += str(delta)
        elif event_name == "chat.error":
            if self.state.active_stream and self.state.streaming_content.strip():
                self._finish_stream({
                    "messageId": f"assistant-{uuid4()}",
                    "totalContent": self.state.streaming_content,
                    "totalReasoning": self.state.reasoning_content,
                    "reasoningDurationMs": (now_ms() - self.state.reasoning_started_at_ms) if self.state.reasoning_started_at_ms else None,
                    "error": True,
                })
                return
            self._event_error(payload)
        elif event_name == "chat.done":
            self._finish_stream(payload)
        elif event_name == "chat.message_sent":
            # 跨端同步：其他端（Web/CLI）发送的用户消息需要在本端显示
            self._handle_remote_message_sent(payload)

    def _handle_remote_message_sent(self, payload: dict[str, Any]) -> None:
        """处理 chat.message_sent 事件：将其他端发送的用户消息显示到本端。

        去重策略：
        1. 检查 active_stream.prompt —— 如果与本端正在处理的消息相同，说明是本端自己发送的，跳过
        2. 检查最近 10 条消息 —— 如果已有相同内容的用户消息，跳过（避免重复显示）
        """
        content = str(payload.get("content", "")).strip()
        if not content:
            return

        # 只处理当前会话的消息，避免跨会话干扰
        session_id = str(payload.get("sessionId", ""))
        if session_id and self.state.active_session_id and session_id != self.state.active_session_id:
            return

        # 去重 1：本端正在处理的流式消息（本端自己发送的）
        if self.state.active_stream and self.state.active_stream.prompt == content:
            return

        # 去重 2：检查最近的消息列表，避免重复显示
        for msg in self.state.messages[-10:]:
            if msg.role == "user" and msg.content == content:
                return

        # 添加其他端发送的用户消息到本地消息列表
        self._append(ChatMessage(
            id=f"user-remote-{uuid4()}",
            role="user",
            content=content,
            time=format_now(),
        ))

    def clear(self) -> None:
        self.state.messages.clear()
        self.state.active_stream = None
        self.state.streaming_content = ""
        self.state.reasoning_content = ""
        self.state.reasoning_started_at_ms = None
        self.state.last_error = None
        self.state.loading_history = False
        self.state.has_more_history = False
        self.state.total_history_count = 0
        self.state.loaded_history_count = 0
        self.state.last_event_name = None
        self.state.last_event_preview = None

    def append_system_message(self, content: str) -> None:
        """追加一条系统消息到消息列表（供 UI 层给出操作反馈）

        用于会话切换、模型切换等场景，让用户在消息流中看到明确的视觉提示，
        而非仅依赖一闪而过的 toast 通知。
        """
        self._append(ChatMessage(
            id=f"sys-{uuid4()}",
            role="system",
            content=content,
            time=format_now(),
        ))

    def _append(self, message: ChatMessage) -> None:
        self.state.messages.append(message)
        if len(self.state.messages) > self.max_messages:
            self.state.messages = self.state.messages[-self.max_messages:]

    def _finish_stream(self, payload: dict[str, Any]) -> None:
        content = str(payload.get("totalContent", self.state.streaming_content))
        reasoning = str(payload.get("totalReasoning") or self.state.reasoning_content).strip()
        if "<" in content or "<" in reasoning or looks_like_action_fragment(content):
            content, reasoning = normalize_tagged_output(content, reasoning)
        if not content or content == TOOL_PENDING_MESSAGE:
            fallback = extract_visible_content("\n".join(
                part for part in [
                    str(payload.get("totalContent", "") or ""),
                    self.state.streaming_content,
                    str(payload.get("totalReasoning", "") or ""),
                    self.state.reasoning_content,
                ] if part
            ))
            if fallback:
                content = fallback
        reasoning_duration = payload.get("reasoningDurationMs")
        if not isinstance(reasoning_duration, int) and self.state.reasoning_started_at_ms:
            reasoning_duration = now_ms() - self.state.reasoning_started_at_ms
        self._append(ChatMessage(
            id=str(payload.get("messageId") or f"assistant-{uuid4()}"),
            role="assistant",
            content=content,
            time=format_now(),
            reasoning=reasoning or None,
            reasoning_duration_ms=reasoning_duration if isinstance(reasoning_duration, int) else None,
        ))
        self.state.active_stream = None
        self.state.streaming_content = ""
        self.state.reasoning_content = ""
        self.state.reasoning_started_at_ms = None
        self.state.last_event_name = None
        self.state.last_event_preview = None

    def _event_error(self, payload: dict[str, Any]) -> None:
        code = str(payload.get("code", "SERVER_ERROR"))
        message = str(payload.get("message", "unknown error"))
        self.state.last_error = f"{code}: {message}"
        self._append(ChatMessage(id=f"err-{uuid4()}", role="system", content=f"[error {code}] {message}", time=format_now()))
        self.state.active_stream = None
        self.state.streaming_content = ""
        self.state.reasoning_content = ""
        self.state.reasoning_started_at_ms = None
        self.state.last_event_name = None
        self.state.last_event_preview = None

    def _fail_send(self, message: str) -> None:
        self.state.last_error = message
        self._append(ChatMessage(id=f"err-{uuid4()}", role="system", content=f"[send failed] {message}", time=format_now()))
        self.state.active_stream = None
        self.state.streaming_content = ""
        self.state.reasoning_content = ""
        self.state.reasoning_started_at_ms = None
        self.state.last_event_name = None
        self.state.last_event_preview = None

    def _history_from_payload(self, payload: dict[str, Any]) -> HistoryResponse:
        messages = []
        for raw in payload.get("messages", []):
            if not isinstance(raw, dict):
                continue
            role = raw.get("role") if raw.get("role") in {"user", "assistant", "system"} else "system"
            messages.append(HistoryMessage(
                message_id=str(raw.get("messageId", uuid4())),
                role=role,
                content=str(raw.get("content", "")),
                timestamp=int(raw.get("timestamp", 0) or 0),
            ))
        return HistoryResponse(
            session_id=str(payload.get("sessionId", self.session_id)),
            messages=messages,
            has_more=bool(payload.get("hasMore", False)),
            total=int(payload.get("total", len(messages)) or 0),
            offset=int(payload.get("offset", 0) or 0),
            limit=int(payload.get("limit", len(messages)) or 0),
        )
