from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass(slots=True)
class SessionInfo:
    id: str
    title: str


@dataclass(slots=True)
class AgentInfo:
    id: str
    name: str
    enabled: bool = True
    model: str = "deepseek-v4-pro"
    status: str = "idle"


@dataclass(slots=True)
class AppConfig:
    gateway_url: str = "ws://127.0.0.1:18780/ws"
    token: str | None = None
    session_id: str = ""
    channel_id: str = "myopenclaw"
    user_id: str = "shared-user"
    mock: bool = False
    context_window: int = 128_000
    context_used: int = 0
    spent: int = 0
    cwd: str = "~/Desktop/myopenclaw"
    cli_version: str = "Python TUI 1.0.0"
    provider: str = "gateway"
    model: str = "deepseek-v4-pro"
    work_mode: str = "build"   # WorkMode: "plan" | "build"
    intensity: str = "max"     # Intensity: "low" | "medium" | "high" | "max"
    sessions: list[SessionInfo] = field(default_factory=lambda: [
        SessionInfo("", "New Session"),
    ])
    agents: list[AgentInfo] = field(default_factory=lambda: [AgentInfo("default", "default")])

    @classmethod
    def from_env(cls) -> "AppConfig":
        return cls(
            gateway_url=os.getenv("TUI_GATEWAY_URL", "ws://127.0.0.1:18780/ws"),
            token=os.getenv("TUI_TOKEN") or None,
            session_id=os.getenv("TUI_SESSION_ID", ""),
            channel_id=os.getenv("TUI_CHANNEL_ID", "myopenclaw"),
            user_id=os.getenv("TUI_USER_ID", "shared-user"),
            mock=os.getenv("TUI_MOCK", "false").lower() in {"1", "true", "yes", "on"},
        )


# ----------------------------------------------------------------------
# 持久化用户偏好: 跨重启保留 work_mode / intensity / model / focus_area
# ----------------------------------------------------------------------

# 允许写入 state 的字段(白名单, 防止 config 里其他字段被误序列化)
_PERSIST_KEYS: tuple[str, ...] = ("work_mode", "intensity", "model", "focus_area")


# ----------------------------------------------------------------------
# Model 显示名映射: 内部 id (e.g. "gpt-4o") -> 人类可读 (e.g. "GPT-4o")
# 找不到时回退到 _format_model_id_default (.title() + 去连字符)
# ----------------------------------------------------------------------

MODEL_DISPLAY_NAMES: dict[str, str] = {
    "deepseek-v4-pro": "DeepSeek V4 Pro",
    "deepseek-v4-flash": "DeepSeek V4 Flash",
    "gpt-4o": "GPT-4o",
    "gpt-4o-mini": "GPT-4o mini",
    "claude-3-5-sonnet": "Claude 3.5 Sonnet",
    "claude-3-5-haiku": "Claude 3.5 Haiku",
}


def _format_model_id_default(model_id: str) -> str:
    """默认 model id 格式化: 'deepseek-v4-pro' -> 'Deepseek V4 Pro'.

    用于映射表未命中时, 至少给出个还过得去的 fallback.
    """
    if not model_id:
        return "Unknown"
    return model_id.replace("-", " ").title()


def model_display_name(model_id: str) -> str:
    """根据 model id 拿显示名. 优先查表, fallback 到 _format_model_id_default."""
    return MODEL_DISPLAY_NAMES.get(model_id) or _format_model_id_default(model_id)


@dataclass(slots=True)
class AppState:
    """需要跨进程保留的用户偏好子集."""

    work_mode: str = "build"
    intensity: str = "max"
    model: str = "deepseek-v4-pro"
    focus_area: str = "input"

    def merge_into(self, config: AppConfig) -> None:
        """把 state 覆盖到 config 上, 仅影响 PERSIST_KEYS."""
        config.work_mode = self.work_mode
        config.intensity = self.intensity
        config.model = self.model


class AppStateStore:
    """~/.myopenclaw/tui-state.json 的 load/save 封装, 失败一律走默认."""

    DEFAULT_PATH = Path.home() / ".myopenclaw" / "tui-state.json"

    def __init__(self, path: Path | None = None) -> None:
        self.path: Path = Path(path) if path is not None else self.DEFAULT_PATH

    def load_from_disk(self) -> AppState | None:
        """读盘 -> AppState | None.

        - 文件不存在 / 解析失败 / 数据非 dict / 所有字段都错类型 -> 返回 None
        - 至少有一个有效字段 -> 返回填充好的 AppState (未填字段用 dataclass 默认)
        """
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, OSError, json.JSONDecodeError):
            return None
        if not isinstance(data, dict):
            return None
        kwargs: dict[str, str] = {}
        for key in _PERSIST_KEYS:
            if key in data and isinstance(data[key], str):
                kwargs[key] = data[key]
        if not kwargs:
            return None
        return AppState(**kwargs)

    def save_to_disk(self, state: AppState) -> bool:
        """写盘, 任何错误返回 False(不抛). 成功 True."""
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            payload = {k: getattr(state, k) for k in _PERSIST_KEYS}
            self.path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
            return True
        except OSError:
            return False

    def to_config(self) -> AppState | None:
        """便捷方法: 直接返回当前 state, 给 app 启动时调用."""
        return self.load_from_disk()
