"""截图两轮 pilot: 1st session 切 state 后存盘, 2nd session 启动加载回来."""
import asyncio
import json
import tempfile
from pathlib import Path
from tui_python.app import MyOpenClawTextualApp
from tui_python.config import AppConfig, AppStateStore


async def main() -> None:
    out_dir = Path("screenshots")
    out_dir.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        state_path = Path(tmp) / "tui-state.json"
        store = AppStateStore(state_path)

        # ============ Round 1: 切到 plan + low + flash ============
        cfg1 = AppConfig(mock=True, work_mode="build", intensity="max", model="deepseek-v4-pro")
        app1 = MyOpenClawTextualApp(cfg1, state_store=store)
        async with app1.run_test() as pilot:
            app1.mode = "chat"
            app1._refresh()
            app1.query_one("#chat-input").focus()
            await pilot.pause()
            await pilot.pause()

            # 切 work_mode: build -> plan
            await pilot.press("shift+tab")
            await pilot.pause()
            # 切 intensity: max -> low
            await pilot.press("ctrl+m")
            await pilot.pause()
            # 切 model: deepseek-v4-pro -> deepseek-v4-flash
            await pilot.press("ctrl+shift+m")
            await pilot.pause()

            print("=== Round 1 state ===")
            print(f"  work_mode = {app1.config.work_mode}")
            print(f"  intensity = {app1.config.intensity}")
            print(f"  model     = {app1.config.model}")
            app1.save_screenshot(str(out_dir / "persist_round1.svg"))

            # Round 1 退出后, state 应已落盘
            assert state_path.exists(), "state should be persisted to disk"
            persisted = json.loads(state_path.read_text(encoding="utf-8"))
            print(f"  persisted = {persisted}")

        # ============ Round 2: 重新构造 app, 验证 state 恢复 ============
        cfg2 = AppConfig(mock=True)  # 用 cfg 默认值, 但应被 loaded state 覆盖
        app2 = MyOpenClawTextualApp(cfg2, state_store=store)
        print()
        print("=== Round 2 state (after restart) ===")
        print(f"  work_mode = {app2.config.work_mode}  (default: build)")
        print(f"  intensity = {app2.config.intensity}  (default: max)")
        print(f"  model     = {app2.config.model}  (default: deepseek-v4-pro)")

        async with app2.run_test() as pilot:
            app2.mode = "chat"
            app2._refresh()
            app2.query_one("#chat-input").focus()
            await pilot.pause()
            await pilot.pause()
            app2.save_screenshot(str(out_dir / "persist_round2.svg"))


asyncio.run(main())
