from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

Role = Literal["user", "assistant", "system"]
ConnectionState = Literal["disconnected", "connecting", "connected", "reconnecting"]
FocusArea = Literal["input", "messages", "sidebar"]
ViewMode = Literal["launch", "connecting", "chat"]
WorkMode = Literal["plan", "build"]
Intensity = Literal["low", "medium", "high", "max"]


@dataclass(slots=True)
class ChatMessage:
    id: str
    role: Role
    content: str
    time: str
    reasoning: str | None = None
    reasoning_duration_ms: int | None = None


@dataclass(slots=True)
class ActiveStream:
    id: str
    prompt: str
    time: str
    session_id: str


@dataclass(slots=True)
class HistoryMessage:
    message_id: str
    role: Role
    content: str
    timestamp: int


@dataclass(slots=True)
class HistoryResponse:
    session_id: str
    messages: list[HistoryMessage]
    has_more: bool
    total: int
    offset: int
    limit: int


@dataclass(slots=True)
class ChatState:
    messages: list[ChatMessage] = field(default_factory=list)
    active_stream: ActiveStream | None = None
    streaming_content: str = ""
    reasoning_content: str = ""
    reasoning_started_at_ms: int | None = None
    last_error: str | None = None
    last_event_name: str | None = None
    last_event_preview: str | None = None
    loading_history: bool = False
    has_more_history: bool = False
    total_history_count: int = 0
    loaded_history_count: int = 0
    active_session_id: str | None = None


GatewayPayload = dict[str, Any]
