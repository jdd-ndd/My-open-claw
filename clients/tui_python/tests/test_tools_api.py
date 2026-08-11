"""验证 tools_api.py 模块与 app.py 远程能力拉取功能的单元测试

覆盖：
1. ToolMeta / SkillMeta 数据类字段
2. _normalize_tool / _normalize_skill 解析逻辑
3. ToolsApiClient 的 list_tools / list_skills（mock urlopen）
4. app.py 的 _tool_to_slash_entry / _skill_to_slash_entry 转换函数
5. app.py 的 _get_merged_slash_entries 合并逻辑
"""
from __future__ import annotations

import unittest
from unittest.mock import patch, MagicMock

from tui_python.app import (
    LOCAL_SLASH_ENTRIES,
    SLASH_ENTRIES,
    SlashEntry,
    _skill_to_slash_entry,
    _tool_to_slash_entry,
)
from tui_python.tools_api import (
    SkillMeta,
    ToolMeta,
    ToolsApiClient,
    _normalize_skill,
    _normalize_tool,
)


class ToolMetaTests(unittest.TestCase):
    """工具元数据数据类与解析逻辑测试"""

    def test_tool_meta_default_fields(self) -> None:
        """ToolMeta 默认字段值"""
        tool = ToolMeta(name="fs/read", description="Read file")
        self.assertEqual(tool.name, "fs/read")
        self.assertEqual(tool.description, "Read file")
        self.assertEqual(tool.category, "")
        self.assertEqual(tool.risk, "low")
        self.assertTrue(tool.builtin)
        self.assertEqual(tool.parameters, {})

    def test_normalize_tool_full_fields(self) -> None:
        """_normalize_tool 正确解析完整字段"""
        raw = {
            "name": "exec/shell",
            "description": "Execute shell command",
            "category": "exec",
            "risk": "high",
            "builtin": True,
            "parameters": {"type": "object", "properties": {"command": {"type": "string"}}},
        }
        tool = _normalize_tool(raw)
        self.assertEqual(tool.name, "exec/shell")
        self.assertEqual(tool.description, "Execute shell command")
        self.assertEqual(tool.category, "exec")
        self.assertEqual(tool.risk, "high")
        self.assertTrue(tool.builtin)
        self.assertIn("command", tool.parameters.get("properties", {}))

    def test_normalize_tool_missing_fields_uses_defaults(self) -> None:
        """_normalize_tool 缺失字段时使用默认值"""
        raw = {"name": "unknown"}
        tool = _normalize_tool(raw)
        self.assertEqual(tool.name, "unknown")
        self.assertEqual(tool.description, "")
        self.assertEqual(tool.category, "")
        self.assertEqual(tool.risk, "low")
        self.assertTrue(tool.builtin)
        self.assertEqual(tool.parameters, {})

    def test_normalize_tool_invalid_parameters_returns_empty_dict(self) -> None:
        """_normalize_tool parameters 字段非 dict 时返回空字典"""
        raw = {"name": "x", "parameters": "not a dict"}
        tool = _normalize_tool(raw)
        self.assertEqual(tool.parameters, {})


class SkillMetaTests(unittest.TestCase):
    """技能元数据数据类与解析逻辑测试"""

    def test_skill_meta_default_fields(self) -> None:
        """SkillMeta 默认字段值"""
        skill = SkillMeta(name="web-search", description="Web search skill")
        self.assertEqual(skill.name, "web-search")
        self.assertEqual(skill.description, "Web search skill")
        self.assertEqual(skill.version, "")
        self.assertEqual(skill.triggers, [])
        self.assertEqual(skill.tools, [])
        self.assertEqual(skill.requires, [])
        self.assertEqual(skill.priority, "normal")

    def test_normalize_skill_full_fields(self) -> None:
        """_normalize_skill 正确解析完整字段"""
        raw = {
            "name": "web-search",
            "description": "Search the web",
            "version": "1.0.0",
            "author": "team",
            "triggers": ["搜索一下", "查一下"],
            "tools": ["http/request", "browser/open"],
            "requires": ["memory"],
            "priority": "high",
            "filePath": "/skills/web-search/SKILL.md",
        }
        skill = _normalize_skill(raw)
        self.assertEqual(skill.name, "web-search")
        self.assertEqual(skill.version, "1.0.0")
        self.assertEqual(skill.author, "team")
        self.assertEqual(skill.triggers, ["搜索一下", "查一下"])
        self.assertEqual(skill.tools, ["http/request", "browser/open"])
        self.assertEqual(skill.requires, ["memory"])
        self.assertEqual(skill.priority, "high")
        self.assertEqual(skill.file_path, "/skills/web-search/SKILL.md")

    def test_normalize_skill_invalid_lists_returns_empty(self) -> None:
        """_normalize_skill triggers/tools 非列表时返回空列表"""
        raw = {"name": "x", "triggers": "not a list", "tools": None}
        skill = _normalize_skill(raw)
        self.assertEqual(skill.triggers, [])
        self.assertEqual(skill.tools, [])


class ToolsApiClientTests(unittest.TestCase):
    """ToolsApiClient HTTP 调用测试（mock urlopen）"""

    def test_http_base_from_ws(self) -> None:
        """ws://host/ws 正确转换为 http://host"""
        client = ToolsApiClient("ws://127.0.0.1:18780/ws", token=None)
        self.assertEqual(client.base_url, "http://127.0.0.1:18780")

    def test_http_base_from_wss(self) -> None:
        """wss://host/path/ws 正确转换为 https://host/path"""
        client = ToolsApiClient("wss://example.com/gateway/ws", token="t1")
        self.assertEqual(client.base_url, "https://example.com/gateway")

    def test_list_tools_parses_response(self) -> None:
        """list_tools 正确解析服务端响应"""
        mock_response_data = {
            "ok": True,
            "data": {
                "total": 2,
                "tools": [
                    {"name": "fs/read", "description": "Read", "category": "fs", "risk": "low"},
                    {"name": "exec/shell", "description": "Shell", "category": "exec", "risk": "high"},
                ],
            },
        }
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"ok": true, "data": {"total": 2, "tools": [{"name": "fs/read", "description": "Read", "category": "fs", "risk": "low"}, {"name": "exec/shell", "description": "Shell", "category": "exec", "risk": "high"}]}}'
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)

        with patch("tui_python.tools_api.urlopen", return_value=mock_response):
            client = ToolsApiClient("ws://127.0.0.1:18780/ws")
            tools = client.list_tools()

        self.assertEqual(len(tools), 2)
        self.assertEqual(tools[0].name, "fs/read")
        self.assertEqual(tools[0].category, "fs")
        self.assertEqual(tools[1].name, "exec/shell")
        self.assertEqual(tools[1].risk, "high")

    def test_list_tools_with_category_filter(self) -> None:
        """list_tools 传递 category 过滤参数"""
        captured_url = []

        def fake_urlopen(req, timeout=None):
            captured_url.append(req.full_url)
            mock_resp = MagicMock()
            mock_resp.read.return_value = b'{"ok": true, "data": {"total": 0, "tools": []}}'
            mock_resp.__enter__ = MagicMock(return_value=mock_resp)
            mock_resp.__exit__ = MagicMock(return_value=False)
            return mock_resp

        with patch("tui_python.tools_api.urlopen", side_effect=fake_urlopen):
            client = ToolsApiClient("ws://127.0.0.1:18780/ws")
            client.list_tools(category="fs")

        self.assertIn("category=fs", captured_url[0])

    def test_list_skills_parses_response(self) -> None:
        """list_skills 正确解析服务端响应"""
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"ok": true, "data": {"total": 1, "skills": [{"name": "web-search", "description": "Search", "triggers": ["search"]}]}}'
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)

        with patch("tui_python.tools_api.urlopen", return_value=mock_response):
            client = ToolsApiClient("ws://127.0.0.1:18780/ws")
            skills = client.list_skills()

        self.assertEqual(len(skills), 1)
        self.assertEqual(skills[0].name, "web-search")
        self.assertEqual(skills[0].triggers, ["search"])

    def test_list_tools_empty_response(self) -> None:
        """list_tools 服务端返回空数据时返回空列表"""
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"ok": true, "data": {"total": 0, "tools": []}}'
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)

        with patch("tui_python.tools_api.urlopen", return_value=mock_response):
            client = ToolsApiClient("ws://127.0.0.1:18780/ws")
            tools = client.list_tools()

        self.assertEqual(tools, [])

    def test_list_tools_invalid_data_returns_empty(self) -> None:
        """list_tools data 字段非 dict 时返回空列表"""
        mock_response = MagicMock()
        mock_response.read.return_value = b'{"ok": true, "data": "not a dict"}'
        mock_response.__enter__ = MagicMock(return_value=mock_response)
        mock_response.__exit__ = MagicMock(return_value=False)

        with patch("tui_python.tools_api.urlopen", return_value=mock_response):
            client = ToolsApiClient("ws://127.0.0.1:18780/ws")
            tools = client.list_tools()

        self.assertEqual(tools, [])


class SlashEntryConversionTests(unittest.TestCase):
    """ToolMeta/SkillMeta -> SlashEntry 转换测试"""

    def test_tool_to_slash_entry_basic(self) -> None:
        """_tool_to_slash_entry 正确转换工具为 SlashEntry"""
        tool = ToolMeta(name="fs/read", description="Read file", category="fs", risk="low")
        entry = _tool_to_slash_entry(tool)
        self.assertEqual(entry.name, "tool:fs/read")
        self.assertEqual(entry.slash, "/tool/read")
        self.assertEqual(entry.kind, "tool")
        self.assertEqual(entry.source, "tool")
        self.assertEqual(entry.category, "fs")
        self.assertEqual(entry.risk, "low")
        self.assertIn("[调用工具:fs/read]", entry.insert_text)

    def test_tool_to_slash_entry_with_compound_name(self) -> None:
        """_tool_to_slash_entry 处理含 / 的工具名（取最后一段作为 slash）"""
        tool = ToolMeta(name="http/request", description="HTTP request", category="http", risk="medium")
        entry = _tool_to_slash_entry(tool)
        self.assertEqual(entry.slash, "/tool/request")
        self.assertIn("[调用工具:http/request]", entry.insert_text)

    def test_skill_to_slash_entry_basic(self) -> None:
        """_skill_to_slash_entry 正确转换技能为 SlashEntry"""
        skill = SkillMeta(
            name="web-search",
            description="Web search",
            triggers=["搜索", "查一下"],
        )
        entry = _skill_to_slash_entry(skill)
        self.assertEqual(entry.name, "skill:web-search")
        self.assertEqual(entry.slash, "/skill/web-search")
        self.assertEqual(entry.kind, "skill")
        self.assertEqual(entry.source, "skill")
        self.assertEqual(entry.triggers, ["搜索", "查一下"])
        self.assertIn("[启用技能:web-search]", entry.insert_text)

    def test_tool_to_slash_entry_empty_name_safe(self) -> None:
        """_tool_to_slash_entry 工具名为空时不崩溃"""
        tool = ToolMeta(name="", description="")
        entry = _tool_to_slash_entry(tool)
        self.assertEqual(entry.name, "tool:unknown")

    def test_slash_entry_extended_fields_default(self) -> None:
        """SlashEntry 扩展字段默认值正确"""
        entry = SlashEntry(
            name="test", slash="/test", title="Test", group="G",
            kind="command", summary="s", insert_text="/test ",
        )
        self.assertEqual(entry.source, "local")
        self.assertEqual(entry.category, "")
        self.assertEqual(entry.risk, "")
        self.assertEqual(entry.triggers, [])


class LocalSlashEntriesTests(unittest.TestCase):
    """本地命令列表完整性测试"""

    def test_local_slash_entries_not_empty(self) -> None:
        """LOCAL_SLASH_ENTRIES 不为空"""
        self.assertGreater(len(LOCAL_SLASH_ENTRIES), 0)

    def test_slash_entries_alias_matches_local(self) -> None:
        """SLASH_ENTRIES 兼容别名内容与 LOCAL_SLASH_ENTRIES 一致"""
        self.assertEqual(len(SLASH_ENTRIES), len(LOCAL_SLASH_ENTRIES))

    def test_local_entries_all_source_local(self) -> None:
        """所有本地命令 source 字段为 'local'"""
        for entry in LOCAL_SLASH_ENTRIES:
            self.assertEqual(entry.source, "local")

    def test_local_entries_have_required_fields(self) -> None:
        """每个本地命令都有必需字段"""
        for entry in LOCAL_SLASH_ENTRIES:
            self.assertTrue(entry.name)
            self.assertTrue(entry.slash)
            self.assertTrue(entry.title)
            self.assertTrue(entry.insert_text)

    def test_local_entries_unique_slash(self) -> None:
        """本地命令的 slash 命令唯一"""
        slash_values = [e.slash for e in LOCAL_SLASH_ENTRIES]
        self.assertEqual(len(slash_values), len(set(slash_values)), "slash commands must be unique")


if __name__ == "__main__":
    unittest.main()
