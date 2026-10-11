"""Reject unauthenticated or oversized uploads before the multipart body is read.

FastAPI parses (and spools to disk) a multipart body before it resolves the
``get_current_user`` dependency. For the upload routes this middleware checks
the bearer token and ``Content-Length`` first, and enforces the same byte limit
on chunked bodies while they stream.
"""

from __future__ import annotations

import json
from typing import Any, Callable

from starlette.concurrency import run_in_threadpool

from .config import get_settings
from .errors import ApiProblem

UPLOAD_PATHS = frozenset({"/documents", "/documents/parse"})
# Multipart boundaries, part headers and the file name around the PDF bytes.
MULTIPART_OVERHEAD_BYTES = 1024 * 1024


class _BodyTooLarge(Exception):
    pass


def _problem_messages(problem: ApiProblem) -> list[dict[str, Any]]:
    body = json.dumps({"error": {"code": problem.code, "message": problem.message}}).encode("utf-8")
    headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode("ascii"))]
    headers.extend((name.lower().encode("latin-1"), value.encode("latin-1")) for name, value in problem.headers.items())
    return [
        {"type": "http.response.start", "status": problem.status_code, "headers": headers},
        {"type": "http.response.body", "body": body},
    ]


class UploadGuardMiddleware:
    def __init__(self, app, authenticate: Callable[[str | None], Any]) -> None:
        self.app = app
        self.authenticate = authenticate

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] not in UPLOAD_PATHS:
            await self.app(scope, receive, send)
            return
        headers = {name.lower(): value for name, value in scope.get("headers", [])}
        limit = get_settings().max_file_size_bytes + MULTIPART_OVERHEAD_BYTES
        too_large = ApiProblem(413, "file_too_large", "The upload exceeds the maximum PDF size.")
        declared = headers.get(b"content-length")
        try:
            if declared is not None and int(declared) > limit:
                raise too_large
            authorization = headers.get(b"authorization")
            await run_in_threadpool(self.authenticate, authorization.decode("latin-1") if authorization else None)
        except ValueError:
            for message in _problem_messages(ApiProblem(400, "request_invalid", "The Content-Length header is invalid.")):
                await send(message)
            return
        except ApiProblem as problem:
            for message in _problem_messages(problem):
                await send(message)
            return

        received = 0
        exceeded = False
        replaced = False

        async def limited_receive():
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    exceeded = True
                    raise _BodyTooLarge()
            return message

        async def guarded_send(message):
            nonlocal replaced
            if not exceeded:
                await send(message)
                return
            # Body parsing failed because of our limit: answer 413 once.
            if not replaced:
                replaced = True
                for item in _problem_messages(too_large):
                    await send(item)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except _BodyTooLarge:
            if not replaced:
                for item in _problem_messages(too_large):
                    await send(item)
