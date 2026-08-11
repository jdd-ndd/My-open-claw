"""TUI Python 端 PPT API 客户端单元测试

对照 test_tools_api.py 风格：
1. mock urlopen 模拟服务端响应
2. 验证 PptSpec 数据组装与 PPT 二进制返回
3. 验证错误路径（HTTP / 网络）
"""
from __future__ import annotations

import unittest
from unittest.mock import patch, MagicMock
from urllib.error import HTTPError, URLError

from tui_python.ppt_api import PptApiClient, PptSpec, ThemeMeta, TemplateMeta


class PptApiClientTests(unittest.TestCase):
    """PptApiClient 单元测试"""

    def _make_response(self, body: bytes) -> MagicMock:
        """构造 mock response with context manager support"""
        mock = MagicMock()
        mock.read.return_value = body
        mock.__enter__ = MagicMock(return_value=mock)
        mock.__exit__ = MagicMock(return_value=False)
        return mock

    def test_http_base_from_ws(self) -> None:
        """ws URL 转换为 http base"""
        client = PptApiClient("ws://127.0.0.1:18780/ws")
        self.assertEqual(client.base_url, "http://127.0.0.1:18780")

    def test_list_themes_parses_response(self) -> None:
        """list_themes 解析响应"""
        body = b'{"ok": true, "data": {"total": 2, "themes": [{"id": "warm-kitchen", "name": "Warm Kitchen", "primary": "B85042", "secondary": "E7E8D1", "accent": "A7BEAE", "headerFont": "Georgia", "bodyFont": "Calibri"}, {"id": "midnight-executive", "name": "Midnight", "primary": "1E2761", "secondary": "CADCFC", "accent": "FFFFFF", "headerFont": "Arial Black", "bodyFont": "Arial"}]}}'
        with patch("tui_python.ppt_api.urlopen", return_value=self._make_response(body)):
            client = PptApiClient("ws://127.0.0.1:18780/ws")
            themes = client.list_themes()
        self.assertEqual(len(themes), 2)
        self.assertEqual(themes[0].id, "warm-kitchen")
        self.assertEqual(themes[0].primary, "B85042")
        self.assertEqual(themes[0].header_font, "Georgia")
        self.assertIsInstance(themes[0], ThemeMeta)

    def test_list_templates_parses_response(self) -> None:
        """list_templates 解析响应"""
        body = b'{"ok": true, "data": {"total": 1, "templates": [{"id": "cover-classic", "type": "cover", "name": "Cover", "description": "Main color background", "schema": {"title": "string"}}]}}'
        with patch("tui_python.ppt_api.urlopen", return_value=self._make_response(body)):
            client = PptApiClient("ws://127.0.0.1:18780/ws")
            templates = client.list_templates()
        self.assertEqual(len(templates), 1)
        self.assertEqual(templates[0].type, "cover")
        self.assertEqual(templates[0].schema, {"title": "string"})
        self.assertIsInstance(templates[0], TemplateMeta)

    def test_list_themes_invalid_data_returns_empty(self) -> None:
        """data 字段非法时返回空列表"""
        body = b'{"ok": true, "data": "not a dict"}'
        with patch("tui_python.ppt_api.urlopen", return_value=self._make_response(body)):
            client = PptApiClient("ws://127.0.0.1:18780/ws")
            themes = client.list_themes()
        self.assertEqual(themes, [])

    def test_make_returns_binary(self) -> None:
        """make 返回 PPTX 二进制"""
        pptx_bytes = b"\x50\x4b\x03\x04" + b"\x00" * 100  # ZIP magic + content
        with patch("tui_python.ppt_api.urlopen", return_value=self._make_response(pptx_bytes)) as mock:
            client = PptApiClient("ws://127.0.0.1:18780/ws")
            result = client.make(PptSpec(theme="warm-kitchen", slides=[{"template": "cover", "title": "x", "data": {}}]))
        self.assertEqual(result, pptx_bytes)
        # 验证请求方法与路径
        self.assertEqual(mock.call_count, 1)
        # 验证请求 URL 包含 /api/ppt/make
        called_args = mock.call_args[0]
        self.assertIn("/api/ppt/make", called_args[0].full_url)

    def test_make_without_filename(self) -> None:
        """make 不传 filename 时组装 payload 也不含 filename"""
        with patch("tui_python.ppt_api.urlopen", return_value=self._make_response(b"x")) as mock:
            client = PptApiClient("ws://127.0.0.1:18780/ws")
            client.make(PptSpec(theme="warm-kitchen", slides=[{"template": "cover", "title": "x", "data": {}}]))
        req = mock.call_args[0][0]
        import json as _json
        body = _json.loads(req.data.decode("utf-8"))
        self.assertNotIn("filename", body)

    def test_make_with_filename(self) -> None:
        """make 传 filename 时 payload 含 filename"""
        with patch("tui_python.ppt_api.urlopen", return_value=self._make_response(b"x")) as mock:
            client = PptApiClient("ws://127.0.0.1:18780/ws")
            client.make(PptSpec(theme="warm-kitchen", slides=[{"template": "cover", "title": "x", "data": {}}], filename="my-ppt"))
        req = mock.call_args[0][0]
        import json as _json
        body = _json.loads(req.data.decode("utf-8"))
        self.assertEqual(body["filename"], "my-ppt")

    def test_make_http_error_raises(self) -> None:
        """HTTP 错误时抛 RuntimeError"""
        mock_resp = MagicMock()
        mock_resp.read.return_value = b'{"ok": false, "error": {"code": "PPT_INVALID_SPEC", "message": "slides empty"}}'
        error = HTTPError("http://x", 400, "Bad Request", {}, mock_resp)
        with patch("tui_python.ppt_api.urlopen", side_effect=error):
            client = PptApiClient("ws://127.0.0.1:18780/ws")
            with self.assertRaises(RuntimeError) as ctx:
                client.make(PptSpec(theme="warm-kitchen", slides=[]))
        self.assertIn("400", str(ctx.exception))
        self.assertIn("PPT_INVALID_SPEC", str(ctx.exception))

    def test_make_url_error_raises(self) -> None:
        """网络错误时抛 RuntimeError"""
        with patch("tui_python.ppt_api.urlopen", side_effect=URLError("connection refused")):
            client = PptApiClient("ws://127.0.0.1:18780/ws")
            with self.assertRaises(RuntimeError) as ctx:
                client.make(PptSpec(theme="warm-kitchen", slides=[{"template": "cover", "title": "x", "data": {}}]))
        self.assertIn("不可达", str(ctx.exception))

    def test_token_passed_in_header(self) -> None:
        """token 存在时附带 Authorization 头"""
        captured: list = []

        def fake_urlopen(req, timeout=None):
            captured.append(req)
            mock = MagicMock()
            mock.read.return_value = b'{"ok": true, "data": {"themes": []}}'
            mock.__enter__ = MagicMock(return_value=mock)
            mock.__exit__ = MagicMock(return_value=False)
            return mock

        with patch("tui_python.ppt_api.urlopen", side_effect=fake_urlopen):
            client = PptApiClient("ws://127.0.0.1:18780/ws", token="t123")
            client.list_themes()
        self.assertEqual(captured[0].headers.get("Authorization"), "Bearer t123")


class PptApiClientIntegrationTests(unittest.TestCase):
    """集成测试：模拟完整的远程能力发现 + PPT 调用流程"""

    def _make_response(self, body: bytes) -> MagicMock:
        """构造 mock response with context manager support"""
        mock = MagicMock()
        mock.read.return_value = body
        mock.__enter__ = MagicMock(return_value=mock)
        mock.__exit__ = MagicMock(return_value=False)
        return mock

    def test_end_to_end_ppt_workflow(self) -> None:
        """完整工作流：列主题 → 列模板 → 生成 PPT"""
        from unittest.mock import patch

        # 1. 列主题
        themes_body = b'{"ok": true, "data": {"themes": [{"id": "warm-kitchen", "name": "Warm", "primary": "B85042", "secondary": "E7E8D1", "accent": "A7BEAE", "headerFont": "Georgia", "bodyFont": "Calibri"}]}}'
        # 2. 列模板
        templates_body = b'{"ok": true, "data": {"templates": [{"id": "cover", "type": "cover", "name": "Cover", "description": "x", "schema": {}}]}}'
        # 3. 生成 PPT
        pptx_body = b"\x50\x4b\x03\x04" + b"payload" * 50

        # 顺序返回 3 个响应
        responses = [
            self._make_response(themes_body),
            self._make_response(templates_body),
            self._make_response(pptx_body),
        ]

        with patch("tui_python.ppt_api.urlopen", side_effect=responses):
            client = PptApiClient("ws://127.0.0.1:18780/ws")
            themes = client.list_themes()
            templates = client.list_templates()
            pptx = client.make(PptSpec(
                theme=themes[0].id,
                filename="recipe",
                slides=[
                    {"template": "cover", "title": "我的菜谱", "data": {}},
                    {"template": templates[0].type, "title": "目录", "data": {"items": []}},
                ],
            ))

        self.assertEqual(len(themes), 1)
        self.assertEqual(len(templates), 1)
        self.assertEqual(pptx[:4], b"\x50\x4b\x03\x04")
        self.assertGreater(len(pptx), 100)


if __name__ == "__main__":
    unittest.main()
