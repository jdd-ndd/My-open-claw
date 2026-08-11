"""P1.1 状态持久化测试: save -> load roundtrip + 异常兜底 + pilot 端到端."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path

from tui_python.app import MyOpenClawTextualApp
from tui_python.config import AppConfig, AppState, AppStateStore


class AppStateStoreTests(unittest.TestCase):
    def test_roundtrip_preserves_all_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tui-state.json"
            store = AppStateStore(path)
            original = AppState(
                work_mode="plan",
                intensity="high",
                model="gpt-4o",
                focus_area="sidebar",
            )
            self.assertTrue(store.save_to_disk(original))
            loaded = store.load_from_disk()
            self.assertEqual(loaded, original)

    def test_load_returns_none_when_file_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "does-not-exist.json"
            store = AppStateStore(path)
            loaded = store.load_from_disk()
            self.assertIsNone(loaded, "missing file should return None, not a default AppState")

    def test_load_returns_none_when_json_corrupt(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tui-state.json"
            path.write_text("{ not valid json", encoding="utf-8")
            store = AppStateStore(path)
            loaded = store.load_from_disk()
            self.assertIsNone(loaded, "corrupt json should return None")

    def test_load_returns_none_when_data_not_dict(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tui-state.json"
            path.write_text(json.dumps(["array", "not", "dict"]), encoding="utf-8")
            store = AppStateStore(path)
            loaded = store.load_from_disk()
            self.assertIsNone(loaded, "non-dict data should return None")

    def test_load_returns_none_when_all_fields_wrong_type(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tui-state.json"
            path.write_text(
                json.dumps({
                    "work_mode": 12345,        # 错类型
                    "intensity": ["x"],        # 错类型
                    "model": None,             # 错类型
                    "focus_area": True,        # 错类型
                }),
                encoding="utf-8",
            )
            store = AppStateStore(path)
            loaded = store.load_from_disk()
            self.assertIsNone(loaded, "all-wrong-type data should return None")

    def test_load_skips_unknown_keys_and_wrong_types(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tui-state.json"
            path.write_text(
                json.dumps({
                    "work_mode": "plan",
                    "intensity": 12345,        # 错类型, 应被跳过
                    "model": "gpt-4o",
                    "focus_area": None,         # 错类型, 应被跳过
                    "unknown_key": "ignored",   # 未知键, 应被忽略
                }),
                encoding="utf-8",
            )
            store = AppStateStore(path)
            loaded = store.load_from_disk()
            self.assertIsNotNone(loaded)
            # 至少有 1 个有效字段 (work_mode + model), 仍返回 state
            self.assertEqual(loaded.work_mode, "plan")
            self.assertEqual(loaded.intensity, "max", "wrong-type field should use dataclass default")
            self.assertEqual(loaded.model, "gpt-4o")
            self.assertEqual(loaded.focus_area, "input", "wrong-type field should use dataclass default")

    def test_save_creates_parent_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "nested" / "deep" / "tui-state.json"
            store = AppStateStore(path)
            self.assertTrue(store.save_to_disk(AppState(work_mode="plan")))
            self.assertTrue(path.exists())

    def test_save_to_disk_atomic_via_write_text(self) -> None:
        """基本防呆: 写一个能存的 state 后再读, 值正确."""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tui-state.json"
            store = AppStateStore(path)
            state = AppState(work_mode="plan", intensity="medium", model="deepseek-v4-flash")
            store.save_to_disk(state)
            raw = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(raw, {
                "work_mode": "plan",
                "intensity": "medium",
                "model": "deepseek-v4-flash",
                "focus_area": "input",
            })

    def test_merge_into_overrides_only_persist_keys(self) -> None:
        """AppState.merge_into 不会触碰 non-persist 字段(spent/cwd 等)."""
        cfg = AppConfig(spent=42, cwd="/some/path", model="orig")
        state = AppState(work_mode="plan", intensity="high", model="gpt-4o")
        state.merge_into(cfg)
        self.assertEqual(cfg.work_mode, "plan")
        self.assertEqual(cfg.intensity, "high")
        self.assertEqual(cfg.model, "gpt-4o")
        # 不应被覆盖
        self.assertEqual(cfg.spent, 42)
        self.assertEqual(cfg.cwd, "/some/path")


class AppPersistencePilotTests(unittest.IsolatedAsyncioTestCase):
    async def test_cycle_work_mode_persists_across_relaunch(self) -> None:
        """pilot 端到端: 1st session 切 mode, 2nd session 加载, 验证 state 恢复."""
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "tui-state.json"
            store = AppStateStore(state_path)

            # 1st session: 切 work_mode -> plan
            cfg1 = AppConfig(mock=True, work_mode="build", intensity="max")
            app1 = MyOpenClawTextualApp(cfg1, state_store=store)
            async with app1.run_test() as pilot:
                app1.mode = "chat"
                app1.query_one("#chat-input").focus()
                await pilot.pause()
                await pilot.press("shift+tab")
                await pilot.pause()
                self.assertEqual(app1.config.work_mode, "plan")
                # state 文件应已落盘
                self.assertTrue(state_path.exists())

            # 2nd session: 新 app 实例, 用同一个 store, 加载
            cfg2 = AppConfig(mock=True, work_mode="build", intensity="max")
            app2 = MyOpenClawTextualApp(cfg2, state_store=store)
            self.assertEqual(app2.config.work_mode, "plan", "2nd session should pick up persisted plan mode")
            self.assertEqual(app2.controller.work_mode, "plan")

    async def test_cycle_intensity_and_model_persist(self) -> None:
        """Ctrl+M + Ctrl+Shift+M 切换后重启, intensity + model 都恢复."""
        with tempfile.TemporaryDirectory() as tmp:
            state_path = Path(tmp) / "tui-state.json"
            store = AppStateStore(state_path)

            cfg1 = AppConfig(mock=True)
            app1 = MyOpenClawTextualApp(cfg1, state_store=store)
            async with app1.run_test() as pilot:
                app1.mode = "chat"
                app1.query_one("#chat-input").focus()
                await pilot.pause()
                # 切 intensity: max -> low
                await pilot.press("ctrl+m")
                await pilot.pause()
                self.assertEqual(app1.config.intensity, "low")
                # 切 model: deepseek-v4-pro -> deepseek-v4-flash
                await pilot.press("ctrl+shift+m")
                await pilot.pause()
                self.assertEqual(app1.config.model, "deepseek-v4-flash")

            cfg2 = AppConfig(mock=True)
            app2 = MyOpenClawTextualApp(cfg2, state_store=store)
            self.assertEqual(app2.config.intensity, "low", "intensity should persist")
            self.assertEqual(app2.config.model, "deepseek-v4-flash", "model should persist")
            # work_mode 仍是默认 build(没切过)
            self.assertEqual(app2.config.work_mode, "build")

    async def test_persist_failure_does_not_crash_tui(self) -> None:
        """state 文件路径不可写时, TUI 不应崩溃, 仅 _persist_state 返回 False."""
        # 创建一个"目录"占位, 让 store 把它当文件去 write_text 会失败
        with tempfile.TemporaryDirectory() as tmp:
            fake_dir = Path(tmp) / "fake-state-file"
            fake_dir.mkdir()  # 当成"文件路径", 实际是目录
            store = AppStateStore(fake_dir)
            cfg = AppConfig(mock=True)
            app = MyOpenClawTextualApp(cfg, state_store=store)
            async with app.run_test() as pilot:
                app.mode = "chat"
                app.query_one("#chat-input").focus()
                await pilot.pause()
                # 切 mode, _persist_state 内部会失败但 TUI 继续
                await pilot.press("shift+tab")
                await pilot.pause()
                # 状态确实被改了
                self.assertEqual(app.config.work_mode, "plan")


if __name__ == "__main__":
    unittest.main()
