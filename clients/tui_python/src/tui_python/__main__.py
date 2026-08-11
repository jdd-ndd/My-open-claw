from __future__ import annotations

import argparse

from .app import run_app
from .config import AppConfig


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="MyOpenClaw Python/Textual TUI")
    parser.add_argument("--gateway", dest="gateway_url", help="Gateway WebSocket URL")
    parser.add_argument("--token", dest="token", help="Gateway token")
    parser.add_argument("--session", dest="session_id", help="Default session id")
    parser.add_argument("--channel", dest="channel_id", help="Channel id")
    parser.add_argument("--user", dest="user_id", help="User id")
    parser.add_argument("--mock", action="store_true", help="Use built-in mock Gateway")
    return parser


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    config = AppConfig.from_env()
    if args.gateway_url:
        config.gateway_url = args.gateway_url
    if args.token:
        config.token = args.token
    if args.session_id:
        config.session_id = args.session_id
    if args.channel_id:
        config.channel_id = args.channel_id
    if args.user_id:
        config.user_id = args.user_id
    if args.mock:
        config.mock = True
    run_app(config)


if __name__ == "__main__":
    main()
