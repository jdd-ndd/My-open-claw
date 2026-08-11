# MyOpenClaw Python TUI

`clients/tui_python` is a Python/Textual implementation of the existing Ink/React TUI in `clients/tui`.

It keeps the same product behavior:

- Launch screen with first-message entry.
- Gateway connection state: disconnected, connecting, connected, reconnecting.
- Chat request flow using `chat.send`.
- Streaming events: `chat.delta`, `chat.reasoning_delta`, `chat.done`, `chat.error`.
- Message history loading through `chat.history`.
- Cancel generation through `chat.cancel`.
- Keyboard-oriented navigation, help, status display, sidebar state, error messages, and mock fallback.
- Core state and protocol logic separated from the Textual UI for easier testing and maintenance.

## Run

Install dependencies in a Python environment:

```powershell
python -m pip install -e clients/tui_python
```

Run against the local Gateway:

```powershell
myopenclaw-tui --gateway ws://127.0.0.1:18780/ws
```

Run without Gateway using the built-in mock stream:

```powershell
myopenclaw-tui --mock
```

With the bundled Codex Python runtime, replace `python` with the runtime path shown by Codex if your system PATH does not contain Python.

## Configuration

Environment variables mirror the TypeScript TUI defaults:

- `TUI_GATEWAY_URL`: WebSocket endpoint, default `ws://127.0.0.1:18780/ws`.
- `TUI_TOKEN`: optional Gateway token.
- `TUI_SESSION_ID`: default session id, default `session-local`.
- `TUI_CHANNEL_ID`: default `tui`.
- `TUI_USER_ID`: default `tui-user`.
- `TUI_MOCK`: set to `true` to force mock mode.

## Keyboard

- `Enter`: send message from input.
- `Tab`: cycle focus between input, messages, and sidebar.
- `?`: open or close help.
- `Esc`: close help, cancel active stream, or return to launch.
- `Ctrl+C` or `q`: quit.
- `r`: reconnect.
- `c`: clear chat messages.
- `l`: load more history.

## Tests

The unit tests cover protocol messages, chat state transitions, history loading, error handling, cancellation, and mock streaming behavior. They intentionally avoid importing Textual so the core can be verified even before UI dependencies are installed.

```powershell
python -m unittest discover clients/tui_python/tests
```
