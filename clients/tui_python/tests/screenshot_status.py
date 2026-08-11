"""截屏 StatusPane 紧凑布局, 覆盖 work_mode × intensity × model 三个维度."""
import asyncio
from pathlib import Path
from tui_python.app import MyOpenClawTextualApp
from tui_python.config import AppConfig


async def shoot(work_mode: str, intensity: str, model: str, out_path: str) -> None:
    cfg = AppConfig(mock=True, work_mode=work_mode, intensity=intensity, model=model)
    app = MyOpenClawTextualApp(cfg)
    async with app.run_test() as pilot:
        app.mode = "chat"
        app._refresh()
        app.query_one("#chat-input").focus()
        await pilot.pause()
        await pilot.pause()
        await pilot.pause()
        app.save_screenshot(out_path)
        print(f"  saved {out_path}  (work_mode={work_mode}, intensity={intensity}, model={model})")


async def main() -> None:
    out_dir = Path("screenshots")
    out_dir.mkdir(exist_ok=True)
    print("=== A. work_mode 对比 ===")
    await shoot("build", "max", "deepseek-v4-pro", str(out_dir / "status_build_max.svg"))
    await shoot("plan", "high", "deepseek-v4-pro", str(out_dir / "status_plan_high.svg"))
    await shoot("build", "low", "deepseek-v4-pro", str(out_dir / "status_build_low.svg"))
    print()
    print("=== B. intensity 4 档对比 ===")
    for intensity in ["low", "medium", "high", "max"]:
        await shoot("build", intensity, "deepseek-v4-pro", str(out_dir / f"intensity_{intensity}.svg"))
    print()
    print("=== C. model 3 档对比 ===")
    for model in ["deepseek-v4-pro", "deepseek-v4-flash", "gpt-4o"]:
        await shoot("build", "max", model, str(out_dir / f"model_{model}.svg"))


asyncio.run(main())
