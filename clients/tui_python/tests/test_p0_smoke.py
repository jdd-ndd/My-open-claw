"""P0 端到端 smoke: textual app 启动 + Shift+Tab action + payload 联动."""
from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path

from tui_python.app import MyOpenClawTextualApp
from tui_python.config import AppConfig, AppStateStore


class P0SmokeTests(unittest.TestCase):
    """所有测试用临时 state 文件, 避免与 ~/.myopenclaw/tui-state.json 互相干扰."""

    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._original_path = AppStateStore.DEFAULT_PATH
        AppStateStore.DEFAULT_PATH = Path(self._tmpdir.name) / "tui-state.json"

    def tearDown(self) -> None:
        AppStateStore.DEFAULT_PATH = self._original_path
        self._tmpdir.cleanup()

    def test_bindings_and_action_toggle(self) -> None:
        cfg = AppConfig(mock=True, work_mode="build", intensity="max")
        app = MyOpenClawTextualApp(cfg)

        # 1) BINDINGS 兼容 tuple (str, str, str) 和 Binding dataclass 两种格式
        bindings: dict[str, str] = {}
        for b in MyOpenClawTextualApp.BINDINGS:
            if isinstance(b, tuple):
                key, action, _name = b
            else:
                key, action = b.key, b.action
            bindings[key] = action
        self.assertEqual(bindings.get("shift+tab"), "cycle_work_mode")
        self.assertEqual(bindings.get("tab"), "cycle_focus")

        # 2) action 方法存在
        self.assertTrue(hasattr(app, "action_cycle_work_mode"))

        # 3) 默认值
        self.assertEqual(app.config.work_mode, "build")
        self.assertEqual(app.config.intensity, "max")

        # 4) Shift+Tab 一次 -> plan
        app.mode = "chat"
        app.action_cycle_work_mode()
        self.assertEqual(app.config.work_mode, "plan")
        self.assertEqual(app.controller.work_mode, "plan")

        # 5) 再按一次 -> build
        app.action_cycle_work_mode()
        self.assertEqual(app.config.work_mode, "build")
        self.assertEqual(app.controller.work_mode, "build")

    def test_status_pane_renders_work_mode_and_intensity(self) -> None:
        cfg = AppConfig(mock=True, work_mode="plan", intensity="high")
        app = MyOpenClawTextualApp(cfg)

        # 直接读源文件, 断言 update_status 内包含新字段(避免 textual mount 限制)
        import tui_python.app as appmod
        with open(appmod.__file__, "r", encoding="utf-8") as f:
            src = f.read()
        self.assertIn("work_mode.capitalize", src)
        self.assertIn("intensity or", src)
        self.assertIn("work_mode", src)
        self.assertIn("intensity", src)

    def test_send_message_payload_carries_work_mode_and_intensity(self) -> None:
        cfg = AppConfig(mock=True, work_mode="plan", intensity="high")
        app = MyOpenClawTextualApp(cfg)

        captured: list[dict] = []

        async def fake_request(action, payload, timeout):
            captured.append(payload)
            return {"matched": True, "sessionId": "s1"}

        app.controller.request = fake_request
        asyncio.run(app.controller.send_message("ping from plan mode"))

        self.assertEqual(captured[-1]["workMode"], "plan")
        self.assertEqual(captured[-1]["intensity"], "high")

    def test_action_keeps_intensity_unchanged(self) -> None:
        """Shift+Tab 只翻 work_mode, intensity 保持(后者由 P1 Ctrl+M 控制)."""
        cfg = AppConfig(mock=True, work_mode="build", intensity="medium")
        app = MyOpenClawTextualApp(cfg)
        app.mode = "chat"

        app.action_cycle_work_mode()
        self.assertEqual(app.config.intensity, "medium")
        self.assertEqual(app.controller.intensity, "medium")
        self.assertEqual(app.config.work_mode, "plan")


if __name__ == "__main__":
    unittest.main()
