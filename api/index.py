import base64
import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from typing import Any, Dict
from urllib.parse import parse_qs, urlparse

# 添加backend路径到Python路径
current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.join(current_dir, "..", "backend-fastapi")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# 初始化ASGI handler
asgi_handler = None

# 导入FastAPI应用
try:
    from main import app
    from mangum import Mangum

    asgi_handler = Mangum(app)
    print("Backend loaded successfully")
except ImportError as exc:
    print(f"Import error: {exc}")
    asgi_handler = None
except Exception as exc:  # pragma: no cover - defensive logging in serverless env
    print(f"Setup error: {exc}")
    asgi_handler = None


def _read_request_body(request: "handler") -> tuple[bytes, bool]:
    """Read the incoming request body and flag whether it's base64-encoded."""

    length_header = request.headers.get("content-length")
    if not length_header:
        return b"", False

    try:
        length = int(length_header)
    except ValueError:
        length = 0

    body_bytes = request.rfile.read(length) if length > 0 else b""

    try:
        body_bytes.decode("utf-8")
        return body_bytes, False
    except UnicodeDecodeError:
        return body_bytes, True


def _build_event(request: "handler", body_bytes: bytes, is_base64: bool) -> Dict[str, Any]:
    """Translate the incoming HTTP request into an API Gateway compatible event."""

    parsed_url = urlparse(request.path)
    headers = {key.lower(): value for key, value in request.headers.items()}
    query_params = parse_qs(parsed_url.query)

    body_value: str | None
    if not body_bytes:
        body_value = None
    elif is_base64:
        body_value = base64.b64encode(body_bytes).decode("utf-8")
    else:
        body_value = body_bytes.decode("utf-8")

    event: Dict[str, Any] = {
        "version": "2.0",
        "routeKey": "$default",
        "rawPath": parsed_url.path or "/",
        "rawQueryString": parsed_url.query or "",
        "headers": headers,
        "requestContext": {
            "http": {
                "method": request.command,
                "path": parsed_url.path or "/",
                "protocol": request.request_version,
                "sourceIp": request.client_address[0] if request.client_address else "",
                "userAgent": request.headers.get("User-Agent"),
            }
        },
        "isBase64Encoded": is_base64,
        "body": body_value,
    }

    if query_params:
        event["queryStringParameters"] = {key: values[-1] for key, values in query_params.items()}
        event["multiValueQueryStringParameters"] = query_params

    cookies = request.headers.get("Cookie")
    if cookies:
        event["cookies"] = [item.strip() for item in cookies.split(";") if item.strip()]

    return event


def _write_response(request: "handler", response: Dict[str, Any]) -> None:
    """Write the Mangum response back to the client."""

    status_code = int(response.get("statusCode", 200))
    body_content = response.get("body", "")

    if response.get("isBase64Encoded") and isinstance(body_content, str):
        body_bytes = base64.b64decode(body_content or "")
    elif isinstance(body_content, bytes):
        body_bytes = body_content
    elif body_content is None:
        body_bytes = b""
    elif isinstance(body_content, (dict, list)):
        body_bytes = json.dumps(body_content).encode("utf-8")
    else:
        body_bytes = str(body_content).encode("utf-8")

    request.send_response(status_code)

    sent_headers: Dict[str, list[str]] = {}

    def _send_header(name: str, value: str) -> None:
        request.send_header(name, value)
        sent_headers.setdefault(name.lower(), []).append(value)

    for key, value in response.get("headers", {}).items():
        if isinstance(value, (list, tuple)):
            for item in value:
                _send_header(key, str(item))
        else:
            _send_header(key, str(value))

    for key, values in response.get("multiValueHeaders", {}).items():
        for value in values:
            _send_header(key, str(value))

    if "content-length" not in sent_headers:
        _send_header("Content-Length", str(len(body_bytes)))

    request.end_headers()

    if request.command != "HEAD" and body_bytes:
        request.wfile.write(body_bytes)


class handler(BaseHTTPRequestHandler):
    """Vercel entrypoint bridging BaseHTTPRequestHandler to the FastAPI ASGI app."""

    protocol_version = "HTTP/1.1"

    def _dispatch(self) -> None:
        if asgi_handler is None:
            self.send_error(500, explain="Backend not initialized")
            return

        try:
            body_bytes, needs_base64 = _read_request_body(self)
            event = _build_event(self, body_bytes, needs_base64)
            response = asgi_handler(event, {})
            _write_response(self, response)
        except Exception as exc:  # pragma: no cover - degrade gracefully
            print(f"Handler error: {exc}")
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            payload = json.dumps({"error": "Internal server error"})
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(payload.encode("utf-8"))

    # Map HTTP verbs to the shared dispatcher
    def do_OPTIONS(self) -> None:  # noqa: N802 - required naming by BaseHTTPRequestHandler
        self._dispatch()

    def do_GET(self) -> None:  # noqa: N802
        self._dispatch()

    def do_POST(self) -> None:  # noqa: N802
        self._dispatch()

    def do_PUT(self) -> None:  # noqa: N802
        self._dispatch()

    def do_DELETE(self) -> None:  # noqa: N802
        self._dispatch()

    def do_PATCH(self) -> None:  # noqa: N802
        self._dispatch()

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003 - signature required by base class
        """Suppress default logging to keep Vercel function output clean."""

        return
