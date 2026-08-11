from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from typing import Any

from .protocol import EventMessage, ResponseMessage, build_request, parse_gateway_message

EventHandler = Callable[[EventMessage], None]


class GatewayClientError(RuntimeError):
    pass


class BaseGatewayClient:
    connection_state: str = "disconnected"

    async def connect(self) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    async def disconnect(self) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    async def request(self, action: str, payload: dict[str, Any], timeout: float | None = None) -> dict[str, Any]:
        raise NotImplementedError

    def on_event(self, handler: EventHandler) -> Callable[[], None]:
        raise NotImplementedError


class WebSocketGatewayClient(BaseGatewayClient):
    def __init__(self, url: str, token: str | None = None) -> None:
        self.url = url
        self.token = token
        self.connection_state = "disconnected"
        self._ws: Any = None
        self._listener_task: asyncio.Task[None] | None = None
        self._pending: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._event_handlers: set[EventHandler] = set()

    async def connect(self) -> None:
        try:
            import websockets
        except ModuleNotFoundError as exc:  # pragma: no cover - depends on optional dep
            raise GatewayClientError("Missing dependency: websockets. Install project dependencies first.") from exc

        self.connection_state = "connecting"
        url = self.url
        if self.token:
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}token={self.token}"
        self._ws = await websockets.connect(url)
        self.connection_state = "connected"
        self._listener_task = asyncio.create_task(self._listen())

    async def disconnect(self) -> None:
        self.connection_state = "disconnected"
        if self._listener_task:
            self._listener_task.cancel()
            self._listener_task = None
        if self._ws:
            await self._ws.close()
            self._ws = None
        for future in self._pending.values():
            if not future.done():
                future.set_exception(GatewayClientError("disconnected"))
        self._pending.clear()

    async def request(self, action: str, payload: dict[str, Any], timeout: float | None = None) -> dict[str, Any]:
        if not self._ws or self.connection_state != "connected":
            await self.connect()
        if not self._ws or self.connection_state != "connected":
            raise GatewayClientError("ws not connected")
        message = build_request(action, payload)
        loop = asyncio.get_running_loop()
        future: asyncio.Future[dict[str, Any]] = loop.create_future()
        self._pending[message.id] = future
        await self._ws.send(json.dumps(message.to_dict(), ensure_ascii=False))
        try:
            return await asyncio.wait_for(future, timeout=timeout)
        finally:
            self._pending.pop(message.id, None)

    def on_event(self, handler: EventHandler) -> Callable[[], None]:
        self._event_handlers.add(handler)

        def off() -> None:
            self._event_handlers.discard(handler)

        return off

    async def _listen(self) -> None:
        try:
            async for raw in self._ws:
                try:
                    message = parse_gateway_message(json.loads(raw))
                except Exception:
                    continue
                if isinstance(message, ResponseMessage):
                    future = self._pending.get(message.request_id)
                    if not future or future.done():
                        continue
                    if message.status == "success":
                        future.set_result(message.payload)
                    else:
                        future.set_exception(GatewayClientError(message.error_message or message.error_code or "request failed"))
                elif isinstance(message, EventMessage):
                    for handler in list(self._event_handlers):
                        handler(message)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover - integration behavior
            self.connection_state = "disconnected"
            self._ws = None
            for future in self._pending.values():
                if not future.done():
                    future.set_exception(GatewayClientError(str(exc)))
