"""P1.2 命令面板测试: commands 模块 + CommandPaletteModal._filtered_commands + pilot 端到端."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from tui_python.app import MyOpenClawTextualApp
from tui_python.commands import DEFAULT_COMMANDS, Command
from tui_python.config import AppConfig, AppStateStore


class CommandsModuleTests(unittest.TestCase):
    def test_default_commands_have_required_fields(self) -> None:
        for cmd in DEFAULT_COMMANDS:
            self.assertTrue(cmd.name, f"command missing name: {cmd}")
            self.assertTrue(cmd.title, f"command missing title: {cmd}")
            self.assertTrue(cmd.action, f"command missing action: {cmd}")
            self.assertTrue(cmd.group, f"command missing group: {cmd}")

    def test_default_commands_cover_main_features(self) -> None:
        names = {c.name for c in DEFAULT_COMMANDS}
        for required in ("mode_toggle", "intensity_cycle", "model_cycle", "quit", "reconnect", "clear_chat"):
            self.assertIn(required, names, f"{required} must be in DEFAULT_COMMANDS")

    def test_command_names_unique(self) -> None:
        names = [c.name for c in DEFAULT_COMMANDS]
        self.assertEqual(len(names), len(set(names)), "command names must be unique")

    def test_command_actions_exist_on_app_class(self) -> None:
        """每个 command.action 都对应 MyOpenClawTextualApp 上的一个 action_xxx 方法."""
        missing: list[str] = []
        for cmd in DEFAULT_COMMANDS:
            if not hasattr(MyOpenClawTextualApp, f"action_{cmd.action}"):
                missing.append(cmd.action)
        self.assertEqual(missing, [], f"missing action methods: {missing}")

    def test_chat_only_command_has_chat_filter(self) -> None:
        chat_only = [c for c in DEFAULT_COMMANDS if c.name in {"mode_toggle", "intensity_cycle", "model_cycle", "clear_chat"}]
        for cmd in chat_only:
            self.assertIsNotNone(cmd.is_available, f"{cmd.name} should have is_available filter")
            # 在 launch 模式下应该不可用
            mock_app = MagicMock()
            mock_app.mode = "launch"
            mock_app.show_help = False
            self.assertFalse(cmd.is_available(mock_app), f"{cmd.name} should be unavailable in launch mode")

    def test_is_available_false_when_help_open(self) -> None:
        """help overlay 打开时, chat-only 命令应不可用(跟现有 action gate 保持一致)."""
        cmd = next(c for c in DEFAULT_COMMANDS if c.name == "mode_toggle")
        mock_app = MagicMock()
        mock_app.mode = "chat"
        mock_app.show_help = True
        self.assertFalse(cmd.is_available(mock_app))


class CommandPaletteFilterTests(unittest.IsolatedAsyncioTestCase):
    """测试 CommandPaletteModal._filtered_commands 的纯逻辑, 不开 pilot."""

    def _make_modal(self) -> "MyOpenClawTextualApp.app.CommandPaletteModal":  # type: ignore[name-defined]
        # 不实际启动 app, 只构造 modal 测 _filtered_commands
        cfg = AppConfig(mock=True)
        app = MyOpenClawTextualApp.__new__(MyOpenClawTextualApp)  # 绕过 __init__
        from tui_python.app import CommandPaletteModal
        return CommandPaletteModal(app)

    def test_empty_query_returns_all_commands(self) -> None:
        modal = self._make_modal()
        self.assertEqual(len(modal._filtered_commands("")), len(DEFAULT_COMMANDS))

    def test_filter_by_title_substring(self) -> None:
        modal = self._make_modal()
        result = modal._filtered_commands("intensity")
        names = {c.name for c in result}
        self.assertIn("intensity_cycle", names)

    def test_filter_by_keybinding_substring(self) -> None:
        modal = self._make_modal()
        result = modal._filtered_commands("ctrl+m")
        names = {c.name for c in result}
        self.assertIn("intensity_cycle", names)

    def test_filter_by_group_substring(self) -> None:
        modal = self._make_modal()
        result = modal._filtered_commands("mode")
        # 包含 group="Mode" 的所有命令
        self.assertGreater(len(result), 0)
        for cmd in result:
            self.assertIn("mode", cmd.group.lower())

    def test_filter_case_insensitive(self) -> None:
        modal = self._make_modal()
        lower = modal._filtered_commands("quit")
        upper = modal._filtered_commands("QUIT")
        self.assertEqual({c.name for c in lower}, {c.name for c in upper})

    def test_no_match_returns_empty(self) -> None:
        modal = self._make_modal()
        result = modal._filtered_commands("xyzzy_does_not_match_anything")
        self.assertEqual(result, [])

    def test_filter_is_stripped(self) -> None:
        modal = self._make_modal()
        result = modal._filtered_commands("  quit  ")
        names = {c.name for c in result}
        self.assertIn("quit", names)


class CommandPalettePilotTests(unittest.IsolatedAsyncioTestCase):
    """pilot 端到端: Ctrl+P 打开面板, 搜索过滤, Enter 执行 action."""

    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._original_path = AppStateStore.DEFAULT_PATH
        AppStateStore.DEFAULT_PATH = Path(self._tmpdir.name) / "tui-state.json"

    def tearDown(self) -> None:
        AppStateStore.DEFAULT_PATH = self._original_path
        self._tmpdir.cleanup()

    async def test_ctrl_p_opens_command_palette(self) -> None:
        cfg = AppConfig(mock=True)
        app = MyOpenClawTextualApp(cfg)
        async with app.run_test() as pilot:
            app.mode = "chat"
            app.query_one("#chat-input").focus()
            await pilot.pause()
            # 按 Ctrl+P
            await pilot.press("ctrl+p")
            await pilot.pause()
            # 当前 screen 应该是 CommandPaletteModal
            from tui_python.app import CommandPaletteModal
            self.assertIsInstance(app.screen, CommandPaletteModal)
            # modal 内部应有 Input + OptionList
            self.assertIsNotNone(app.screen.query_one("#palette-search"))
            self.assertIsNotNone(app.screen.query_one("#palette-options"))

    async def test_search_filters_option_list(self) -> None:
        cfg = AppConfig(mock=True)
        app = MyOpenClawTextualApp(cfg)
        async with app.run_test() as pilot:
            app.mode = "chat"
            await pilot.pause()
            await pilot.press("ctrl+p")
            await pilot.pause()
            modal = app.screen
            option_list = modal.query_one("#palette-options")
            # 初始 OptionList 应有所有命令 + 4 个 group header
            initial_count = option_list.option_count
            self.assertGreater(initial_count, 10)

            # 用按键逐字符输入 "intensity" 触发 Input.Changed 事件
            for ch in "intensity":
                await pilot.press(ch)
            await pilot.pause()
            self.assertLess(option_list.option_count, initial_count, "filter should reduce options")
            # highlighted 应该落在第一个非 disabled 的 command (跳过 group header)
            highlighted_idx = option_list.highlighted
            self.assertIsNotNone(highlighted_idx, "highlighted should be set after rebuild")
            highlighted_opt = option_list.get_option_at_index(highlighted_idx)
            self.assertIsNotNone(highlighted_opt)
            self.assertFalse(getattr(highlighted_opt, "disabled", False),
                "highlighted should NOT be a disabled group header")
            self.assertEqual(highlighted_opt.id, "intensity_cycle",
                "highlighted should land on intensity_cycle command")

    async def test_enter_on_command_runs_action(self) -> None:
        """在 palette 里选中 'mode_toggle', Enter, 验证 work_mode 真的翻了."""
        cfg = AppConfig(mock=True, work_mode="build")
        app = MyOpenClawTextualApp(cfg)
        async with app.run_test() as pilot:
            app.mode = "chat"
            app.query_one("#chat-input").focus()
            await pilot.pause()
            await pilot.press("ctrl+p")
            await pilot.pause()
            modal = app.screen
            # 用按键输入 "switch" 过滤 (匹配 mode_toggle 标题, group header 也会出现)
            for ch in "switch":
                await pilot.press(ch)
            await pilot.pause()
            option_list = modal.query_one("#palette-options")
            # 1 个 group header + 1 个 command, highlighted 跳过 group header
            self.assertEqual(option_list.option_count, 2, "should be 1 group header + 1 command")
            highlighted_opt = option_list.get_option_at_index(option_list.highlighted)
            self.assertEqual(highlighted_opt.id, "mode_toggle", "highlighted should skip to mode_toggle")
            # Enter
            await pilot.press("enter")
            await pilot.pause()
            # modal 关闭 + work_mode 翻转
            from tui_python.app import CommandPaletteModal
            self.assertNotIsInstance(app.screen, CommandPaletteModal, "modal should be dismissed")
            self.assertEqual(app.config.work_mode, "plan", "cycle_work_mode should have run")

    async def test_escape_closes_modal_without_action(self) -> None:
        cfg = AppConfig(mock=True, work_mode="build")
        app = MyOpenClawTextualApp(cfg)
        async with app.run_test() as pilot:
            app.mode = "chat"
            await pilot.pause()
            await pilot.press("ctrl+p")
            await pilot.pause()
            from tui_python.app import CommandPaletteModal
            self.assertIsInstance(app.screen, CommandPaletteModal)
            # Esc 关闭
            await pilot.press("escape")
            await pilot.pause()
            self.assertNotIsInstance(app.screen, CommandPaletteModal)
            # work_mode 没变(没选命令)
            self.assertEqual(app.config.work_mode, "build")


if __name__ == "__main__":
    unittest.main()
