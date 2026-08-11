"""Command registry for slash commands and command palettes."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class Command:
    """A single command exposed in the TUI command surfaces."""

    name: str
    title: str
    action: str
    group: str = "General"
    keybinding: str = ""
    slash: str = ""
    subtitle: str = ""
    surface: str = "command"
    suggested: bool = False
    is_available: Callable[[Any], bool] | None = None


def _chat_only(app: Any) -> bool:
    return getattr(app, "mode", None) == "chat" and not getattr(app, "show_help", False)


def _always_available(_app: Any) -> bool:
    return True


DEFAULT_COMMANDS: list[Command] = [
    Command(
        name="session_switch",
        title="Open sessions",
        subtitle="Open the sessions list and jump between conversations",
        action="open_sessions_palette",
        group="Suggested",
        keybinding="Ctrl+X L",
        slash="/sessions",
        surface="session",
        suggested=True,
        is_available=_always_available,
    ),
    Command(
        name="model_select",
        title="Select model",
        subtitle="Choose the active model for the current chat",
        action="open_model_palette",
        group="Suggested",
        keybinding="Ctrl+X M",
        slash="/models",
        surface="model",
        suggested=True,
        is_available=_chat_only,
    ),
    Command(
        name="mode_toggle",
        title="Switch work mode",
        subtitle="Toggle between Build and Plan",
        action="cycle_work_mode",
        group="Mode",
        keybinding="Shift+Tab",
        slash="/mode",
        is_available=_chat_only,
    ),
    Command(
        name="intensity_cycle",
        title="Cycle intensity",
        subtitle="Switch among low, medium, high and max",
        action="cycle_intensity",
        group="Mode",
        keybinding="Ctrl+M",
        slash="/intensity",
        is_available=_chat_only,
    ),
    Command(
        name="model_cycle",
        title="Rotate model",
        subtitle="Quickly rotate through configured models",
        action="cycle_model",
        group="Mode",
        keybinding="Ctrl+Shift+M",
        slash="/model-next",
        is_available=_chat_only,
    ),
    Command(
        name="focus_next",
        title="Cycle focus",
        subtitle="Move focus between input, messages and sidebar",
        action="cycle_focus",
        group="Window",
        keybinding="Tab",
        slash="/focus",
        is_available=_chat_only,
    ),
    Command(
        name="toggle_help",
        title="Help",
        subtitle="Show or hide the keyboard help overlay",
        action="toggle_help",
        group="Window",
        keybinding="?",
        slash="/help",
        is_available=_always_available,
    ),
    Command(
        name="reconnect",
        title="Connect provider",
        subtitle="Reconnect the gateway or mock provider",
        action="reconnect",
        group="Chat",
        keybinding="R",
        slash="/connect",
        is_available=_always_available,
    ),
    Command(
        name="clear_chat",
        title="New session",
        subtitle="Clear the current transcript and start fresh",
        action="clear_chat",
        group="Session",
        keybinding="Ctrl+X N",
        slash="/new",
        is_available=_chat_only,
    ),
    Command(
        name="load_history",
        title="Load more history",
        subtitle="Request more saved messages for the current session",
        action="load_history",
        group="Session",
        keybinding="L",
        slash="/history",
        is_available=_chat_only,
    ),
    Command(
        name="scroll_top",
        title="Scroll to top",
        subtitle="Jump to the beginning of the message log",
        action="scroll_top",
        group="Chat",
        keybinding="G G",
        slash="/top",
        is_available=_chat_only,
    ),
    Command(
        name="scroll_bottom",
        title="Scroll to bottom",
        subtitle="Jump to the latest message",
        action="scroll_bottom",
        group="Chat",
        keybinding="G",
        slash="/bottom",
        is_available=_chat_only,
    ),
    Command(
        name="quit",
        title="Exit the app",
        subtitle="Close the TUI application",
        action="quit",
        group="App",
        keybinding="Q / Ctrl+C",
        slash="/exit",
        is_available=_always_available,
    ),
]
