# Existing TUI Functional Analysis

Source folder: `D:\模板\My open claw\clients\tui`

## Architecture

The existing TUI is an Ink/React terminal client. Its main runtime path is:

`src/main.ts -> components/App.tsx -> hooks/useWebSocket.ts + hooks/useChat.ts -> chat/sidebar/statusbar components`

The application is organized into these functional areas:

- Entry/runtime: alternate-screen setup, raw input setup, mouse tracking setup, graceful terminal cleanup.
- App shell: launch screen, connecting screen, chat screen, help overlay, reconnect prompt, global keyboard routing.
- Gateway protocol: WebSocket connection, request/response correlation, event subscription, heartbeat, reconnect.
- Chat state: optimistic user messages, active stream placeholder, delta accumulation, reasoning accumulation, final message landing, error messages, cancellation, history pagination.
- Chat UI: message list, virtual line scrolling, sticky-bottom behavior, reasoning fold/expand, streaming bubble, input history, cursor movement.
- Sidebar/status: connection state, system info, agent list, session list, status bar, focus hint, provider/model display.
- Utilities: keyboard filtering, colors, formatting, terminal size, mouse parsing.

## User Flows

- Launch flow: user types the first message on the launch screen and presses Enter. The app switches to connecting mode, opens WebSocket, then enters chat mode and sends the initial message once.
- Chat send flow: input Enter adds the user message immediately, starts an active stream, sends `chat.send`, waits for response, then listens for `chat.*` events.
- Streaming flow: `chat.delta` updates visible assistant content; `chat.reasoning_delta` updates visible reasoning; `chat.done` creates the final assistant message; `chat.error` creates a system error and ends the stream.
- History flow: `chat.history` returns paginated history. The UI prepends history when loading more.
- Cancel flow: Esc while streaming clears the active stream and sends `chat.cancel` best-effort.
- Navigation flow: Tab cycles input -> messages -> sidebar -> input; sidebar arrows select static sessions; message focus supports scroll and reasoning toggling.
- Recovery flow: disconnected state either falls back to mock mode or shows reconnect controls.

## Improvements In Python Version

- Protocol and chat state are framework-independent and unit-testable.
- UI-specific code is isolated in `app.py`.
- The mock Gateway is explicit and reusable in tests.
- Configuration is centralized and supports CLI flags plus environment variables.
- Error handling is normalized through system messages and `last_error`.
- The implementation avoids committed Node artifacts and mixed npm/pnpm lock files.

## Known Source Issues Addressed

- Several source comments and UI strings in the original folder are mojibake. The Python version uses clean UTF-8 text.
- The original TUI keeps static session/agent/sidebar data. The Python implementation preserves those defaults but isolates them in `config.py`, making them easy to replace with real Gateway API data later.
- The original request flow can fail if WebSocket dependencies are unavailable. The Python version supports explicit mock mode and clear dependency errors.
