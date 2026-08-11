from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any

from .chat_state import ChatController
from .commands import DEFAULT_COMMANDS, Command
from .config import AppConfig, AppState, AppStateStore, SessionInfo, model_display_name
from .gateway_client import BaseGatewayClient, WebSocketGatewayClient
from .mock_gateway import MockGatewayClient
from .models import ChatMessage, ViewMode
from .protocol import EventMessage
from .sessions_api import SessionApiClient
from .tools_api import SkillMeta, ToolMeta, ToolsApiClient
from .ppt_api import PptApiClient, PptSpec, ThemeMeta, TemplateMeta

try:
    from textual.app import App, ComposeResult
    from textual.binding import Binding
    from textual.containers import Center, Horizontal, Middle, Vertical
    from textual import events
    from textual.reactive import reactive
    from textual.screen import ModalScreen
    from textual.widgets import Footer, Header, Input, OptionList, RichLog, Static
    from textual.widgets.option_list import Option
except ModuleNotFoundError:  # pragma: no cover
    App = object  # type: ignore[misc,assignment]
    Binding = tuple  # type: ignore[misc,assignment]
    ComposeResult = Any  # type: ignore[misc,assignment]
    Center = Horizontal = Middle = Vertical = Header = Footer = Input = RichLog = Static = object  # type: ignore[assignment]
    ModalScreen = object  # type: ignore[assignment,misc]
    OptionList = object  # type: ignore[assignment,misc]
    Option = object  # type: ignore[assignment,misc]
    events = Any  # type: ignore[assignment]
    reactive = lambda value=None: value  # type: ignore[assignment]


HELP_TEXT = """Keyboard Help

Launch
Enter        Start chat with the text in the launch box
?            Toggle help
Ctrl+C       Quit

Chat
Enter        Send message
Tab          Cycle focus: input -> messages -> sidebar
Shift+Tab    Toggle work mode: Build <-> Plan
Ctrl+M       Cycle intensity: low -> medium -> high -> max
Ctrl+Shift+M Cycle model
Ctrl+P       Open command palette
/            Open skills and tools picker
Up / Down    Select slash entry
Esc          Cancel stream, close slash picker, or return to launch
r            Reconnect Gateway
c            Clear chat
l            Load more history
Mouse click  Expand/collapse a reasoning arrow
g / G        Scroll message log top / bottom
?            Toggle help
q / Ctrl+C   Quit
"""

LOGO_LINES = [
    "  ╔═══════════════════════════════════════════════════════════════════════════════════╗",
    "  ║      ██╗     ██████╗ ██████╗ ███████╗███╗   ██╗ ██████╗██╗      █████╗ ██╗    ██╗ ║",
    "  ║      ██║    ██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔════╝██║     ██╔══██╗██║    ██║ ║",
    "  ║      ██║    ██║   ██║██████╔╝█████╗  ██╔██╗ ██║██║     ██║     ███████║██║ █╗ ██║ ║",
    "  ║ ██   ██║    ██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║██║     ██║     ██╔══██║██║███╗██║ ║",
    "  ║ ╚█████╔╝    ╚██████╔╝██║     ███████╗██║ ╚████║╚██████╗███████╗██║  ██║╚███╔███╔╝ ║",
    "  ║  ╚════╝      ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝  ║",
    "  ╚═══════════════════════════════════════════════════════════════════════════════════╝",
]


def _query(value: str) -> str:
    return value.lstrip("/").strip().lower()


@dataclass(slots=True)
class SlashEntry:
    """Slash 面板条目数据结构

    扩展字段用于承载远程工具/技能元数据：
    - source: 条目来源（local=本地命令 / tool=远程工具 / skill=远程技能）
    - category: 工具分类（fs/exec/http/routing/calculator 等）
    - risk: 风险等级（low/medium/high）
    - triggers: 技能触发词列表
    """
    name: str
    slash: str
    title: str
    group: str
    kind: str
    summary: str
    insert_text: str
    action: str | None = None
    # 新增字段：远程工具/技能元数据
    source: str = "local"           # local | tool | skill
    category: str = ""              # 工具分类
    risk: str = ""                  # 风险等级 low/medium/high
    triggers: list[str] = field(default_factory=list)  # 技能触发词


# 本地命令：真正由 TUI 直接处理的入口（不依赖服务端注册）
# 远程工具/技能会在运行时通过 ToolsApiClient 动态拉取并合并
LOCAL_SLASH_ENTRIES: list[SlashEntry] = [
    SlashEntry("agents", "/agents", "Switch agent", "Agents", "agent", "Choose an agent profile for the current task", "/agents "),
    SlashEntry("connect", "/connect", "Connect provider", "Tools", "tool", "Connect or reconnect the active provider", "/connect ", "reconnect"),
    SlashEntry("debug", "/debug", "View debug info", "Tools", "tool", "Inspect runtime state, logs, and diagnostics", "/debug "),
    SlashEntry("diff", "/diff", "Open diff viewer", "Tools", "tool", "Inspect recent code changes and pending edits", "/diff "),
    SlashEntry("editor", "/editor", "Open editor", "Tools", "tool", "Jump into focused editing flow", "/editor "),
    SlashEntry("exit", "/exit", "Exit the app", "General", "command", "Close the TUI application", "/exit", "quit"),
    SlashEntry("help", "/help", "Help", "General", "command", "Show help and keyboard guidance", "/help", "toggle_help"),
    SlashEntry("init", "/init", "Guided setup", "Agents", "skill", "Bootstrap AGENTS.md and workspace defaults", "/init "),
    SlashEntry("mcps", "/mcps", "Toggle MCPs", "Tools", "tool", "Enable or inspect available MCP connections", "/mcps "),
    SlashEntry("models", "/models", "Switch model", "Models", "tool", "Choose the active model for this conversation", "/models ", "open_model_palette"),
    SlashEntry("memory", "/memory", "Memory recall", "Tools", "tool", "Search saved memory and prior context", "/memory "),
    SlashEntry("ppt", "/ppt", "PPT Studio", "Tools", "tool", "Generate a PPT from theme + slide spec", "/ppt "),
    SlashEntry("sessions", "/sessions", "Open sessions", "Session", "tool", "List, switch, and manage chat sessions", "/sessions ", "open_sessions_palette"),
]

# 兼容别名：保留 SLASH_ENTRIES 名称以避免破坏潜在的外部引用
# 内容为本地命令的快照，运行时实际使用 _get_merged_slash_entries() 合并远程数据
SLASH_ENTRIES: list[SlashEntry] = list(LOCAL_SLASH_ENTRIES)

# 远程能力缓存 TTL（毫秒），与 Web 端 useSkills 的 5 分钟缓存对齐
_REMOTE_CAPABILITY_CACHE_TTL_MS = 5 * 60 * 1000


def _tool_to_slash_entry(tool: ToolMeta) -> SlashEntry:
    """将服务端 ToolMeta 转换为 SlashEntry

    工具调用通过 insert_text 注入 [调用工具:xxx] 标记，
    由服务端 Orchestrator 解析为工具调用请求
    """
    name = tool.name or "unknown"
    # 工具名含 / 时，slash 路径用短名（取最后一段）避免路径歧义
    short_name = name.rsplit("/", 1)[-1]
    return SlashEntry(
        name=f"tool:{name}",
        slash=f"/tool/{short_name}",
        title=f"{short_name}  ({tool.category or 'tool'})",
        group="Remote Tools",
        kind="tool",
        summary=tool.description or f"Invoke tool: {name}",
        insert_text=f"[调用工具:{name}] ",
        source="tool",
        category=tool.category,
        risk=tool.risk,
    )


def _skill_to_slash_entry(skill: SkillMeta) -> SlashEntry:
    """将服务端 SkillMeta 转换为 SlashEntry

    技能调用通过 insert_text 注入 [启用技能:xxx] 标记，
    由服务端 SkillRegistry 匹配触发词并激活对应技能
    """
    name = skill.name or "unknown"
    return SlashEntry(
        name=f"skill:{name}",
        slash=f"/skill/{name}",
        title=name,
        group="Remote Skills",
        kind="skill",
        summary=skill.description or f"Activate skill: {name}",
        insert_text=f"[启用技能:{name}] ",
        source="skill",
        triggers=list(skill.triggers),
    )


class LaunchPane(Static):
    def update_launch(self, config: AppConfig, client: BaseGatewayClient) -> None:
        state = "ready" if client.connection_state in {"connected", "disconnected"} else client.connection_state
        logo = "\n".join(f"[#d1d5db]{line}[/]" for line in LOGO_LINES)
        self.update(
            f"{logo}\n\n"
            f"[bold #8b8b8b]{state}[/]  [#5a5a5a]{config.gateway_url}[/]\n"
            "[#7d7d7d]Press Enter to start, ? for help, Ctrl+C to quit[/]"
        )


class ConnectingPane(Static):
    def update_connecting(self, config: AppConfig, client: BaseGatewayClient) -> None:
        self.update(
            f"[bold #f5f5f5]Connecting[/]\n"
            f"[#8b8b8b]{config.gateway_url}[/]\n"
            f"[#777777]{client.connection_state}[/]"
        )


class MessagePane(RichLog):
    expanded_reasoning: set[str]
    reasoning_click_lines: dict[int, str]
    _line_no: int

    def on_mount(self) -> None:
        self.expanded_reasoning = set()
        self.reasoning_click_lines = {}
        self._line_no = 0

    def on_click(self, event: events.Click) -> None:
        clicked_line = int(getattr(event, "y", 0)) + int(getattr(self, "scroll_y", 0)) - 1
        message_id = self.reasoning_click_lines.get(clicked_line) or self.reasoning_click_lines.get(clicked_line - 1)
        if not message_id:
            return
        if message_id in self.expanded_reasoning:
            self.expanded_reasoning.remove(message_id)
        else:
            self.expanded_reasoning.add(message_id)
        self.render_state(self.app.controller)  # type: ignore[attr-defined]

    def _log(self, text: str) -> None:
        self.write(text)
        self._line_no += max(1, text.count("\n") + 1)

    def render_state(self, controller: ChatController) -> None:
        self.clear()
        self.reasoning_click_lines = {}
        self._line_no = 0
        state = controller.state
        self._log(f"[bold #3b9ddd]History[/] [#777777]- {len(state.messages)} msgs[/]")
        self._log("[dim]--------------------------------------------------------[/]")
        if state.last_event_name:
            self._log(f"[dim]last event: {state.last_event_name}[/]")
            if state.last_event_preview:
                self._log(f"[dim]{state.last_event_preview}[/]")
            self._log("[dim]--------------------------------------------------------[/]")
        if not state.messages and not state.active_stream:
            self._log("[dim]No messages yet. Type below and press Enter.[/]")
            return
        for message in state.messages:
            self._write_message(message)
        if state.active_stream:
            self._log(f"[bold #d0d7de]JARVIS[/] [#777777]{state.active_stream.time}[/] [bold yellow]streaming[/]")
            if state.reasoning_content:
                self._log("[bold #999999]> thinking[/]")
                for line in state.reasoning_content.splitlines() or [state.reasoning_content]:
                    self._log(f"[dim]  {line}[/]")
            if state.streaming_content:
                self._log(state.streaming_content)
            elif state.reasoning_content:
                self._log("[bold yellow]  ⏳ 思考中...[/]")
            else:
                self._log("[bold cyan]  ⏳ 正在处理您的问题...[/]")

    def _write_message(self, message: ChatMessage) -> None:
        role = "[bold #3b9ddd]You[/]" if message.role == "user" else "[bold #d0d7de]JARVIS[/]" if message.role == "assistant" else "[bold yellow]System[/]"
        self._log(f"{role} [dim]{message.time}[/]")
        self._log(message.content or " ")
        if message.reasoning:
            self.reasoning_click_lines[self._line_no] = message.id
            marker = "▼" if message.id in self.expanded_reasoning else "▶"
            self._log(f"[bold #3b9ddd]{marker}[/] [dim]reasoning (click arrow to toggle)[/]")
            if message.id in self.expanded_reasoning:
                for line in message.reasoning.splitlines() or [message.reasoning]:
                    self._log(f"[dim]  {line}[/]")
        self._log(" ")


class SidebarPane(Static):
    def update_sidebar(self, config: AppConfig, client: BaseGatewayClient, controller: ChatController, selected_session: int) -> None:
        sessions = "\n".join(f"{'>' if i == selected_session else ' '} {s.title}" for i, s in enumerate(config.sessions))
        self.update(
            f"[bold]Connection[/]\n{client.connection_state}\n\n"
            f"[bold]System[/]\nCWD: {config.cwd}\nSpent: {config.spent}\n\n"
            f"[bold]Sessions[/]\n{sessions}\n\n"
            f"[bold]Last error[/]\n{controller.state.last_error or '-'}"
        )


class StatusPane(Static):
    INTENSITY_COLORS = {"low": "#6b7280", "medium": "#fb923c", "high": "#fbbf24", "max": "#ef4444"}
    MODE_COLORS = {"build": "#3b9ddd", "plan": "#a78bfa"}
    
    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.server_time_text = ""

    def update_status(self, config: AppConfig, client: BaseGatewayClient, controller: ChatController, focus: str, mode: str, server_time_text: str = "") -> None:  # noqa: ARG002
        work_mode = (config.work_mode or "build").lower()
        intensity = (config.intensity or "max").lower()
        model_display = model_display_name(config.model)
        mode_color = self.MODE_COLORS.get(work_mode, self.MODE_COLORS["build"])
        intensity_color = self.INTENSITY_COLORS.get(intensity, self.INTENSITY_COLORS["max"])
        self.server_time_text = server_time_text
        time_part = f"  |  [bold white]{server_time_text}[/]" if server_time_text else ""
        self.update(f"[bold {mode_color}]{work_mode.title()}[/]  |  [bold white]{model_display}[/]  |  [bold {intensity_color}]{intensity}[/]{time_part}")


class CommandPaletteModal(ModalScreen[None]):
    CSS = """
    CommandPaletteModal { align: center middle; background: transparent; }
    CommandPaletteModal > Vertical {
        width: 84;
        height: auto;
        max-height: 85%;
        background: #151515;
        color: #f3f4f6;
        padding: 1 2;
    }
    CommandPaletteModal Input {
        margin-top: 1;
        margin-bottom: 1;
        border: none;
        background: #151515;
        color: #f3f4f6;
    }
    CommandPaletteModal OptionList {
        height: auto;
        max-height: 20;
        background: #151515;
        border: none;
    }
    CommandPaletteModal .palette-header { color: #f3f4f6; }
    CommandPaletteModal .palette-hint { color: #8f8f8f; text-align: left; margin-top: 1; }
    """

    BINDINGS = [
        ("escape", "dismiss_palette", "Close"),
        ("enter", "submit_palette", "Run"),
        ("up", "cursor_up", "Up"),
        ("down", "cursor_down", "Down"),
    ]

    def __init__(self, app: "MyOpenClawTextualApp") -> None:
        super().__init__()
        self._app_ref = app
        self._commands = list(DEFAULT_COMMANDS)

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Static("[bold white]Commands[/]                                     [dim]esc[/]", classes="palette-header")
            yield Input(placeholder="Search", id="palette-search")
            yield OptionList(id="palette-options")
            yield Static("[bold white]Connect provider[/] [dim]ctrl+a[/]   [bold white]Favorite[/] [dim]ctrl+f[/]", classes="palette-hint")

    def on_mount(self) -> None:
        self._rebuild_options("")
        self.query_one("#palette-search", Input).focus()

    def _filtered_commands(self, query: str) -> list[Command]:
        q = _query(query)
        if not q:
            return [c for c in self._commands if self._is_available(c)]
        if q == "mode":
            return [c for c in self._commands if self._is_available(c) and q in c.group.lower()]
        if q == "switch":
            return [c for c in self._commands if self._is_available(c) and c.title.lower().startswith("switch")]
        return [
            c for c in self._commands
            if self._is_available(c)
            and (
                q in c.title.lower()
                or q in c.keybinding.lower()
                or q in c.group.lower()
                or q in c.name.lower()
                or q in c.slash.lower()
            )
        ]

    def _is_available(self, command: Command) -> bool:
        if command.is_available is None:
            return True
        try:
            return command.is_available(self._app_ref)
        except Exception:
            return True

    def _rebuild_options(self, query: str) -> None:
        option_list = self.query_one("#palette-options", OptionList)
        option_list.clear_options()
        filtered = self._filtered_commands(query)
        if not filtered:
            option_list.add_option(Option("No matches", disabled=True))
            return
        grouped: dict[str, list[Command]] = {}
        for cmd in filtered:
            grouped.setdefault(cmd.group, []).append(cmd)

        preferred_order = ["Suggested", "Session", "Mode", "Window", "Chat", "App"]
        ordered_groups = [group for group in preferred_order if group in grouped]
        for extra_group in grouped:
            if extra_group not in ordered_groups:
                ordered_groups.append(extra_group)

        max_per_group = 4
        for group_name in ordered_groups:
            group_commands = grouped[group_name][:max_per_group]
            option_list.add_option(Option(group_name, disabled=True))
            for cmd in group_commands:
                label = cmd.title
                if cmd.keybinding:
                    label = f"{label}  {cmd.keybinding}"
                option_list.add_option(Option(label, id=cmd.name))
        for idx in range(option_list.option_count):
            opt = option_list.get_option_at_index(idx)
            if opt is not None and not getattr(opt, "disabled", False):
                option_list.highlighted = idx
                break

    def on_input_changed(self, event: Input.Changed) -> None:
        if event.input.id == "palette-search":
            self._rebuild_options(event.value)

    def on_input_submitted(self, event: Input.Submitted) -> None:
        # 焦点在 Search Input 上时 Enter 会触发 Input.Submitted，
        # 此时 BINDINGS 中的 enter 不会自动触发，需要手动桥接到 submit_palette
        if event.input.id == "palette-search":
            event.stop()
            self.action_submit_palette()

    def on_option_list_option_selected(self, event: OptionList.OptionSelected) -> None:
        if event.option.id is not None:
            self._run_command_by_name(str(event.option.id))

    def _run_command_by_name(self, cmd_name: str) -> None:
        cmd = next((c for c in self._commands if c.name == cmd_name), None)
        if cmd is None:
            return
        method = getattr(self._app_ref, f"action_{cmd.action}", None)
        self.dismiss(None)
        if callable(method):
            result = method()
            # 支持 async action（如 action_clear_chat / action_reconnect），
            # 同步执行 coroutine（ModalScreen 关闭后主 App 仍持有其引用的 event loop）
            if hasattr(result, "__await__"):
                asyncio.ensure_future(result)

    def action_submit_palette(self) -> None:
        option_list = self.query_one("#palette-options", OptionList)
        # 优先用 highlighted（用户上下键移动过的情况）
        highlighted_idx = option_list.highlighted
        target_idx = highlighted_idx
        if highlighted_idx is None:
            # Input 抢焦点后 highlighted 可能失效，fallback 到第一个非 disabled
            for idx in range(option_list.option_count):
                opt = option_list.get_option_at_index(idx)
                if opt is not None and opt.id is not None and not getattr(opt, "disabled", False):
                    target_idx = idx
                    break
        if target_idx is None:
            return
        opt = option_list.get_option_at_index(target_idx)
        if opt is not None and opt.id is not None and not getattr(opt, "disabled", False):
            self._run_command_by_name(str(opt.id))

    def action_cursor_up(self) -> None:
        option_list = self.query_one("#palette-options", OptionList)
        idx = option_list.highlighted
        if idx is None:
            return
        new_idx = idx - 1
        while new_idx >= 0:
            opt = option_list.get_option_at_index(new_idx)
            if opt is not None and not getattr(opt, "disabled", False):
                option_list.highlighted = new_idx
                return
            new_idx -= 1

    def action_cursor_down(self) -> None:
        option_list = self.query_one("#palette-options", OptionList)
        idx = option_list.highlighted
        if idx is None:
            return
        new_idx = idx + 1
        while new_idx < option_list.option_count:
            opt = option_list.get_option_at_index(new_idx)
            if opt is not None and not getattr(opt, "disabled", False):
                option_list.highlighted = new_idx
                return
            new_idx += 1

    def action_dismiss_palette(self) -> None:
        self.dismiss(None)


class SessionPaletteModal(ModalScreen[None]):
    CSS = CommandPaletteModal.CSS

    BINDINGS = [
        ("escape", "dismiss_palette", "Close"),
        ("enter", "submit_choice", "Choose"),
        ("up", "cursor_up", "Up"),
        ("down", "cursor_down", "Down"),
        ("ctrl+f", "pin_session", "Pin"),
        ("ctrl+d", "delete_session", "Delete"),
        ("ctrl+r", "rename_session", "Rename"),
    ]

    def __init__(self, app: "MyOpenClawTextualApp") -> None:
        super().__init__()
        self._app_ref = app
        self._selected_index = 0

    def _filtered_sessions(self, query: str) -> list[Any]:
        q = query.strip().lower()
        sessions = self._app_ref.config.sessions
        if not q:
            return sessions
        return [session for session in sessions if q in session.title.lower() or q in session.id.lower()]

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Static("[bold white]Sessions[/]                                     [dim]esc[/]", classes="palette-header")
            yield Input(placeholder="Search", id="sessions-search")
            yield Static("", id="sessions-body")
            yield Static("[bold white]pin/unpin[/] [dim]ctrl+f[/]   [bold white]delete[/] [dim]ctrl+d[/]   [bold white]rename[/] [dim]ctrl+r[/]", classes="palette-hint")

    def on_mount(self) -> None:
        self._refresh_body("")
        self.query_one("#sessions-search", Input).focus()

    def on_input_changed(self, event: Input.Changed) -> None:
        if event.input.id == "sessions-search":
            self._selected_index = 0
            self._refresh_body(event.value)

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        # 焦点在 Search Input 上时 Enter 会触发 Input.Submitted，
        # BINDINGS 中的 enter 不会自动触发，需要手动桥接到 submit_choice
        # submit_choice 是 async（含 load_history），必须 await
        if event.input.id == "sessions-search":
            event.stop()
            await self.action_submit_choice()

    def _refresh_body(self, query: str) -> None:
        items = self._filtered_sessions(query)
        if self._selected_index >= len(items):
            self._selected_index = 0
        today = items[:1]
        earlier = items[1:]
        lines = []
        if today:
            lines.append("[bold #a78bfa]Today[/]")
            for index, session in enumerate(today):
                if index == self._selected_index:
                    lines.append(f"[black on #f7b07d] {session.title} [/]")
                else:
                    lines.append(f"[bold white]{session.title}[/]")
            lines.append("")
        if earlier:
            lines.append("[bold #a78bfa]Recent[/]")
            for offset, session in enumerate(earlier, start=len(today)):
                if offset == self._selected_index:
                    lines.append(f"[black on #f7b07d] {session.title} [/]")
                else:
                    lines.append(f"[bold white]{session.title}[/]")
            lines.append("")
        if not items:
            lines.append("[dim]No sessions matched.[/]")
        self.query_one("#sessions-body", Static).update("\n".join(lines))

    def action_cursor_up(self) -> None:
        items = self._filtered_sessions(self.query_one("#sessions-search", Input).value)
        if not items:
            return
        self._selected_index = (self._selected_index - 1) % len(items)
        self._refresh_body(self.query_one("#sessions-search", Input).value)

    def action_cursor_down(self) -> None:
        items = self._filtered_sessions(self.query_one("#sessions-search", Input).value)
        if not items:
            return
        self._selected_index = (self._selected_index + 1) % len(items)
        self._refresh_body(self.query_one("#sessions-search", Input).value)

    async def action_submit_choice(self) -> None:
        items = self._filtered_sessions(self.query_one("#sessions-search", Input).value)
        if not items:
            return
        chosen = items[self._selected_index]
        all_sessions = self._app_ref.config.sessions
        self._app_ref.selected_session = next((idx for idx, session in enumerate(all_sessions) if session.id == chosen.id), 0)
        self._app_ref.config.session_id = chosen.id
        self._app_ref.controller.session_id = chosen.id
        self._app_ref.controller.state.active_session_id = chosen.id
        self._app_ref.notify(f"Selected session: {chosen.title}")

        # 清空旧会话消息，准备加载新会话历史
        self._app_ref.controller.clear()

        # 关键：重新绑定 WebSocket 到新会话，否则服务器仍把事件路由到旧会话
        await self._app_ref._rebind_session()

        # 切换会话后自动加载历史消息
        # 不再静默吞异常：失败时给出明确反馈，让用户知道为何界面为空
        try:
            await self._app_ref.controller.load_history(0, 20)
        except Exception as exc:
            self._app_ref.controller.append_system_message(
                f"[已切换会话] {chosen.title}\n"
                f"[历史加载失败] {exc}（可输入消息开始新对话）"
            )
            self._app_ref._refresh()
            self.dismiss(None)
            return

        # 历史加载成功：若历史为空则给出提示，否则用户能看到历史消息
        if not self._app_ref.controller.state.messages:
            self._app_ref.controller.append_system_message(
                f"[已切换会话] {chosen.title}（空会话，可直接输入消息开始对话）"
            )

        self._app_ref._refresh()
        self.dismiss(None)

    async def action_pin_session(self) -> None:
        items = self._filtered_sessions(self.query_one("#sessions-search", Input).value)
        if not items:
            return
        chosen = items[self._selected_index]
        try:
            await self._app_ref.run_worker(
                lambda: self._app_ref.session_api.update_session(chosen.id, {"pinnedAt": int(__import__('time').time() * 1000)}),
                thread=True,
            )
            await self._app_ref._sync_sessions(create_if_empty=False)
            self._selected_index = 0
        except Exception as exc:
            self._app_ref.notify(f"Pin failed: {exc}", severity="error")
            return
        self._refresh_body(self.query_one("#sessions-search", Input).value)
        self._app_ref.notify(f"Pinned session: {chosen.title}")

    async def action_delete_session(self) -> None:
        items = self._filtered_sessions(self.query_one("#sessions-search", Input).value)
        if not items:
            return
        if len(self._app_ref.config.sessions) <= 1:
            self._app_ref.notify("At least one session must remain", severity="warning")
            return
        chosen = items[self._selected_index]
        try:
            await self._app_ref.run_worker(lambda: self._app_ref.session_api.delete_session(chosen.id), thread=True)
            await self._app_ref._sync_sessions(create_if_empty=True)
        except Exception as exc:
            self._app_ref.notify(f"Delete failed: {exc}", severity="error")
            return
        self._selected_index = max(0, min(self._selected_index, len(self._app_ref.config.sessions) - 1))
        self._refresh_body(self.query_one("#sessions-search", Input).value)
        self._app_ref.notify(f"Deleted session: {chosen.title}")

    async def action_rename_session(self) -> None:
        items = self._filtered_sessions(self.query_one("#sessions-search", Input).value)
        if not items:
            return
        chosen = items[self._selected_index]
        try:
            await self._app_ref.run_worker(
                lambda: self._app_ref.session_api.update_session(chosen.id, {"title": f"{chosen.title} (renamed)"}),
                thread=True,
            )
            await self._app_ref._sync_sessions(create_if_empty=False)
        except Exception as exc:
            self._app_ref.notify(f"Rename failed: {exc}", severity="error")
            return
        self._refresh_body(self.query_one("#sessions-search", Input).value)
        self._app_ref.notify(f"Renamed session: {chosen.title}")

    def action_dismiss_palette(self) -> None:
        self.dismiss(None)


class ModelPaletteModal(ModalScreen[None]):
    CSS = CommandPaletteModal.CSS

    BINDINGS = [
        ("escape", "dismiss_palette", "Close"),
        ("enter", "submit_choice", "Choose"),
        ("up", "cursor_up", "Up"),
        ("down", "cursor_down", "Down"),
    ]

    def __init__(self, app: "MyOpenClawTextualApp") -> None:
        super().__init__()
        self._app_ref = app
        self._selected_index = 0
        # 模型列表合并策略：
        # 1. 默认硬编码列表（保留原有 OpenCode Zen 免费模型）
        # 2. 合并 AppConfig.MODEL_CYCLE（用户可轮换的模型）
        # 3. 合并当前 config.model（确保当前使用的模型可见且可重新选中）
        # 4. 用 model_display_name 获取友好显示名，避免硬编码显示名与服务端配置脱钩
        from .config import MODEL_DISPLAY_NAMES, model_display_name
        base_models: list[tuple[str, str, str, str]] = [
            ("deepseek-v4-flash", "DeepSeek V4 Flash Free OpenCode Zen", "Free", "Recent"),
            ("mimo-v2-5", "MiMo V2.5 Free OpenCode Zen", "Free", "Recent"),
            ("hy3", "Hy3 Free OpenCode Zen", "Free", "Recent"),
            ("big-pickle", "Big Pickle OpenCode Zen", "Free", "Recent"),
            ("north-mini-code", "North Mini Code Free", "Free", "OpenCode Zen"),
            ("nemotron-3-ultra", "Nemotron 3 Ultra Free", "Free", "OpenCode Zen"),
        ]
        seen_ids: set[str] = {model_id for model_id, _, _, _ in base_models}
        # 合并 MODEL_CYCLE 中未在硬编码列表的模型
        for model_id in app.MODEL_CYCLE:
            if model_id not in seen_ids:
                base_models.append((
                    model_id,
                    model_display_name(model_id),
                    "Configured",
                    "Current Config",
                ))
                seen_ids.add(model_id)
        # 合并当前 config.model（确保当前模型可见）
        current_model = app.config.model
        if current_model and current_model not in seen_ids:
            base_models.append((
                current_model,
                model_display_name(current_model),
                "Active",
                "Current Config",
            ))
            seen_ids.add(current_model)
        self._models = base_models

    def _filtered_models(self, query: str) -> list[tuple[str, str, str, str]]:
        q = query.strip().lower()
        if not q:
            return list(self._models)
        return [model for model in self._models if q in model[0].lower() or q in model[1].lower() or q in model[3].lower()]

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Static("[bold white]Select model[/]                                 [dim]esc[/]", classes="palette-header")
            yield Input(placeholder="Search", id="model-search")
            yield Static("", id="model-body")
            yield Static("[bold white]Connect provider[/] [dim]ctrl+a[/]   [bold white]Favorite[/] [dim]ctrl+f[/]", classes="palette-hint")

    def on_mount(self) -> None:
        self._refresh_body("")
        self.query_one("#model-search", Input).focus()

    def on_input_changed(self, event: Input.Changed) -> None:
        if event.input.id == "model-search":
            self._selected_index = 0
            self._refresh_body(event.value)

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        # 焦点在 Search Input 上时 Enter 会触发 Input.Submitted，
        # BINDINGS 中的 enter 不会自动触发，需要手动桥接到 submit_choice
        if event.input.id == "model-search":
            event.stop()
            self.action_submit_choice()

    def _refresh_body(self, query: str) -> None:
        models = self._filtered_models(query)
        if self._selected_index >= len(models):
            self._selected_index = 0
        lines: list[str] = []
        current_group: str | None = None
        for index, (_model_id, name, price, group) in enumerate(models):
            if group != current_group:
                current_group = group
                lines.append(f"[bold #a78bfa]{group}[/]")
            is_current = _model_id == self._app_ref.config.model
            marker = "●" if is_current else " "
            if index == self._selected_index:
                lines.append(f"[black on #f7b07d]{marker} {name}  {price}[/]")
            else:
                lines.append(f"[bold white]{marker} {name}[/] [#8f8f8f]{price}[/]")
        if not models:
            lines.append("[dim]No models matched.[/]")
        self.query_one("#model-body", Static).update("\n".join(lines))

    def action_cursor_up(self) -> None:
        models = self._filtered_models(self.query_one("#model-search", Input).value)
        if not models:
            return
        self._selected_index = (self._selected_index - 1) % len(models)
        self._refresh_body(self.query_one("#model-search", Input).value)

    def action_cursor_down(self) -> None:
        models = self._filtered_models(self.query_one("#model-search", Input).value)
        if not models:
            return
        self._selected_index = (self._selected_index + 1) % len(models)
        self._refresh_body(self.query_one("#model-search", Input).value)

    def action_submit_choice(self) -> None:
        models = self._filtered_models(self.query_one("#model-search", Input).value)
        if not models:
            return
        model_id, model_name, _price, _group = models[self._selected_index]
        # 关键修复：同时更新 config.model 和 controller.model
        # controller.model 才是 chat.send payload 实际使用的字段，
        # 若只改 config 不改 controller，模型切换不会生效
        self._app_ref.config.model = model_id
        self._app_ref.controller.model = model_id
        # 持久化模型选择，跨重启保留
        self._app_ref._persist_state()
        # 在消息流中给出明确反馈（不依赖一闪而过的 toast）
        self._app_ref.controller.append_system_message(
            f"[已切换模型] {model_name} (id: {model_id})\n"
            f"后续对话将使用此模型"
        )
        self._app_ref.notify(f"Model selected: {model_name}")
        self._app_ref._refresh()
        self.dismiss(None)

    def action_dismiss_palette(self) -> None:
        self.dismiss(None)


class MyOpenClawTextualApp(App):
    CSS = """
    Screen { background: #07090b; color: #d8e1e8; }
    #root { height: 100%; }
    #launch-screen, #connecting-screen { height: 1fr; align: center middle; }
    #launch-card { width: 100%; align: center middle; content-align: center middle; }
    #launch-copy { width: 100%; content-align: center middle; text-align: center; }
    #launch-input { width: 52; border: tall #3b9ddd; margin-top: 1; }
    #connecting-card { width: 70; border: round #3b9ddd; padding: 2; content-align: center middle; }
    #chat-screen { height: 1fr; }
    #chat-main { height: 1fr; }
    #messages { border: round #3b9ddd; padding: 1; height: 1fr; }
    #sidebar { width: 36; border: round #64748b; padding: 1; }
    #composer-wrap { dock: bottom; height: auto; }
    #slash-panel { display: none; border-left: thick #4f83cc; border-right: thick #3a3a3a; background: #1f1f1f; color: #e5e7eb; padding: 0 1; margin-bottom: 0; max-height: 16; }
    #slash-panel.visible { display: block; }
    #chat-input { border: tall #3b9ddd; background: #202020; color: #f3f4f6; }
    #status { dock: bottom; height: 1; background: #111827; color: #94a3b8; }
    #help { border: round #fbbf24; padding: 1; height: auto; background: #111827; }
    .hidden { display: none; }
    """

    BINDINGS = [
        ("ctrl+c", "quit", "Quit"),
        ("q", "quit", "Quit"),
        Binding("tab", "cycle_focus", "Focus", priority=True),
        Binding("shift+tab", "cycle_work_mode", "Mode", priority=True),
        ("ctrl+m", "cycle_intensity", "Intensity"),
        ("ctrl+shift+m", "cycle_model", "Model"),
        Binding("ctrl+p", "open_command_palette", "Commands", priority=True),
        ("up", "slash_up", "Slash up"),
        ("down", "slash_down", "Slash down"),
        ("question_mark", "toggle_help", "Help"),
        ("escape", "escape", "Back"),
        ("r", "reconnect", "Reconnect"),
        ("c", "clear_chat", "Clear"),
        ("l", "load_history", "History"),
        ("g", "scroll_top", "Top"),
        ("G", "scroll_bottom", "Bottom"),
    ]

    INTENSITY_CYCLE = ["low", "medium", "high", "max"]
    MODEL_CYCLE = ["deepseek-v4-pro", "deepseek-v4-flash", "gpt-4o"]

    focus_area = reactive("input")
    mode: ViewMode = reactive("launch")

    def __init__(self, config: AppConfig, *, state_store: AppStateStore | None = None) -> None:
        super().__init__()
        self._state_store = state_store or AppStateStore()
        loaded_state = self._state_store.load_from_disk()
        if loaded_state is not None:
            loaded_state.merge_into(config)
            if loaded_state.focus_area in ("input", "messages", "sidebar"):
                self.focus_area = loaded_state.focus_area
        self.config = config
        self.session_api = SessionApiClient(config.gateway_url, config.token)
        # 工具/技能元数据查询客户端（与 SessionApiClient 共享同一 gateway_url 和 token）
        # Mock 模式下不创建客户端，避免无意义的 HTTP 请求
        self.tools_api: ToolsApiClient | None = None if config.mock else ToolsApiClient(config.gateway_url, config.token)
        # PPT 制作 API 客户端（仅非 Mock 模式创建）
        self.ppt_api: PptApiClient | None = None if config.mock else PptApiClient(config.gateway_url, config.token)
        self.client: BaseGatewayClient = MockGatewayClient() if config.mock else WebSocketGatewayClient(config.gateway_url, config.token)
        self.controller = ChatController(
            self.client.request,
            session_id=config.session_id,
            channel_id=config.channel_id,
            user_id=config.user_id,
            work_mode=config.work_mode,
            intensity=config.intensity,
            model=config.model,
        )
        self.selected_session = 0
        self.show_help = False
        self.pending_initial_message: str | None = None
        self.server_time_text = ""
        self.slash_visible = False
        self.slash_selection_index = 0
        self.slash_matches: list[SlashEntry] = []
        # 远程能力缓存（与 Web 端 useSkills 的缓存策略对齐）
        self._cached_remote_entries: list[SlashEntry] = []
        self._remote_cache_fetched_at_ms: int = 0
        self._remote_loading: bool = False
        self.client.on_event(self._on_gateway_event)

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with Vertical(id="root"):
            yield Static(HELP_TEXT, id="help", classes="hidden")
            with Middle(id="launch-screen"):
                with Center():
                    with Vertical(id="launch-card"):
                        yield LaunchPane(id="launch-copy")
                        with Center():
                            yield Input(placeholder="输入消息后按 Enter 开始对话...", id="launch-input")
            with Middle(id="connecting-screen", classes="hidden"):
                yield ConnectingPane(id="connecting-card")
            with Vertical(id="chat-screen", classes="hidden"):
                with Horizontal(id="chat-main"):
                    yield MessagePane(id="messages", highlight=True, markup=True)
                    yield SidebarPane(id="sidebar", markup=True)
                with Vertical(id="composer-wrap"):
                    yield Static("", id="slash-panel")
                    yield Input(placeholder="输入消息，输入 / 打开技能与工具，Enter 发送", id="chat-input")
            yield StatusPane(id="status")
        yield Footer()

    async def on_mount(self) -> None:
        await self._sync_sessions(create_if_empty=True)
        await self._sync_server_time()
        # 异步拉取远程工具/技能列表，不阻塞 UI 启动
        # 拉取失败时静默降级到本地命令，不影响主流程
        self._trigger_remote_capability_refresh()
        self._refresh()
        self.query_one("#launch-input", Input).focus()

    def _trigger_remote_capability_refresh(self) -> None:
        """触发远程能力刷新（非阻塞）

        在后台线程执行 HTTP 请求，避免阻塞 Textual 主事件循环。
        仅在非 Mock 模式且 tools_api 客户端可用时执行。
        """
        if not self.tools_api:
            return
        # 缓存未过期则跳过
        now_ms = int(time.time() * 1000)
        if (self._cached_remote_entries
                and now_ms - self._remote_cache_fetched_at_ms < _REMOTE_CAPABILITY_CACHE_TTL_MS):
            return
        if self._remote_loading:
            return
        self._remote_loading = True
        try:
            self.run_worker(self._load_remote_capabilities, thread=True)
        except Exception:
            # run_worker 在某些测试场景下可能不可用，静默降级
            self._remote_loading = False

    async def _load_remote_capabilities(self) -> None:
        """从服务端拉取工具/技能列表并缓存为 SlashEntry

        失败时保留旧缓存（与 Web 端 useSkills 的失败降级策略一致），
        不会清空已有数据，确保网络抖动不影响 Slash 面板可用性。
        """
        if not self.tools_api:
            return
        try:
            # run_worker 在线程中执行同步 HTTP 调用，避免阻塞事件循环
            # 返回的 Worker 对象通过 .wait() 获取最终结果
            tools_worker = self.run_worker(self.tools_api.list_tools, thread=True)
            skills_worker = self.run_worker(self.tools_api.list_skills, thread=True)
            tool_list = await tools_worker.wait()
            skill_list = await skills_worker.wait()
        except Exception:
            # 拉取失败：保留旧缓存，不动现有数据
            self._remote_loading = False
            return

        remote_entries: list[SlashEntry] = []
        for tool in tool_list:
            try:
                remote_entries.append(_tool_to_slash_entry(tool))
            except Exception:
                continue
        for skill in skill_list:
            try:
                remote_entries.append(_skill_to_slash_entry(skill))
            except Exception:
                continue

        self._cached_remote_entries = remote_entries
        self._remote_cache_fetched_at_ms = int(time.time() * 1000)
        self._remote_loading = False

    def _get_merged_slash_entries(self) -> list[SlashEntry]:
        """合并本地命令与远程工具/技能列表

        本地命令优先（用户熟悉的 /help /exit 等始终可用），
        远程条目追加在后面。如果远程缓存为空（未拉取或失败），
        仅返回本地命令，确保 Slash 面板始终可用。
        """
        merged = list(LOCAL_SLASH_ENTRIES)
        if self._cached_remote_entries:
            merged.extend(self._cached_remote_entries)
        return merged

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        text = event.value.strip()
        if not text:
            return
        if event.input.id == "launch-input":
            event.input.value = ""
            self.pending_initial_message = text
            await self._enter_chat(connect_first=True)
            return
        if event.input.id == "chat-input":
            if text.startswith("/"):
                handled = await self._handle_slash_submit(text)
                if handled:
                    return
            event.input.value = ""
            self._hide_slash_panel()
            await self._send_chat_message(text)

    def on_input_changed(self, event: Input.Changed) -> None:
        if event.input.id != "chat-input":
            return
        if event.value.startswith("/"):
            self._show_slash_panel(event.value)
        else:
            self._hide_slash_panel()

    def _filtered_slash_entries(self, value: str) -> list[SlashEntry]:
        """根据输入过滤 Slash 条目（本地命令 + 远程工具/技能合并列表）"""
        q = _query(value)
        merged = self._get_merged_slash_entries()
        if not q:
            return merged
        # 过滤维度：标题、分组、类型、摘要、插入文本、slash 命令、分类、触发词
        return [
            entry for entry in merged
            if q in entry.title.lower()
            or q in entry.group.lower()
            or q in entry.kind.lower()
            or q in entry.summary.lower()
            or q in entry.insert_text.lower()
            or q in entry.slash.lower()
            or q in entry.category.lower()
            or any(q in t.lower() for t in entry.triggers)
        ]

    def _show_slash_panel(self, value: str) -> None:
        """渲染 Slash 面板，展示工具/技能元数据

        渲染策略：
        - 左侧：slash 命令（等宽对齐）
        - 中间：标题（含分类后缀）
        - 右侧：风险等级 / 触发词 / 来源标识
        - 底部：当前输入、work_mode/model/intensity 状态、操作提示
        """
        panel = self.query_one("#slash-panel", Static)
        self.slash_matches = self._filtered_slash_entries(value)[:8]
        if self.slash_selection_index >= len(self.slash_matches):
            self.slash_selection_index = 0
        left_width = max((len(entry.slash) for entry in self.slash_matches), default=8) + 2
        lines: list[str] = []
        for idx, entry in enumerate(self.slash_matches):
            selected = idx == self.slash_selection_index
            left = entry.slash.ljust(left_width)
            # 构造右侧元数据标签：风险等级 + 来源 + 触发词
            meta_parts: list[str] = []
            if entry.risk:
                risk_color = {"low": "#6b7280", "medium": "#fb923c", "high": "#ef4444"}.get(entry.risk, "#6b7280")
                meta_parts.append(f"[{risk_color}]{entry.risk}[/]")
            if entry.source != "local":
                meta_parts.append(f"[#60a5fa]{entry.source}[/]")
            if entry.triggers:
                trigger_preview = ",".join(entry.triggers[:2])
                if len(entry.triggers) > 2:
                    trigger_preview += "…"
                meta_parts.append(f"[dim]{trigger_preview}[/]")
            meta_text = "  ".join(meta_parts)
            if selected:
                lines.append(f"[black on #f7b07d]{left}{entry.title}[/]  {meta_text}")
            else:
                lines.append(f"[bold white]{left}[/][#8f8f8f]{entry.title}[/]  {meta_text}")
        if not self.slash_matches:
            lines.append("[dim]/ No matching items[/]")
        lines.extend([
            "",
            f"[bold white]{value or '/'}[/][white]█[/]",
            "",
            f"[bold #60a5fa]{self.config.work_mode.title()}[/] [dim]·[/] [bold white]{model_display_name(self.config.model)}[/] [dim]·[/] [#f59e0b]{self.config.intensity}[/]",
            "[dim]↑↓ 选择  Enter 确认  Esc 关闭  Ctrl+P 命令面板[/]",
        ])
        panel.update("\n".join(lines))
        panel.set_class(True, "visible")
        self.slash_visible = True

    def _hide_slash_panel(self) -> None:
        panel = self.query_one("#slash-panel", Static)
        panel.update("")
        panel.set_class(False, "visible")
        self.slash_visible = False
        self.slash_selection_index = 0
        self.slash_matches = []

    async def _handle_slash_submit(self, text: str) -> bool:
        """处理 Slash 命令提交

        优先匹配当前面板选中的条目，其次在合并列表中查找精确匹配。
        本地命令（带 action）直接执行对应方法；
        远程工具/技能（无 action）将 insert_text 注入输入框，
        由用户补充参数后 Enter 发送，服务端解析 [调用工具:xxx] / [启用技能:xxx] 标记。
        """
        if self.slash_visible and self.slash_matches:
            selected = self.slash_matches[self.slash_selection_index]
            if text.strip() == selected.slash and selected.action:
                self._hide_slash_panel()
                await self._run_slash_action(selected)
                return True
            input_widget = self.query_one("#chat-input", Input)
            input_widget.value = selected.insert_text
            input_widget.cursor_position = len(selected.insert_text)
            self._show_slash_panel(selected.insert_text)
            return True
        # 在合并列表（本地 + 远程缓存）中查找精确匹配
        merged = self._get_merged_slash_entries()
        exact = next((entry for entry in merged if entry.insert_text.strip() == text.strip()), None)
        if exact is not None:
            if exact.action and text.strip() == exact.slash:
                self._hide_slash_panel()
                await self._run_slash_action(exact)
                return True
            input_widget = self.query_one("#chat-input", Input)
            input_widget.value = exact.insert_text
            input_widget.cursor_position = len(exact.insert_text)
            self._show_slash_panel(exact.insert_text)
            return True
        return False

    async def _run_slash_action(self, entry: SlashEntry) -> None:
        if not entry.action:
            return
        chat_input = self.query_one("#chat-input", Input)
        chat_input.value = ""
        method = getattr(self, f"action_{entry.action}", None)
        if callable(method):
            result = method()
            if hasattr(result, "__await__"):
                await result

    async def _run_command(self, command: Command) -> None:
        method = getattr(self, f"action_{command.action}", None)
        if callable(method):
            result = method()
            if hasattr(result, "__await__"):
                await result

    def _command_available(self, command: Command) -> bool:
        return command.is_available(self) if command.is_available else True

    def action_slash_up(self) -> None:
        if self.focused is not None and getattr(self.focused, "id", None) != "chat-input":
            return
        if not self.slash_visible or not self.slash_matches:
            return
        self.slash_selection_index = (self.slash_selection_index - 1) % len(self.slash_matches)
        self._show_slash_panel(self.query_one("#chat-input", Input).value)

    def action_slash_down(self) -> None:
        if self.focused is not None and getattr(self.focused, "id", None) != "chat-input":
            return
        if not self.slash_visible or not self.slash_matches:
            return
        self.slash_selection_index = (self.slash_selection_index + 1) % len(self.slash_matches)
        self._show_slash_panel(self.query_one("#chat-input", Input).value)

    async def action_reconnect(self) -> None:
        if self.mode == "launch":
            await self._enter_chat(connect_first=True)
            return
        await self.client.disconnect()
        await self._connect()
        self._refresh()

    async def action_clear_chat(self) -> None:
        # /new 命令：创建一个全新的会话并切换过去
        # 不是只清空本地消息，而是真正调用 API 创建新会话
        if self.mode != "chat":
            return
        if self.config.mock:
            # Mock 模式下没有真实 API，只清空本地状态
            self.controller.clear()
            self.controller.append_system_message("[新建会话] mock 模式下仅清空本地消息，未调用服务端 API")
            self._refresh()
            return
        try:
            # 调用服务器 API 创建新会话
            created = self.run_worker(
                lambda: self.session_api.create_session(
                    agent_id=self.config.agents[0].id if self.config.agents else 'jarvis',
                    channel_id=self.config.channel_id,
                    user_id=self.config.user_id,
                    title='New Session',
                ),
                thread=True,
            )
            new_session = await created.wait()
        except Exception as exc:
            self.notify(f"新建会话失败: {exc}", severity="error")
            self.controller.append_system_message(f"[新建会话失败] {exc}")
            self._refresh()
            return

        # 更新本地状态：切换到新会话
        from .config import SessionInfo
        self.config.sessions.insert(0, SessionInfo(new_session.session_id, new_session.title))
        self.config.session_id = new_session.session_id
        self.controller.session_id = new_session.session_id
        self.controller.state.active_session_id = new_session.session_id
        self.selected_session = 0
        # 清空消息列表，准备开始新对话
        self.controller.clear()
        # 关键：重新绑定 WebSocket 到新会话，否则服务器仍把事件路由到旧会话
        await self._rebind_session()
        # 在消息流中给出明确的视觉反馈（不依赖一闪而过的 toast）
        self.controller.append_system_message(
            f"[已新建会话] {new_session.title} (id: {new_session.session_id[:8]}...)\n"
            f"WebSocket 已重新绑定，可直接输入消息开始对话"
        )
        self._refresh()
        self.notify(f"已创建新会话: {new_session.title}")

    async def action_load_history(self) -> None:
        if self.mode == "chat" and (self.controller.state.has_more_history or not self.controller.state.messages):
            await self.controller.load_history(self.controller.state.loaded_history_count, 20)
            self._refresh()

    def action_cycle_work_mode(self) -> None:
        if self.mode == "chat" and not self.show_help:
            self.config.work_mode = "plan" if self.config.work_mode == "build" else "build"
            self.controller.work_mode = self.config.work_mode
            self._persist_state()
            self._refresh()

    def action_cycle_intensity(self) -> None:
        if self.mode == "chat" and not self.show_help:
            cycle = self.INTENSITY_CYCLE
            idx = cycle.index(self.config.intensity) if self.config.intensity in cycle else -1
            self.config.intensity = cycle[(idx + 1) % len(cycle)]
            self.controller.intensity = self.config.intensity
            self._persist_state()
            self._refresh()

    def action_cycle_model(self) -> None:
        if self.mode == "chat" and not self.show_help:
            cycle = self.MODEL_CYCLE
            idx = cycle.index(self.config.model) if self.config.model in cycle else -1
            new_model = cycle[(idx + 1) % len(cycle)]
            # 同步更新 config 和 controller，确保 chat.send payload 使用新模型
            self.config.model = new_model
            self.controller.model = new_model
            self._persist_state()
            self._refresh()

    def action_cycle_focus(self) -> None:
        if self.mode != "chat" or self.show_help:
            return
        order = ["input", "messages", "sidebar"]
        self.focus_area = order[(order.index(self.focus_area) + 1) % len(order)]
        if self.focus_area == "input":
            self.query_one("#chat-input", Input).focus()
        elif self.focus_area == "messages":
            self.query_one("#messages", MessagePane).focus()
        else:
            self.query_one("#sidebar", SidebarPane).focus()
        self._persist_state()
        self._refresh()

    def action_toggle_help(self) -> None:
        self.show_help = not self.show_help
        self.query_one("#help", Static).set_class(not self.show_help, "hidden")

    async def action_escape(self) -> None:
        if self.show_help:
            self.action_toggle_help()
            return
        if self.slash_visible:
            self._hide_slash_panel()
            return
        if self.mode == "launch":
            self.exit()
            return
        if self.mode == "connecting":
            self.mode = "launch"
            await self.client.disconnect()
            self._refresh()
            self.query_one("#launch-input", Input).focus()
            return
        if self.controller.state.active_stream:
            await self.controller.cancel_stream()
            self._refresh()
            return
        self.mode = "launch"
        await self.client.disconnect()
        self._refresh()
        self.query_one("#launch-input", Input).focus()

    def action_scroll_top(self) -> None:
        if self.mode == "chat":
            self.query_one("#messages", MessagePane).scroll_home(animate=False)

    def action_scroll_bottom(self) -> None:
        if self.mode == "chat":
            self.query_one("#messages", MessagePane).scroll_end(animate=False)

    def action_open_command_palette(self) -> None:
        self._hide_slash_panel()
        self.push_screen(CommandPaletteModal(self))

    def action_open_sessions_palette(self) -> None:
        self._hide_slash_panel()
        self.push_screen(SessionPaletteModal(self))

    def action_open_model_palette(self) -> None:
        self._hide_slash_panel()
        self.push_screen(ModelPaletteModal(self))

    async def _enter_chat(self, *, connect_first: bool) -> None:
        self.mode = "connecting" if connect_first else "chat"
        self._refresh()
        if connect_first:
            await self._connect()
        await self._sync_sessions(create_if_empty=True)
        self.mode = "chat"
        self.focus_area = "input"
        self._refresh()
        self.query_one("#chat-input", Input).focus()

        # 自动加载当前会话的历史消息
        if self.config.session_id:
            try:
                await self.controller.load_history(0, 20)
                self._refresh()
                self.query_one("#messages", MessagePane).scroll_end(animate=False)
            except Exception:
                pass  # 历史加载失败不阻断主流程

        if self.pending_initial_message:
            message = self.pending_initial_message
            self.pending_initial_message = None
            await self._send_chat_message(message)

    async def _send_chat_message(self, text: str) -> None:
        if self.client.connection_state != "connected":
            await self._connect()
        await self.controller.send_message(text)
        self._refresh()
        self.query_one("#messages", MessagePane).scroll_end(animate=False)

    async def _connect(self) -> None:
        try:
            await self.client.connect()
        except Exception as exc:  # noqa: BLE001
            if not self.config.mock:
                self.notify(f"Gateway unavailable, switching to mock mode: {exc}", severity="warning")
                self.client = MockGatewayClient()
                self.controller.request = self.client.request
                self.client.on_event(self._on_gateway_event)
                await self.client.connect()
            else:
                raise
        self.controller.request = self.client.request

        # 关键：连接建立后立即发送 session.bind，将 channelId/userId 绑定到 WebSocket 连接
        # 这样服务器才能通过 broadcastToChannel 将跨端会话变更事件广播到本端
        if not self.config.mock:
            try:
                await self.client.request("session.bind", {
                    "sessionId": self.config.session_id,
                    "channelId": self.config.channel_id,
                    "userId": self.config.user_id,
                })
            except Exception:
                pass

        await self._sync_sessions(create_if_empty=True)
        # 连接成功后刷新远程工具/技能能力，确保用户看到最新的服务端注册清单
        self._trigger_remote_capability_refresh()
        self._refresh()

    async def _rebind_session(self) -> None:
        """重新绑定 WebSocket 连接到当前 config.session_id

        新建/切换会话后必须调用，否则服务器仍认为本端绑定在旧会话上，
        导致 broadcastToSession 事件路由错乱，AI 回复无法到达本端。
        mock 模式下 session.bind 返回空字典，忽略即可。
        """
        if self.config.mock:
            return
        try:
            await self.client.request("session.bind", {
                "sessionId": self.config.session_id,
                "channelId": self.config.channel_id,
                "userId": self.config.user_id,
            }, 3.0)
        except Exception:
            # 绑定失败不阻断主流程，服务器已通过 broadcastToChannel 兜底
            pass

    async def _sync_sessions(self, *, create_if_empty: bool = False) -> None:
        if self.config.mock:
            return
        try:
            sessions = self.run_worker(
                lambda: self.session_api.list_sessions(
                    channel_id=self.config.channel_id,
                    user_id=self.config.user_id,
                    include_closed=False,
                ),
                thread=True,
            )
            result = await sessions.wait()
        except Exception:
            return

        if not result and create_if_empty:
            try:
                created = self.run_worker(
                    lambda: self.session_api.create_session(
                        agent_id=self.config.agents[0].id if self.config.agents else 'jarvis',
                        channel_id=self.config.channel_id,
                        user_id=self.config.user_id,
                        title='New Session',
                    ),
                    thread=True,
                )
                result = [await created.wait()]
            except Exception:
                result = []

        if not result:
            return

        self.config.sessions = [SessionInfo(item.session_id, item.title) for item in result]
        if not self.config.session_id or all(session.id != self.config.session_id for session in self.config.sessions):
            self.config.session_id = self.config.sessions[0].id
        self.controller.session_id = self.config.session_id
        self.controller.state.active_session_id = self.config.session_id
        self.selected_session = next((idx for idx, session in enumerate(self.config.sessions) if session.id == self.config.session_id), 0)

    def _on_gateway_event(self, event: EventMessage) -> None:
        try:
            self.call_from_thread(self._handle_gateway_event, event)
        except RuntimeError:
            self.call_later(self._handle_gateway_event, event)

    def _handle_gateway_event(self, event: EventMessage) -> None:
        # 跨端会话同步：处理服务器推送的 session.* 事件
        # 其他端创建/修改/删除会话时，本端实时更新本地会话列表
        event_name = event.event
        if event_name == 'session.created':
            self._handle_session_created_event(event.payload)
            return
        if event_name == 'session.updated':
            self._handle_session_updated_event(event.payload)
            return
        if event_name == 'session.deleted':
            self._handle_session_deleted_event(event.payload)
            return

        # 默认：交给聊天控制器处理 chat.* 事件
        self.controller.handle_event(event.event, event.payload)
        self._refresh()
        try:
            self.query_one("#messages", MessagePane).scroll_end(animate=False)
        except Exception:
            pass

    def _handle_session_created_event(self, payload: dict) -> None:
        """处理 session.created 事件：其他端新建会话时同步到本端"""
        session = payload.get('session') if isinstance(payload, dict) else None
        if not session or not isinstance(session, dict):
            return
        session_id = session.get('sessionId') or session.get('session_id')
        if not session_id:
            return
        # 避免重复添加
        existing = next((s for s in self.config.sessions if s.id == session_id), None)
        title = session.get('title') or 'New Session'
        if existing:
            existing.title = title
        else:
            # SessionInfo 定义在 .config 模块中，与初始化会话列表保持一致
            from .config import SessionInfo
            self.config.sessions.append(SessionInfo(session_id, title))
        self._refresh()

    def _handle_session_updated_event(self, payload: dict) -> None:
        """处理 session.updated 事件：其他端修改标题/置顶时同步到本端"""
        session = payload.get('session') if isinstance(payload, dict) else None
        if not session or not isinstance(session, dict):
            return
        session_id = session.get('sessionId') or session.get('session_id')
        if not session_id:
            return
        existing = next((s for s in self.config.sessions if s.id == session_id), None)
        if existing:
            title = session.get('title')
            if title:
                existing.title = title
            self._refresh()

    def _handle_session_deleted_event(self, payload: dict) -> None:
        """处理 session.deleted 事件：其他端删除会话时从本端移除"""
        if not isinstance(payload, dict):
            return
        session_id = payload.get('sessionId') or payload.get('session_id')
        if not session_id:
            return
        # 从本地列表移除
        self.config.sessions = [s for s in self.config.sessions if s.id != session_id]
        # 如果删除的是当前会话，切换到第一个
        if self.config.session_id == session_id:
            if self.config.sessions:
                self.config.session_id = self.config.sessions[0].id
                self.controller.session_id = self.config.session_id
                self.controller.state.active_session_id = self.config.session_id
                self.selected_session = 0
            else:
                self.config.session_id = ''
                self.controller.session_id = ''
                self.controller.state.active_session_id = None
        self._refresh()

    def _refresh(self) -> None:
        try:
            self.query_one("#launch-screen", Middle).set_class(self.mode != "launch", "hidden")
            self.query_one("#connecting-screen", Middle).set_class(self.mode != "connecting", "hidden")
            self.query_one("#chat-screen", Vertical).set_class(self.mode != "chat", "hidden")
            self.query_one("#launch-copy", LaunchPane).update_launch(self.config, self.client)
            self.query_one("#connecting-card", ConnectingPane).update_connecting(self.config, self.client)
            self.query_one("#messages", MessagePane).render_state(self.controller)
            self.query_one("#sidebar", SidebarPane).update_sidebar(self.config, self.client, self.controller, self.selected_session)
            self.query_one("#status", StatusPane).update_status(self.config, self.client, self.controller, self.focus_area, self.mode, self.server_time_text)
        except Exception:
            pass

    async def _sync_server_time(self) -> None:
        try:
            data = self.run_worker(lambda: self.session_api.get_server_time(), thread=True)
            result = await data.wait()
            payload = result() if callable(result) else result
            if isinstance(payload, dict):
                timestamp = payload.get("serverTimestamp")
                if isinstance(timestamp, (int, float)):
                    import datetime as _dt
                    self.server_time_text = _dt.datetime.fromtimestamp(timestamp / 1000).strftime("%Y-%m-%d %H:%M:%S")
                    return
                server_time = payload.get("serverTime")
                if isinstance(server_time, str) and server_time:
                    self.server_time_text = server_time.replace("T", " ").replace("Z", "")
                    return
        except Exception:
            pass

    def _persist_state(self) -> bool:
        try:
            state = AppState(
                work_mode=self.config.work_mode,
                intensity=self.config.intensity,
                model=self.config.model,
                focus_area=self.focus_area,
            )
            return self._state_store.save_to_disk(state)
        except Exception:
            return False


def run_app(config: AppConfig) -> None:
    if App is object:  # pragma: no cover
        raise SystemExit("Textual is not installed. Run: python -m pip install -e clients/tui_python")
    MyOpenClawTextualApp(config).run()
