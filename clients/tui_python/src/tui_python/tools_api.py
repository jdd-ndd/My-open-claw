"""工具与技能元数据 API 客户端

对接服务端 GET /api/tools 与 GET /api/skills 端点，
供 TUI Slash 面板动态拉取已注册工具/技能清单，
替代原先硬编码的 SLASH_ENTRIES 列表。

设计要点：
1. 仅依赖 Python 标准库（urllib），与 sessions_api.py 风格保持一致
2. 失败时抛出 RuntimeError，由调用方决定是否回退到本地命令
3. 数据类 (dataclass) 返回，便于转换为 SlashEntry
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen


@dataclass(slots=True)
class ToolMeta:
    """工具元数据（对齐服务端 ToolRegistry 标准化输出字段）"""
    name: str                       # 工具名，如 "fs/read"
    description: str                # 工具描述
    category: str = ""              # 分类，如 fs/exec/http/routing/calculator
    risk: str = "low"               # 风险等级 low/medium/high
    builtin: bool = True            # 是否内置工具
    parameters: dict[str, Any] = field(default_factory=dict)  # 参数 schema


@dataclass(slots=True)
class SkillMeta:
    """技能元数据（对齐服务端 SkillRegistry 标准化输出字段）"""
    name: str                       # 技能名，如 "web-search"
    description: str                # 技能描述
    version: str = ""               # 版本号
    author: str = ""                # 作者
    triggers: list[str] = field(default_factory=list)   # 触发词列表
    tools: list[str] = field(default_factory=list)      # 依赖的工具列表
    requires: list[str] = field(default_factory=list)   # 依赖的其他技能
    priority: str = "normal"        # 优先级 low/normal/high
    file_path: str = ""             # SKILL.md 文件路径


def _http_base_from_ws(gateway_url: str) -> str:
    """将 ws(s)://host/ws 转换为 http(s)://host，复用 sessions_api 的逻辑"""
    parsed = urlparse(gateway_url)
    scheme = 'https' if parsed.scheme == 'wss' else 'http'
    path = parsed.path[:-3] if parsed.path.endswith('/ws') else parsed.path
    return urlunparse((scheme, parsed.netloc, path.rstrip('/'), '', '', ''))


def _request_json(url: str, token: str | None = None) -> dict[str, Any]:
    """发起 GET 请求并解析 JSON 响应

    与 sessions_api._request_json 一致，但仅支持 GET（工具/技能查询不需要 POST）
    """
    headers = {}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    request = Request(url, headers=headers, method='GET')
    try:
        with urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode('utf-8'))
    except HTTPError as exc:
        detail = exc.read().decode('utf-8', errors='ignore')
        raise RuntimeError(f'HTTP {exc.code}: {detail or exc.reason}') from exc
    except URLError as exc:
        raise RuntimeError(f'Gateway request failed: {exc.reason}') from exc


def _normalize_tool(raw: dict[str, Any]) -> ToolMeta:
    """将服务端返回的工具字典转换为 ToolMeta"""
    return ToolMeta(
        name=str(raw.get('name', '')),
        description=str(raw.get('description', '')),
        category=str(raw.get('category', '') or ''),
        risk=str(raw.get('risk', 'low') or 'low'),
        builtin=bool(raw.get('builtin', True)),
        parameters=raw.get('parameters') if isinstance(raw.get('parameters'), dict) else {},
    )


def _normalize_skill(raw: dict[str, Any]) -> SkillMeta:
    """将服务端返回的技能字典转换为 SkillMeta"""
    triggers_raw = raw.get('triggers')
    tools_raw = raw.get('tools')
    requires_raw = raw.get('requires')
    return SkillMeta(
        name=str(raw.get('name', '')),
        description=str(raw.get('description', '')),
        version=str(raw.get('version', '') or ''),
        author=str(raw.get('author', '') or ''),
        triggers=list(triggers_raw) if isinstance(triggers_raw, list) else [],
        tools=list(tools_raw) if isinstance(tools_raw, list) else [],
        requires=list(requires_raw) if isinstance(requires_raw, list) else [],
        priority=str(raw.get('priority', 'normal') or 'normal'),
        file_path=str(raw.get('filePath', '') or ''),
    )


class ToolsApiClient:
    """工具/技能元数据查询客户端

    用法：
        client = ToolsApiClient(config.gateway_url, config.token)
        tools = client.list_tools()       # 拉取 /api/tools
        skills = client.list_skills()     # 拉取 /api/skills
    """

    def __init__(self, gateway_url: str, token: str | None = None) -> None:
        self.base_url = _http_base_from_ws(gateway_url)
        self.token = token

    def list_tools(self, *, category: str | None = None, risk: str | None = None) -> list[ToolMeta]:
        """查询已注册工具列表

        参数：
            category: 按分类过滤（如 fs/exec/http），None 表示不过滤
            risk: 按风险等级过滤（low/medium/high），None 表示不过滤
        返回：
            ToolMeta 列表；服务端不可用时抛出 RuntimeError
        """
        # 构造 query string
        params: dict[str, str] = {}
        if category:
            params['category'] = category
        if risk:
            params['risk'] = risk
        query = ''
        if params:
            from urllib.parse import urlencode
            query = '?' + urlencode(params)

        response = _request_json(f'{self.base_url}/api/tools{query}', token=self.token)
        data = response.get('data')
        if not isinstance(data, dict):
            return []
        raw_tools = data.get('tools')
        if not isinstance(raw_tools, list):
            return []
        return [_normalize_tool(item) for item in raw_tools if isinstance(item, dict)]

    def list_skills(self) -> list[SkillMeta]:
        """查询已注册技能列表

        返回：
            SkillMeta 列表；服务端不可用时抛出 RuntimeError
        """
        response = _request_json(f'{self.base_url}/api/skills', token=self.token)
        data = response.get('data')
        if not isinstance(data, dict):
            return []
        raw_skills = data.get('skills')
        if not isinstance(raw_skills, list):
            return []
        return [_normalize_skill(item) for item in raw_skills if isinstance(item, dict)]
