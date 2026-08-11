"""验证 app.py 远程能力拉取与 Slash 面板的端到端集成

确保：
1. Mock 模式下 tools_api 为 None，不触发 HTTP 请求
2. _get_merged_slash_entries 在无远程缓存时仅返回本地命令
3. _get_merged_slash_entries 在有远程缓存时正确合并
4. _filtered_slash_entries 能过滤本地+远程条目
5. _trigger_remote_capability_refresh 在 Mock 模式下不执行
"""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tui_python.app import (
    LOCAL_SLASH_ENTRIES,
    MyOpenClawTextualApp,
    SlashEntry,
    _skill_to_slash_entry,
    _tool_to_slash_entry,
)
from tui_python.config import AppConfig, AppStateStore
from tui_python.tools_api import SkillMeta, ToolMeta


class RemoteCapabilityIntegrationTests(unittest.IsolatedAsyncioTestCase):
    """远程能力拉取与 Slash 面板集成测试"""

    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._original_path = AppStateStore.DEFAULT_PATH
        AppStateStore.DEFAULT_PATH = Path(self._tmpdir.name) / "tui-state.json"

    def tearDown(self) -> None:
        AppStateStore.DEFAULT_PATH = self._original_path
        self._tmpdir.cleanup()

    def test_mock_mode_disables_tools_api(self) -> None:
        """Mock 模式下 tools_api 为 None，避免无意义的 HTTP 请求"""
        cfg = AppConfig(mock=True)
        app = MyOpenClawTextualApp(cfg)
        self.assertIsNone(app.tools_api)

    def test_real_mode_creates_tools_api(self) -> None:
        """非 Mock 模式下创建 ToolsApiClient"""
        cfg = AppConfig(mock=False)
        app = MyOpenClawTextualApp(cfg)
        self.assertIsNotNone(app.tools_api)

    def test_merged_entries_only_local_when_no_cache(self) -> None:
        """无远程缓存时，合并列表仅包含本地命令"""
        cfg = AppConfig(mock=True)
        app = MyOpenClawTextualApp(cfg)
        merged = app._get_merged_slash_entries()
        self.assertEqual(len(merged), len(LOCAL_SLASH_ENTRIES))
        # 所有条目都应为 local 来源
        for entry in merged:
            self.assertEqual(entry.source, "local")

    def test_merged_entries_includes_remote_when_cached(self) -> None:
        """有远程缓存时，合并列表包含本地+远程条目"""
        cfg = AppConfig(mock=True)
        app = MyOpenClawTextualApp(cfg)
        # 模拟已缓存的远程工具/技能
        app._cached_remote_entries = [
            _tool_to_slash_entry(ToolMeta(name="fs/read", description="Read", category="fs", risk="low")),
            _skill_to_slash_entry(SkillMeta(name="web-search", description="Search", triggers=["搜索"])),
        ]
        merged = app._get_merged_slash_entries()
        self.assertEqual(len(merged), len(LOCAL_SLASH_ENTRIES) + 2)
        # 本地命令在前
        for entry in merged[:len(LOCAL_SLASH_ENTRIES)]:
            self.assertEqual(entry.source, "local")
        # 远程条目在后
        remote_part = merged[len(LOCAL_SLASH_ENTRIES):]
        self.assertEqual(remote_part[0].source, "tool")
        self.assertEqual(remote_part[1].source, "skill")

    def test_filtered_slash_entries_matches_remote_tool(self) -> None:
        """_filtered_slash_entries 能匹配远程工具的分类"""
        cfg = AppConfig(mock=True)
        app = MyOpenClawTextualApp(cfg)
        app._cached_remote_entries = [
            _tool_to_slash_entry(ToolMeta(name="fs/read", description="Read", category="fs", risk="low")),
        ]
        # 搜索 "fs" 应该匹配到远程工具
        results = app._filtered_slash_entries("fs")
        remote_matches = [e for e in results if e.source == "tool"]
        self.assertEqual(len(remote_matches), 1)
        self.assertEqual(remote_matches[0].name, "tool:fs/read")

    def test_filtered_slash_entries_matches_skill_trigger(self) -> None:
        """_filtered_slash_entries 能匹配技能的触发词"""
        cfg = AppConfig(mock=True)
        app = MyOpenClawTextualApp(cfg)
        app._cached_remote_entries = [
            _skill_to_slash_entry(SkillMeta(name="web-search", description="Search", triggers=["搜索一下"])),
        ]
        # 搜索触发词 "搜索" 应该匹配到技能
        results = app._filtered_slash_entries("搜索")
        skill_matches = [e for e in results if e.source == "skill"]
        self.assertEqual(len(skill_matches), 1)
        self.assertEqual(skill_matches[0].name, "skill:web-search")

    def test_filtered_slash_entries_empty_query_returns_all(self) -> None:
        """空查询返回全部合并列表"""
        cfg = AppConfig(mock=True)
        app = MyOpenClawTextualApp(cfg)
        app._cached_remote_entries = [
            _tool_to_slash_entry(ToolMeta(name="fs/read", description="Read", category="fs")),
        ]
        results = app._filtered_slash_entries("")
        self.assertEqual(len(results), len(LOCAL_SLASH_ENTRIES) + 1)

    def test_trigger_refresh_no_op_in_mock_mode(self) -> None:
        """Mock 模式下 _trigger_remote_capability_refresh 不执行任何操作"""
        cfg = AppConfig(mock=True)
        app = MyOpenClawTextualApp(cfg)
        # 不应抛出异常
        app._trigger_remote_capability_refresh()
        # 缓存仍然为空
        self.assertEqual(app._cached_remote_entries, [])
        self.assertFalse(app._remote_loading)

    def test_trigger_refresh_skips_when_cache_fresh(self) -> None:
        """缓存未过期时 _trigger_remote_capability_refresh 跳过刷新"""
        cfg = AppConfig(mock=True)
        app = MyOpenClawTextualApp(cfg)
        # 模拟刚拉取过缓存
        app._cached_remote_entries = [
            _tool_to_slash_entry(ToolMeta(name="x", description="x")),
        ]
        import time
        app._remote_cache_fetched_at_ms = int(time.time() * 1000)
        app._trigger_remote_capability_refresh()
        # 不会触发加载
        self.assertFalse(app._remote_loading)

    async def test_load_remote_capabilities_silent_on_failure(self) -> None:
        """_load_remote_capabilities 在 tools_api 为 None 时静默返回"""
        cfg = AppConfig(mock=True)
        app = MyOpenClawTextualApp(cfg)
        # tools_api 为 None，应直接返回不做任何操作
        await app._load_remote_capabilities()
        self.assertEqual(app._cached_remote_entries, [])

    def test_local_entries_preserved_after_merge(self) -> None:
        """合并后本地命令的 action 字段保留，确保 /help /exit 等仍可执行"""
        cfg = AppConfig(mock=True)
        app = MyOpenClawTextualApp(cfg)
        app._cached_remote_entries = [
            _tool_to_slash_entry(ToolMeta(name="fs/read", description="Read")),
        ]
        merged = app._get_merged_slash_entries()
        # 找到 /help 和 /exit，验证 action 保留
        help_entry = next((e for e in merged if e.slash == "/help"), None)
        exit_entry = next((e for e in merged if e.slash == "/exit"), None)
        self.assertIsNotNone(help_entry)
        self.assertIsNotNone(exit_entry)
        self.assertEqual(help_entry.action, "toggle_help")
        self.assertEqual(exit_entry.action, "quit")


if __name__ == "__main__":
    unittest.main()
