"""截图 Ctrl+P 命令面板: 全部命令 / 搜 intensity 过滤后."""
import asyncio
import tempfile
from pathlib import Path
from tui_python.app import MyOpenClawTextualApp
from tui_python.config import AppConfig, AppStateStore


async def shoot(query: str, out_path: str) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        AppStateStore.DEFAULT_PATH = Path(tmp) / "tui-state.json"
        cfg = AppConfig(mock=True)
        app = MyOpenClawTextualApp(cfg)
        async with app.run_test() as pilot:
            app.mode = "chat"
            app._refresh()
            app.query_one("#chat-input").focus()
            await pilot.pause()
            await pilot.press("ctrl+p")
            await pilot.pause()
            modal = app.screen
            if query:
                for ch in query:
                    await pilot.press(ch)
                await pilot.pause()
            await pilot.pause()
            app.save_screenshot(out_path)
            print(f"  saved {out_path}  (query={query!r})")


async def main() -> None:
    out_dir = Path("screenshots")
    out_dir.mkdir(exist_ok=True)
    await shoot("", str(out_dir / "palette_empty.svg"))
    await shoot("intensity", str(out_dir / "palette_intensity.svg"))
    await shoot("quit", str(out_dir / "palette_quit.svg"))
    await shoot("xyz_nomatch", str(out_dir / "palette_nomatch.svg"))


asyncio.run(main())
