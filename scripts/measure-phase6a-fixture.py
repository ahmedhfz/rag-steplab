"""Local contract measurement; emits sizes/timings only, never artifact content."""

import json
import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from fastapi.testclient import TestClient

from app.auth import CurrentUser, get_current_user
from app.main import app
from app.repository import get_repository, reset_repository
from app.schemas import DocumentMetadata, ParseResponse, ParseSummary, ParsedElement, ParsedPage, StructuredContent


USER_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")


def fixture_parse():
    elements = [ParsedElement(id=f"element-{index}", type="paragraph", page_numbers=[1], text="source text " * 40) for index in range(80)]
    return ParseResponse(
        document=DocumentMetadata(file_name="measurement.pdf", media_type="application/pdf", size_bytes=128, page_count=1),
        structured=StructuredContent(pages=[ParsedPage(page_number=1, elements=elements)], elements=elements),
        markdown="# Measurement\n\n" + ("source text " * 2_000),
        summary=ParseSummary(page_count=1, heading_count=0, paragraph_count=len(elements), list_count=0, table_count=0),
    )


def measure(client, path, iterations=10):
    samples = []
    for _ in range(iterations):
        started = time.perf_counter()
        response = client.get(path)
        elapsed = (time.perf_counter() - started) * 1000
        assert response.status_code == 200, (path, response.status_code, response.text)
        samples.append({"bytes": len(response.content), "ms": elapsed, "serverTiming": response.headers.get("server-timing")})
    values = sorted(item["ms"] for item in samples)
    return {
        "requestCount": 1,
        "payloadBytes": {"first": samples[0]["bytes"], "median": sorted(item["bytes"] for item in samples)[len(samples) // 2]},
        "browserMs": {"median": round(values[len(values) // 2], 2), "p95": round(values[-1], 2)},
        "serverTiming": samples[0]["serverTiming"],
    }


def main():
    reset_repository()
    repository = get_repository()
    document = repository.create_document(
        {"file_name": "measurement.pdf", "media_type": "application/pdf", "size_bytes": 128, "page_count": 1, "owner_user_id": USER_ID},
        "documents",
        "measurement.pdf",
        "sha-measurement",
    )
    repository.save_parse(document["id"], fixture_parse())
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id=USER_ID, role="authenticated")
    try:
        client = TestClient(app)
        legacy = measure(client, f"/documents/{document['id']}")
        summary = measure(client, f"/documents/{document['id']}/summary")
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    print(json.dumps({"fixture": "in-memory local TestClient", "legacyDetail": legacy, "summary": summary, "note": "This isolates serialization/query behavior; it is not Modal cold-start evidence."}, indent=2))


if __name__ == "__main__":
    main()
