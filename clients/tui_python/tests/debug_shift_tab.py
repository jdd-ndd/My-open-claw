"""监听 run_action 看 binding 是否触发."""
import asyncio
from tui_python.app import MyOpenClawTextualApp
from tui_python.config import AppConfig


async def main() -> None:
    cfg = AppConfig(mock=True, work_mode="build")
    app = MyOpenClawTextualApp(cfg)

    # monkey-patch run_action
    original = app.run_action
    log = []
    async def logged_run_action(action, namespace=None):
        log.append((action, namespace))
        result = await original(action, namespace)
        log.append((action, "->", result))
        return result
    app.run_action = logged_run_action

    async with app.run_test() as pilot:
        # 监听 check_bindings
        original_check = app._check_bindings
        async def logged_check(key, priority=False):
            r = await original_check(key, priority)
            print(f"[_check_bindings] key={key!r} priority={priority} -> {r}")
            return r
        app._check_bindings = logged_check

        app.mode = "chat"
        await pilot.pause()

        print("=== pilot.press('tab') ===")
        await pilot.press("tab")
        await pilot.pause()
        print("focus_area:", app.focus_area)
        print("run_action log:", log)
        log.clear()

        print("=== pilot.press('shift+tab') ===")
        await pilot.press("shift+tab")
        await pilot.pause()
        print("work_mode:", app.config.work_mode)
        print("run_action log:", log)


asyncio.run(main())
