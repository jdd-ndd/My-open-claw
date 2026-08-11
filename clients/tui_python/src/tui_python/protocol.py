from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

MessageType = Literal["request", "response", "event", "ping", "pong"]


@dataclass(slots=True)
class GatewayMessage:
    type: MessageType
    id: str = field(default_factory=lambda: str(uuid4()))
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> dict[str, Any]:
        return {"type": self.type, "id": self.id, "timestamp": self.timestamp}


@dataclass(slots=True)
class RequestMessage(GatewayMessage):
    action: str = ""
    payload: dict[str, Any] = field(default_factory=dict)

    def __init__(self, action: str, payload: dict[str, Any], message_id: str | None = None) -> None:
        GatewayMessage.__init__(self, type="request", id=message_id or str(uuid4()))
        self.action = action
        self.payload = payload

    def to_dict(self) -> dict[str, Any]:
        data = GatewayMessage.to_dict(self)
        data.update({"action": self.action, "payload": self.payload})
        return data


@dataclass(slots=True)
class ResponseMessage(GatewayMessage):
    request_id: str = ""
    status: Literal["success", "error"] = "success"
    payload: dict[str, Any] = field(default_factory=dict)
    error_code: str | None = None
    error_message: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ResponseMessage":
        msg = cls(type="response", id=str(data.get("id", uuid4())))
        msg.timestamp = str(data.get("timestamp", msg.timestamp))
        msg.request_id = str(data.get("requestId", data.get("request_id", "")))
        msg.status = "error" if data.get("status") == "error" else "success"
        msg.payload = dict(data.get("payload") or {})
        msg.error_code = data.get("errorCode") or data.get("error_code")
        msg.error_message = data.get("errorMessage") or data.get("error_message")
        return msg


@dataclass(slots=True)
class EventMessage(GatewayMessage):
    event: str = ""
    payload: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "EventMessage":
        msg = cls(type="event", id=str(data.get("id", uuid4())))
        msg.timestamp = str(data.get("timestamp", msg.timestamp))
        msg.event = str(data.get("event", ""))
        msg.payload = dict(data.get("payload") or {})
        return msg

    def to_dict(self) -> dict[str, Any]:
        data = GatewayMessage.to_dict(self)
        data.update({"event": self.event, "payload": self.payload})
        return data


def build_request(action: str, payload: dict[str, Any]) -> RequestMessage:
    return RequestMessage(action=action, payload=payload)


def parse_gateway_message(data: dict[str, Any]) -> GatewayMessage | ResponseMessage | EventMessage:
    msg_type = data.get("type")
    if msg_type == "response":
        return ResponseMessage.from_dict(data)
    if msg_type == "event":
        return EventMessage.from_dict(data)
    return GatewayMessage(type=msg_type if msg_type in {"request", "ping", "pong"} else "pong", id=str(data.get("id", uuid4())))
