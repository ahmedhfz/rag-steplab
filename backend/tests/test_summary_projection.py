from contextlib import contextmanager
import uuid

from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql

from app.auth import CurrentUser, get_current_user
from app.main import app
from app.models import Document
from app.repository import SqlAlchemyRepository, get_repository, reset_repository
from app.schemas import DocumentMetadata, EvaluationDatasetRequest, EvaluationCase, ParseResponse, ParseSummary, ParsedPage, StructuredContent
from app.storage import reset_storage


client = TestClient(app)
OWNER_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")


def setup_function():
    reset_repository()
    reset_storage()


def _parsed() -> ParseResponse:
    return ParseResponse(
        document=DocumentMetadata(file_name="projection.pdf", media_type="application/pdf", size_bytes=32, page_count=1),
        structured=StructuredContent(pages=[ParsedPage(page_number=1, elements=[])]),
        markdown="# Projection",
        summary=ParseSummary(page_count=1, heading_count=0, paragraph_count=0, list_count=0, table_count=0),
    )


def test_summary_endpoint_excludes_artifact_bodies():
    repository = get_repository()
    document = repository.create_document(
        {"file_name": "projection.pdf", "media_type": "application/pdf", "size_bytes": 32, "page_count": 1, "owner_user_id": OWNER_ID},
        "documents",
        "projection.pdf",
        "sha-summary",
    )
    parse = repository.save_parse(document["id"], _parsed())
    assert parse is not None
    repository.save_experiment({
        "id": "experiment-summary",
        "document_id": document["id"],
        "chunk_run_id": "chunk-summary",
        "embedding_run_id": None,
        "query": "summary",
        "target_stage": "retrieval",
        "config": {},
        "stage_results": {"retrieval": {"status": "completed", "results": [{"text": "x"}] * 4}},
        "status": "completed",
    })
    dataset = repository.save_dataset(
        EvaluationDatasetRequest(
            document_id=document["id"],
            parse_run_id=parse["id"],
            name="Smoke",
            cases=[EvaluationCase(question="q", relevant_element_ids=["element"], reference_answer="a")],
        ),
        parse["id"],
    )
    repository.save_evaluation({
        "id": "evaluation-summary",
        "dataset_id": dataset["id"],
        "results": {"aggregate": {"caseCount": 1}, "caseResults": [{"answer": "heavy"}]},
    })

    response = client.get(f"/documents/{document['id']}/summary")

    assert response.status_code == 200
    payload = response.json()
    assert payload["parseRuns"][0]["id"] == parse["id"]
    assert payload["parseRuns"][0]["isCompatible"] is True
    serialized = response.text
    for forbidden in ("structured", "markdown", "chunks", "stageResults", "caseResults"):
        assert forbidden not in serialized
    assert payload["experiments"][0]["candidateCount"] == 4
    assert payload["experiments"][0]["stageStatuses"] == {"retrieval": "completed"}
    assert payload["evaluationDatasets"][0]["caseCount"] == 1
    assert payload["evaluationRuns"][0]["id"] == "evaluation-summary"
    assert "results" not in payload["evaluationRuns"][0]

    experiment_list = client.get(f"/experiments?documentId={document['id']}")
    dataset_list = client.get(f"/evaluation/datasets?documentId={document['id']}")
    evaluation_list = client.get(f"/evaluation/runs?datasetId={dataset['id']}")
    assert "stageResults" not in experiment_list.text
    assert "cases" not in dataset_list.text
    assert "caseResults" not in evaluation_list.text


def test_sql_summary_bundle_uses_constant_projection_queries(monkeypatch):
    document = {
        "id": "document-1",
        "file_name": "projection.pdf",
        "media_type": "application/pdf",
        "size_bytes": 32,
        "page_count": 1,
        "sha256": "sha",
        "owner_user_id": OWNER_ID,
        "storage_bucket": "documents",
        "storage_path": "projection.pdf",
        "active_parse_run_id": "parse-1",
        "active_chunk_run_id": "chunk-1",
        "active_embedding_run_id": "embedding-1",
        "created_at": None,
        "updated_at": None,
    }

    class Result:
        def __init__(self, row=None):
            self.row = row

        def mappings(self):
            return self

        def first(self):
            return self.row

        def all(self):
            return []

    class Session:
        def __init__(self):
            self.statements = []

        def execute(self, statement, _parameters=None):
            self.statements.append(statement)
            return Result(document if len(self.statements) == 1 else None)

    session = Session()

    @contextmanager
    def fake_scope():
        yield session

    monkeypatch.setattr("app.repository.session_scope", fake_scope)
    bundle = SqlAlchemyRepository().get_document_summary_bundle("document-1", owner_user_id=OWNER_ID)

    assert bundle is not None
    assert len(session.statements) == 2  # owner-scoped document + one lightweight union projection
    sql = "\n".join(str(statement.compile(dialect=postgresql.dialect())) for statement in session.statements)
    assert "parse_runs.structured," not in sql
    assert "parse_runs.markdown" not in sql
    assert "chunks.text" not in sql
    assert "'stage_results'" not in sql
    assert "evaluation_datasets.cases," not in sql
    assert "evaluation_runs.results" not in sql


def test_summary_contract_keeps_document_ownership_boundary():
    repository = get_repository()
    document = repository.create_document(
        {"file_name": "private.pdf", "media_type": "application/pdf", "size_bytes": 8, "page_count": 1, "owner_user_id": OWNER_ID},
        "documents",
        "private.pdf",
        "sha-private",
    )
    other_user = CurrentUser(id=uuid.UUID("22222222-2222-4222-8222-222222222222"), role="authenticated")
    app.dependency_overrides[get_current_user] = lambda: other_user

    assert client.get(f"/documents/{document['id']}/summary").status_code == 404
    assert client.get(f"/experiments?documentId={document['id']}").status_code == 404
    assert client.get(f"/evaluation/datasets?documentId={document['id']}").json() == {"items": []}
