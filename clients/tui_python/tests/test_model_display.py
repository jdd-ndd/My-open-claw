"""P1.5 model display name 映射表单元 + StatusPane 渲染验证."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from tui_python.app import MyOpenClawTextualApp, StatusPane
from tui_python.config import (
    MODEL_DISPLAY_NAMES,
    AppConfig,
    AppStateStore,
    model_display_name,
)


class ModelDisplayNameTests(unittest.TestCase):
    def test_known_models_have_proper_display(self) -> None:
        cases = {
            "deepseek-v4-pro": "DeepSeek V4 Pro",
            "deepseek-v4-flash": "DeepSeek V4 Flash",
            "gpt-4o": "GPT-4o",
            "gpt-4o-mini": "GPT-4o mini",
            "claude-3-5-sonnet": "Claude 3.5 Sonnet",
            "claude-3-5-haiku": "Claude 3.5 Haiku",
        }
        for model_id, expected in cases.items():
            self.assertEqual(model_display_name(model_id), expected, f"mapping for {model_id}")

    def test_unknown_model_falls_back_to_title_format(self) -> None:
        """未知 model id 走 .title() fallback: 'foo-bar-baz' -> 'Foo Bar Baz'."""
        self.assertEqual(model_display_name("foo-bar-baz"), "Foo Bar Baz")
        self.assertEqual(model_display_name("llama-3-70b"), "Llama 3 70B")

    def test_empty_string_falls_back_to_unknown(self) -> None:
        self.assertEqual(model_display_name(""), "Unknown")

    def test_mapping_table_does_not_misuse_format(self) -> None:
        """映射表里所有 model id 都是规范 id, 不会有人传奇怪字符串."""
        for model_id in MODEL_DISPLAY_NAMES:
            self.assertTrue(model_id, f"empty model id in table: {model_id!r}")
            self.assertTrue(model_display_name(model_id), f"empty display for {model_id}")


class StatusPaneModelRenderingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._original_path = AppStateStore.DEFAULT_PATH
        AppStateStore.DEFAULT_PATH = Path(self._tmpdir.name) / "tui-state.json"

    def tearDown(self) -> None:
        AppStateStore.DEFAULT_PATH = self._original_path
        self._tmpdir.cleanup()

    async def test_status_renders_proper_model_display_names(self) -> None:
        """3 个 model 切到 status pane, 验证显示名都用映射表(不是 .title())."""
        cases = [
            ("deepseek-v4-pro", "DeepSeek V4 Pro"),
            ("deepseek-v4-flash", "DeepSeek V4 Flash"),
            ("gpt-4o", "GPT-4o"),
        ]
        for model_id, expected in cases:
            cfg = AppConfig(mock=True, model=model_id)
            app = MyOpenClawTextualApp(cfg)
            async with app.run_test() as pilot:
                app.mode = "chat"
                await pilot.pause()
                status = app.query_one("#status", StatusPane)
                text = str(status.content)
                self.assertIn(expected, text, f"model={model_id} should display as {expected!r}, got: {text!r}")
                # 确认不是 fallback (比如 'Gpt 4 O' 不应出现)
                self.assertNotIn("Gpt 4", text, f"model={model_id} should not use naive .title() fallback")

    async def test_unknown_model_uses_fallback_in_status(self) -> None:
        cfg = AppConfig(mock=True, model="mystery-llm-7b")
        app = MyOpenClawTextualApp(cfg)
        async with app.run_test() as pilot:
            app.mode = "chat"
            await pilot.pause()
            status = app.query_one("#status", StatusPane)
            text = str(status.content)
            self.assertIn("Mystery Llm 7B", text, "unknown model should fall back to Title format")


if __name__ == "__main__":
    unittest.main()
