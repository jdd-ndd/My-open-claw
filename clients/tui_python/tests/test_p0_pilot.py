"""Headless 端到端: 真实启动 Textual App, 模拟 Shift+Tab 切 work mode."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tui_python.app import MyOpenClawTextualApp, StatusPane
from tui_python.config import AppConfig, AppStateStore


class P0PilotTests(unittest.IsolatedAsyncioTestCase):
    """所有测试用例使用临时 state 文件, 避免与 ~/.myopenclaw/tui-state.json 互相干扰."""

    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._original_path = AppStateStore.DEFAULT_PATH
        AppStateStore.DEFAULT_PATH = Path(self._tmpdir.name) / "tui-state.json"

    def tearDown(self) -> None:
        AppStateStore.DEFAULT_PATH = self._original_path
        self._tmpdir.cleanup()

    async def test_shift_tab_toggles_work_mode_in_running_app(self) -> None:
        cfg = AppConfig(mock=True, work_mode="build", intensity="max")
        app = MyOpenClawTextualApp(cfg)

        async with app.run_test() as pilot:
            self.assertEqual(app.config.work_mode, "build")
            self.assertEqual(app.controller.work_mode, "build")

            # 进入 chat 模式(launch 模式所有 chat action 都被 gate)
            app.mode = "chat"
            app.query_one("#chat-input").focus()
            await pilot.pause()

            # 1st Shift+Tab -> plan
            await pilot.press("shift+tab")
            await pilot.pause()
            self.assertEqual(app.config.work_mode, "plan")
            self.assertEqual(app.controller.work_mode, "plan")

            # 2nd Shift+Tab -> build
            await pilot.press("shift+tab")
            await pilot.pause()
            self.assertEqual(app.config.work_mode, "build")
            self.assertEqual(app.controller.work_mode, "build")

    async def test_status_pane_renders_work_mode_and_intensity(self) -> None:
        cfg = AppConfig(mock=True, work_mode="plan", intensity="high")
        app = MyOpenClawTextualApp(cfg)
        async with app.run_test() as pilot:
            app.mode = "chat"
            await pilot.pause()
            status = app.query_one("#status", StatusPane)
            text = str(status.content)
            # 主行 3 段: mode · model · intensity
            self.assertIn("Plan", text, f"StatusPane should show 'Plan', got: {text!r}")
            self.assertIn("high", text, f"StatusPane should show intensity 'high', got: {text!r}")
            # 模型名从 deepseek-v4-pro -> DeepSeek V4 Pro (映射表, 正确大小写)
            self.assertIn("DeepSeek V4 Pro", text)
            # 用 · 分隔(OpenCode 风格)
            self.assertIn("·", text)
            # mode 高亮: markup 必须带颜色
            self.assertIn("[bold", text)
            # 不应再出现旧的连字符 - 分隔格式
            self.assertNotIn(" - ", text)

    async def test_tab_still_cycles_focus_in_chat_mode(self) -> None:
        """确认 priority binding 没破坏 tab 切 focus 的功能."""
        cfg = AppConfig(mock=True, work_mode="build", intensity="max")
        app = MyOpenClawTextualApp(cfg)
        async with app.run_test() as pilot:
            app.mode = "chat"
            app.focus_area = "input"
            await pilot.pause()
            await pilot.press("tab")
            await pilot.pause()
            self.assertEqual(app.focus_area, "messages", "tab should cycle focus input -> messages")
            await pilot.press("tab")
            await pilot.pause()
            self.assertEqual(app.focus_area, "sidebar")
            await pilot.press("tab")
            await pilot.pause()
            self.assertEqual(app.focus_area, "input", "tab should wrap back to input")

    async def test_shift_tab_does_not_cycle_focus(self) -> None:
        """确认 Shift+Tab 不再触发 focus_previous(被 cycle_work_mode 覆盖)."""
        cfg = AppConfig(mock=True)
        app = MyOpenClawTextualApp(cfg)
        async with app.run_test() as pilot:
            app.mode = "chat"
            app.focus_area = "messages"
            app.config.work_mode = "build"
            await pilot.pause()
            await pilot.press("shift+tab")
            await pilot.pause()
            self.assertEqual(app.focus_area, "messages", "shift+tab must NOT move focus")
            self.assertEqual(app.config.work_mode, "plan", "shift+tab must toggle work_mode instead")

    async def test_ctrl_m_cycles_intensity_full_loop(self) -> None:
        """Ctrl+M 循环 INTENSITY_CYCLE 顺序 max -> low -> medium -> high -> max, controller 同步."""
        cfg = AppConfig(mock=True, work_mode="build", intensity="max")
        app = MyOpenClawTextualApp(cfg)
        async with app.run_test() as pilot:
            app.mode = "chat"
            app.query_one("#chat-input").focus()
            await pilot.pause()
            # INTENSITY_CYCLE = ["low", "medium", "high", "max"], max 的 next 是 low(循环)
            expected_sequence = ["low", "medium", "high", "max"]
            for expected in expected_sequence:
                await pilot.press("ctrl+m")
                await pilot.pause()
                self.assertEqual(app.config.intensity, expected, f"after ctrl+m should be {expected}")
                self.assertEqual(app.controller.intensity, expected, f"controller.intensity should sync to {expected}")
            # 4 次按完回到 max(循环)

    async def test_ctrl_m_reflects_in_status_pane(self) -> None:
        """Ctrl+M 切档位后 StatusPane 立刻反映新档位 + 颜色."""
        cfg = AppConfig(mock=True, work_mode="build", intensity="max")
        app = MyOpenClawTextualApp(cfg)
        async with app.run_test() as pilot:
            app.mode = "chat"
            await pilot.pause()
            status = app.query_one("#status", StatusPane)

            # 起始 max (红色高亮)
            text = str(status.content)
            self.assertIn("[bold #ef4444]max[/]", text, f"max should be red bold, got: {text!r}")

            # 1st ctrl+m: max -> low (灰色)
            await pilot.press("ctrl+m")
            await pilot.pause()
            text = str(status.content)
            self.assertIn("[bold #6b7280]low[/]", text, f"low should be gray bold, got: {text!r}")
            self.assertNotIn("max", text, "old max should be replaced")

            # 2nd ctrl+m: low -> medium (橙色)
            await pilot.press("ctrl+m")
            await pilot.pause()
            text = str(status.content)
            self.assertIn("[bold #fb923c]medium[/]", text, f"medium should be orange bold, got: {text!r}")

            # 3rd ctrl+m: medium -> high (黄色)
            await pilot.press("ctrl+m")
            await pilot.pause()
            text = str(status.content)
            self.assertIn("[bold #fbbf24]high[/]", text, f"high should be yellow bold, got: {text!r}")

            # 4th ctrl+m: high -> max (红色)
            await pilot.press("ctrl+m")
            await pilot.pause()
            text = str(status.content)
            self.assertIn("[bold #ef4444]max[/]", text, f"back to max red bold, got: {text!r}")

    async def test_ctrl_shift_m_cycles_model(self) -> None:
        """Ctrl+Shift+M 循环 model 列表."""
        cfg = AppConfig(mock=True)
        app = MyOpenClawTextualApp(cfg)
        async with app.run_test() as pilot:
            app.mode = "chat"
            app.query_one("#chat-input").focus()
            await pilot.pause()
            # 默认 model = "deepseek-v4-pro"
            self.assertEqual(app.config.model, "deepseek-v4-pro")
            await pilot.press("ctrl+shift+m")
            await pilot.pause()
            self.assertEqual(app.config.model, "deepseek-v4-flash")
            await pilot.press("ctrl+shift+m")
            await pilot.pause()
            self.assertEqual(app.config.model, "gpt-4o")
            await pilot.press("ctrl+shift+m")
            await pilot.pause()
            self.assertEqual(app.config.model, "deepseek-v4-pro", "should wrap back to first")

    async def test_ctrl_m_does_not_change_work_mode(self) -> None:
        """Ctrl+M 只切 intensity, 不应影响 work_mode."""
        cfg = AppConfig(mock=True, work_mode="plan", intensity="low")
        app = MyOpenClawTextualApp(cfg)
        async with app.run_test() as pilot:
            app.mode = "chat"
            app.query_one("#chat-input").focus()
            await pilot.pause()
            await pilot.press("ctrl+m")
            await pilot.pause()
            self.assertEqual(app.config.intensity, "medium")
            self.assertEqual(app.config.work_mode, "plan", "ctrl+m must not change work_mode")


if __name__ == "__main__":
    unittest.main()
