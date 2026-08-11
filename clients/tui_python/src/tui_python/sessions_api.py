from __future__ import annotations

import json
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse, urlunparse
from urllib.request import Request, urlopen


@dataclass(slots=True)
class GatewaySession:
    session_id: str
    title: str
    created_at: int
    updated_at: int
    pinned_at: int | None
    status: str
    channel_id: str
    user_id: str
    agent_id: str
    metadata: dict[str, object]


def _http_base_from_ws(gateway_url: str) -> str:
    parsed = urlparse(gateway_url)
    scheme = 'https' if parsed.scheme == 'wss' else 'http'
    path = parsed.path[:-3] if parsed.path.endswith('/ws') else parsed.path
    return urlunparse((scheme, parsed.netloc, path.rstrip('/'), '', '', ''))


def _request_json(url: str, method: str = 'GET', payload: dict[str, object] | None = None, token: str | None = None) -> dict[str, object]:
    # 对于没有 payload 的请求（如 DELETE），不设置 Content-Type，
    # 否则 Fastify 会因 "Body cannot be empty when content-type is application/json" 报 400
    body = None if payload is None else json.dumps(payload).encode('utf-8')
    headers = {}
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    if token:
        headers['Authorization'] = f'Bearer {token}'
    request = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode('utf-8'))
    except HTTPError as exc:
        detail = exc.read().decode('utf-8', errors='ignore')
        raise RuntimeError(f'HTTP {exc.code}: {detail or exc.reason}') from exc
    except URLError as exc:
        raise RuntimeError(f'Gateway request failed: {exc.reason}') from exc


def _normalize_session(raw: dict[str, object]) -> GatewaySession:
    return GatewaySession(
        session_id=str(raw.get('sessionId', '')),
        title=str(raw.get('title') or 'New Session'),
        created_at=int(raw.get('createdAt', 0) or 0),
        updated_at=int(raw.get('updatedAt', raw.get('lastActiveAt', 0)) or 0),
        pinned_at=int(raw['pinnedAt']) if raw.get('pinnedAt') is not None else None,
        status=str(raw.get('status') or 'active'),
        channel_id=str(raw.get('channelId') or ''),
        user_id=str(raw.get('userId') or ''),
        agent_id=str(raw.get('agentId') or ''),
        metadata=raw.get('metadata') if isinstance(raw.get('metadata'), dict) else {},
    )


class SessionApiClient:
    def __init__(self, gateway_url: str, token: str | None = None) -> None:
        self.base_url = _http_base_from_ws(gateway_url)
        self.token = token

    def list_sessions(self, *, channel_id: str, user_id: str, include_closed: bool = False) -> list[GatewaySession]:
        query = urlencode({
            'channelId': channel_id,
            'userId': user_id,
            'includeClosed': 'true' if include_closed else 'false',
        })
        response = _request_json(f'{self.base_url}/api/sessions?{query}', token=self.token)
        data = response.get('data')
        if not isinstance(data, dict):
            return []
        raw_sessions = data.get('sessions')
        if not isinstance(raw_sessions, list):
            return []
        return [_normalize_session(item) for item in raw_sessions if isinstance(item, dict)]

    def create_session(self, *, agent_id: str, channel_id: str, user_id: str, title: str | None = None) -> GatewaySession:
        response = _request_json(
            f'{self.base_url}/api/sessions',
            method='POST',
            payload={
                'agentId': agent_id,
                'channelId': channel_id,
                'userId': user_id,
                'title': title or 'New Session',
            },
            token=self.token,
        )
        data = response.get('data')
        if not isinstance(data, dict):
            raise RuntimeError('Invalid create session response')
        return _normalize_session(data)

    def update_session(self, session_id: str, payload: dict[str, object]) -> GatewaySession:
        response = _request_json(
            f'{self.base_url}/api/sessions/{session_id}',
            method='PATCH',
            payload=payload,
            token=self.token,
        )
        data = response.get('data')
        if not isinstance(data, dict):
            raise RuntimeError('Invalid update session response')
        return _normalize_session(data)

    def delete_session(self, session_id: str) -> None:
        _request_json(f'{self.base_url}/api/sessions/{session_id}', method='DELETE', token=self.token)

    def get_server_time(self) -> dict[str, object]:
        response = _request_json(f'{self.base_url}/api/time', token=self.token)
        data = response.get('data')
        return data if isinstance(data, dict) else {}
