from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any
from uuid import uuid4

from .gateway_client import BaseGatewayClient, EventHandler
from .protocol import EventMessage


class MockGatewayClient(BaseGatewayClient):
    """A deterministic local Gateway substitute for offline TUI use and tests."""

    def __init__(self, delay: float = 0.01) -> None:
        self.connection_state = "disconnected"
        self.delay = delay
        self._handlers: set[EventHandler] = set()
        self._tasks: set[asyncio.Task[None]] = set()
        self._history: list[dict[str, Any]] = []

    async def connect(self) -> None:
        self.connection_state = "connected"

    async def disconnect(self) -> None:
        self.connection_state = "disconnected"
        for task in list(self._tasks):
            task.cancel()
        self._tasks.clear()

    def on_event(self, handler: EventHandler) -> Callable[[], None]:
        self._handlers.add(handler)

        def off() -> None:
            self._handlers.discard(handler)

        return off

    async def request(self, action: str, payload: dict[str, Any], timeout: float | None = None) -> dict[str, Any]:
        if action == "chat.send":
            session_id = str(payload.get("sessionId", "session-local"))
            content = str(payload.get("content", ""))
            work_mode = str(payload.get("workMode", "build"))
            intensity = str(payload.get("intensity", "max"))
            model = str(payload.get("model", "deepseek-v4-pro"))
            self._history.append({"messageId": f"user-{uuid4()}", "role": "user", "content": content, "timestamp": 0})
            task = asyncio.create_task(self._stream_reply(session_id, content, work_mode, intensity, model))
            self._tasks.add(task)
            task.add_done_callback(lambda t: self._tasks.discard(t))
            return {"matched": True, "sessionId": session_id, "agentId": "default"}
        if action == "chat.cancel":
            for task in list(self._tasks):
                task.cancel()
            self._tasks.clear()
            return {"cancelled": True}
        if action == "chat.history":
            offset = int(payload.get("offset", 0) or 0)
            limit = int(payload.get("limit", 20) or 20)
            messages = self._history[offset:offset + limit]
            return {
                "sessionId": str(payload.get("sessionId", "session-local")),
                "messages": messages,
                "hasMore": offset + limit < len(self._history),
                "total": len(self._history),
                "offset": offset,
                "limit": limit,
            }
        return {}

    async def _stream_reply(self, session_id: str, prompt: str, work_mode: str = "build", intensity: str = "max", model: str = "deepseek-v4-pro") -> None:
        reasoning = f"Input: {prompt[:40]}\nPlan: understand the request and answer clearly."
        reply = self._build_reply(prompt, work_mode, intensity, model)
        await asyncio.sleep(self.delay)
        self._emit("chat.reasoning_delta", {"sessionId": session_id, "delta": reasoning, "accumulated": reasoning})
        accumulated = ""
        for chunk in self._chunks(reply, 5):
            await asyncio.sleep(self.delay)
            accumulated += chunk
            self._emit("chat.delta", {"sessionId": session_id, "delta": chunk, "accumulated": accumulated})
        message_id = f"assistant-{uuid4()}"
        self._history.append({"messageId": message_id, "role": "assistant", "content": reply, "timestamp": 0})
        self._emit("chat.done", {
            "sessionId": session_id,
            "messageId": message_id,
            "totalContent": reply,
            "totalReasoning": reasoning,
            "reasoningDurationMs": int(self.delay * 1000),
            "durationMs": int(self.delay * 1000 * max(1, len(reply) // 5)),
        })

    def _emit(self, event_name: str, payload: dict[str, Any]) -> None:
        event = EventMessage.from_dict({"type": "event", "event": event_name, "payload": payload})
        for handler in list(self._handlers):
            handler(event)

    def _build_reply(self, prompt: str, work_mode: str = "build", intensity: str = "max", model: str = "deepseek-v4-pro") -> str:
        if not prompt.strip():
            base = "Hello, I am the MyOpenClaw mock assistant."
        else:
            base = f"Mock reply: I received \"{prompt.strip()}\". The real Gateway can replace this stream when connected."
        suffix = f"\n\n[mock] workMode={work_mode} intensity={intensity} model={model}"
        return base + suffix

    @staticmethod
    def _chunks(text: str, size: int) -> list[str]:
        return [text[i:i + size] for i in range(0, len(text), size)]
