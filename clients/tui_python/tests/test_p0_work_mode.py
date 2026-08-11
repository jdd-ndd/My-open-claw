"""P0 最小闭环验证：work_mode / intensity 是否贯穿 controller + mock gateway."""
from __future__ import annotations

import asyncio
import unittest

from tui_python.chat_state import ChatController
from tui_python.mock_gateway import MockGatewayClient


class WorkModePayloadTests(unittest.IsolatedAsyncioTestCase):
    async def test_default_work_mode_is_build_and_intensity_max(self) -> None:
        captured: list[tuple[str, dict]] = []

        async def request(action, payload, timeout):
            captured.append((action, payload))
            return {"matched": True, "sessionId": "s1"}

        controller = ChatController(request)
        await controller.send_message("ping")
        self.assertEqual(controller.work_mode, "build")
        self.assertEqual(controller.intensity, "max")
        _, payload = captured[0]
        self.assertEqual(payload["workMode"], "build")
        self.assertEqual(payload["intensity"], "max")

    async def test_cycling_work_mode_updates_payload(self) -> None:
        captured: list[dict] = []

        async def request(action, payload, timeout):
            captured.append(payload)
            return {"matched": True, "sessionId": "s1"}

        controller = ChatController(request, work_mode="build", intensity="max")
        # 模拟用户在 app 中按 Shift+Tab: app 层会同时改 config 和 controller.work_mode
        controller.work_mode = "plan"
        await controller.send_message("ping")
        self.assertEqual(captured[-1]["workMode"], "plan")
        self.assertEqual(captured[-1]["intensity"], "max")

    async def test_mock_gateway_echoes_work_mode_and_intensity(self) -> None:
        client = MockGatewayClient(delay=0)
        events: list[tuple[str, dict]] = []
        client.on_event(lambda event: events.append((event.event, event.payload)))
        await client.connect()
        await client.request(
            "chat.send",
            {
                "sessionId": "s1",
                "content": "ping",
                "workMode": "plan",
                "intensity": "high",
            },
            1,
        )
        # 等异步 stream 跑完
        for _ in range(50):
            await asyncio.sleep(0.01)
            if any(e[0] == "chat.done" for e in events):
                break
        done_events = [e for e in events if e[0] == "chat.done"]
        self.assertTrue(done_events, "mock should emit chat.done with mode echo")
        total = done_events[-1][1].get("totalContent", "")
        self.assertIn("workMode=plan", total)
        self.assertIn("intensity=high", total)


if __name__ == "__main__":
    unittest.main()
