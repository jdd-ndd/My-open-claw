from __future__ import annotations

import asyncio
import unittest

from tui_python.chat_state import ChatController
from tui_python.mock_gateway import MockGatewayClient
from tui_python.protocol import EventMessage, ResponseMessage, build_request, parse_gateway_message


class ProtocolTests(unittest.TestCase):
    def test_build_request_uses_action_payload_and_id(self) -> None:
        msg = build_request("chat.send", {"content": "hello"})
        data = msg.to_dict()
        self.assertEqual(data["type"], "request")
        self.assertEqual(data["action"], "chat.send")
        self.assertEqual(data["payload"], {"content": "hello"})
        self.assertTrue(data["id"])

    def test_parse_response_and_event(self) -> None:
        response = parse_gateway_message({
            "type": "response",
            "id": "r1",
            "requestId": "q1",
            "status": "success",
            "payload": {"ok": True},
        })
        event = parse_gateway_message({
            "type": "event",
            "id": "e1",
            "event": "chat.delta",
            "payload": {"delta": "x"},
        })
        self.assertIsInstance(response, ResponseMessage)
        self.assertEqual(response.request_id, "q1")
        self.assertIsInstance(event, EventMessage)
        self.assertEqual(event.event, "chat.delta")


class ChatControllerTests(unittest.IsolatedAsyncioTestCase):
    async def test_send_message_adds_user_and_active_stream(self) -> None:
        calls = []

        async def request(action, payload, timeout):
            calls.append((action, payload, timeout))
            return {"matched": True, "sessionId": "server-session", "agentId": "default"}

        controller = ChatController(request)
        await controller.send_message(" hello ")
        self.assertEqual(controller.state.messages[0].role, "user")
        self.assertEqual(controller.state.messages[0].content, "hello")
        self.assertIsNotNone(controller.state.active_stream)
        self.assertEqual(controller.state.active_session_id, "server-session")
        self.assertEqual(calls[0][0], "chat.send")

    async def test_send_failure_lands_system_error(self) -> None:
        async def request(action, payload, timeout):
            raise RuntimeError("boom")

        controller = ChatController(request)
        await controller.send_message("hello")
        self.assertIsNone(controller.state.active_stream)
        self.assertIn("boom", controller.state.last_error or "")
        self.assertEqual(controller.state.messages[-1].role, "system")

    async def test_history_is_prepended_and_counts_update(self) -> None:
        async def request(action, payload, timeout):
            return {
                "sessionId": "session-local",
                "messages": [{"messageId": "m1", "role": "assistant", "content": "old", "timestamp": 1}],
                "hasMore": True,
                "total": 3,
                "offset": 0,
                "limit": 1,
            }

        controller = ChatController(request)
        await controller.load_history(0, 1)
        self.assertEqual(controller.state.messages[0].content, "old")
        self.assertTrue(controller.state.has_more_history)
        self.assertEqual(controller.state.total_history_count, 3)
        self.assertEqual(controller.state.loaded_history_count, 1)

    def test_streaming_events_land_assistant_message(self) -> None:
        async def request(action, payload, timeout):
            return {}

        controller = ChatController(request)
        controller.handle_event("chat.delta", {"sessionId": "s", "delta": "he", "accumulated": "he"})
        controller.handle_event("chat.reasoning_delta", {"sessionId": "s", "delta": "think"})
        controller.handle_event("chat.done", {"sessionId": "s", "messageId": "a1", "totalContent": "hello"})
        self.assertEqual(controller.state.messages[-1].role, "assistant")
        self.assertEqual(controller.state.messages[-1].content, "hello")
        self.assertEqual(controller.state.messages[-1].reasoning, "think")
        self.assertIsNone(controller.state.active_stream)

    def test_reasoning_delta_does_not_create_final_message_too_early(self) -> None:
        async def request(action, payload, timeout):
            return {}

        controller = ChatController(request)
        controller.state.active_stream = type("Active", (), {"id": "s1", "time": "11:00", "prompt": "hi", "session_id": "s"})()
        controller.handle_event("chat.delta", {"sessionId": "s", "delta": "he", "accumulated": "he"})
        controller.handle_event("chat.reasoning_delta", {"sessionId": "s", "delta": "thinking"})
        self.assertEqual(len(controller.state.messages), 0)
        self.assertIsNotNone(controller.state.active_stream)

    def test_final_answer_embedded_in_reasoning_is_promoted(self) -> None:
        async def request(action, payload, timeout):
            return {}

        controller = ChatController(request)
        reasoning = "<thought>need a short greeting</thought>\n<final_answer>hello there</final_answer>"
        controller.handle_event("chat.reasoning_delta", {"sessionId": "s", "accumulated": reasoning})
        controller.handle_event("chat.done", {"sessionId": "s", "messageId": "a1", "totalContent": ""})
        self.assertEqual(controller.state.messages[-1].content, "hello there")
        self.assertEqual(controller.state.messages[-1].reasoning, "need a short greeting")

    def test_tagged_action_without_final_answer_gets_user_visible_fallback(self) -> None:
        async def request(action, payload, timeout):
            return {}

        controller = ChatController(request)
        raw = "<thought>try desktop write</thought><action name=\"exec/shell\" args='{\"command\":\"New-Item test.md\"}' />"
        controller.handle_event("chat.done", {"sessionId": "s", "messageId": "a1", "totalContent": raw})
        self.assertTrue(controller.state.messages[-1].content)
        self.assertNotEqual(controller.state.messages[-1].content, raw)
        self.assertIn("try desktop write", controller.state.messages[-1].reasoning or "")
        self.assertIn("exec/shell", controller.state.messages[-1].reasoning or "")

    def test_reasoning_only_tool_block_gets_user_visible_fallback(self) -> None:
        async def request(action, payload, timeout):
            return {}

        controller = ChatController(request)
        reasoning = "try shell command\n<action name=\"exec/shell\" args='{\"command\":\"echo hi\"}' />"
        controller.handle_event("chat.reasoning_delta", {"sessionId": "s", "accumulated": reasoning})
        controller.handle_event("chat.done", {"sessionId": "s", "messageId": "a1", "totalContent": ""})
        self.assertTrue(controller.state.messages[-1].content)
        self.assertIn("try shell command", controller.state.messages[-1].reasoning or "")

    def test_tagged_content_with_final_answer_hides_scratchpad(self) -> None:
        async def request(action, payload, timeout):
            return {}

        controller = ChatController(request)
        raw = "<thought>tool worked</thought><action name=\"exec/shell\" args='{}' /><final_answer>created test1.txt</final_answer>"
        controller.handle_event("chat.done", {"sessionId": "s", "messageId": "a1", "totalContent": raw})
        self.assertEqual(controller.state.messages[-1].content, "created test1.txt")
        self.assertNotIn("<thought>", controller.state.messages[-1].content)
        self.assertIn("tool worked", controller.state.messages[-1].reasoning or "")

    def test_action_fragment_is_hidden_from_visible_reply(self) -> None:
        async def request(action, payload, timeout):
            return {}

        controller = ChatController(request)
        raw = "\"%USERPROFILE%\\Desktop\\test.txt\\\"\"','timeout':10000}' />"
        controller.handle_event("chat.done", {"sessionId": "s", "messageId": "a1", "totalContent": raw})
        self.assertTrue(controller.state.messages[-1].content)
        self.assertIn("%USERPROFILE%", controller.state.messages[-1].content)

    def test_chat_error_creates_system_message(self) -> None:
        async def request(action, payload, timeout):
            return {}

        controller = ChatController(request)
        controller.handle_event("chat.error", {"sessionId": "s", "code": "AGENT_ERROR", "message": "boom"})
        self.assertEqual(controller.state.messages[-1].role, "system")
        self.assertIn("boom", controller.state.messages[-1].content)

    async def test_cancel_sends_cancel_and_clears_stream(self) -> None:
        calls = []

        async def request(action, payload, timeout):
            calls.append(action)
            return {"matched": True}

        controller = ChatController(request)
        await controller.send_message("hello")
        await controller.cancel_stream()
        self.assertIn("chat.cancel", calls)
        self.assertIsNone(controller.state.active_stream)


class MockGatewayTests(unittest.IsolatedAsyncioTestCase):
    async def test_mock_gateway_streams_done_event(self) -> None:
        client = MockGatewayClient(delay=0)
        events = []
        client.on_event(lambda event: events.append(event.event))
        await client.connect()
        response = await client.request("chat.send", {"sessionId": "s", "content": "hello"}, 1)
        await asyncio.sleep(0.05)
        self.assertTrue(response["matched"])
        self.assertIn("chat.delta", events)
        self.assertIn("chat.done", events)


if __name__ == "__main__":
    unittest.main()
