"""PPT 制作 API 客户端

封装服务端 /api/ppt/{themes,templates,make} 端点，
供 TUI 命令面板"PPT 工作流"使用。

设计要点：
1. 与 tools_api.py / sessions_api.py 风格保持一致：纯标准库 urllib
2. 生成 PPT 时返回二进制 bytes，由调用方决定保存 / 预览 / 传送到剪贴板
3. 失败抛出统一的 RuntimeError，错误信息附带服务端 errorCode
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen

from .tools_api import _http_base_from_ws  # 复用 tools_api 的 ws→http 转换


# ─── 数据类 ─────────────────────────────────────────────────────────


@dataclass(slots=True)
class ThemeMeta:
    """PPT 主题元数据（对齐服务端 ThemeMeta）"""
    id: str
    name: str
    primary: str
    secondary: str
    accent: str
    header_font: str
    body_font: str


@dataclass(slots=True)
class TemplateMeta:
    """PPT 模板元数据（对齐服务端 TemplateMeta）"""
    id: str
    type: str                  # cover / toc / content / divider / summary
    name: str
    description: str
    schema: dict[str, str] = field(default_factory=dict)


@dataclass(slots=True)
class PptSpec:
    """PPT 制作请求参数"""
    theme: str
    slides: list[dict[str, Any]]
    filename: str | None = None


# ─── 客户端 ─────────────────────────────────────────────────────────


class PptApiClient:
    """PPT 制作 API 客户端

    用法：
        client = PptApiClient(config.gateway_url, config.token)
        themes = client.list_themes()       # 拉取 /api/ppt/themes
        templates = client.list_templates() # 拉取 /api/ppt/templates
        pptx_bytes = client.make(spec)      # 调用 /api/ppt/make
    """

    def __init__(self, gateway_url: str, token: str | None = None) -> None:
        self.base_url = _http_base_from_ws(gateway_url)
        self.token = token

    def list_themes(self) -> list[ThemeMeta]:
        """列出所有可用主题"""
        response = self._request_json('/api/ppt/themes')
        data = response.get('data')
        if not isinstance(data, dict):
            return []
        themes = data.get('themes') or []
        return [
            ThemeMeta(
                id=str(t.get('id', '')),
                name=str(t.get('name', '')),
                primary=str(t.get('primary', '')),
                secondary=str(t.get('secondary', '')),
                accent=str(t.get('accent', '')),
                header_font=str(t.get('headerFont', '')),
                body_font=str(t.get('bodyFont', '')),
            )
            for t in themes
            if isinstance(t, dict)
        ]

    def list_templates(self) -> list[TemplateMeta]:
        """列出所有可用模板"""
        response = self._request_json('/api/ppt/templates')
        data = response.get('data')
        if not isinstance(data, dict):
            return []
        templates = data.get('templates') or []
        return [
            TemplateMeta(
                id=str(t.get('id', '')),
                type=str(t.get('type', '')),
                name=str(t.get('name', '')),
                description=str(t.get('description', '')),
                schema=dict(t.get('schema') or {}),
            )
            for t in templates
            if isinstance(t, dict)
        ]

    def make(self, spec: PptSpec) -> bytes:
        """生成 PPT 文件，返回 PPTX 二进制 bytes

        抛出 RuntimeError 当服务端返回错误时
        """
        payload: dict[str, Any] = {
            'theme': spec.theme,
            'slides': spec.slides,
        }
        if spec.filename:
            payload['filename'] = spec.filename

        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        headers = {'Content-Type': 'application/json'}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'

        request = Request(
            f'{self.base_url}/api/ppt/make',
            data=body,
            headers=headers,
            method='POST',
        )
        try:
            with urlopen(request, timeout=30) as response:
                return response.read()
        except HTTPError as exc:
            detail = exc.read().decode('utf-8', errors='ignore')
            raise RuntimeError(
                f'PPT 生成失败 (HTTP {exc.code}): {detail or exc.reason}'
            ) from exc
        except URLError as exc:
            raise RuntimeError(
                f'PPT 生成失败: Gateway 不可达 ({exc.reason})'
            ) from exc

    # ─── 内部 ───────────────────────────────────────────────────────

    def _request_json(self, path: str) -> dict[str, Any]:
        """GET 请求，返回响应体的 dict

        注意：服务端 okResponse 格式为 { ok: true, data: {...} }，
        端点路径需以 /api 开头或不含（此处含 /api）
        """
        headers: dict[str, str] = {}
        if self.token:
            headers['Authorization'] = f'Bearer {self.token}'
        request = Request(url=self.base_url + path, headers=headers, method='GET')
        try:
            with urlopen(request, timeout=10) as response:
                return json.loads(response.read().decode('utf-8'))
        except HTTPError as exc:
            detail = exc.read().decode('utf-8', errors='ignore')
            raise RuntimeError(
                f'HTTP {exc.code}: {detail or exc.reason}'
            ) from exc
        except URLError as exc:
            raise RuntimeError(
                f'Gateway request failed: {exc.reason}'
            ) from exc
