from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .errors import ApiProblem
from .parser import parse_pdf_file
from .schemas import ApiError, ErrorResponse, ParseResponse

MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"", "application/pdf", "application/octet-stream"}

app = FastAPI(title="RAG StepLab Parser", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"]
)


@app.exception_handler(ApiProblem)
async def api_problem_handler(_: Request, problem: ApiProblem) -> JSONResponse:
    payload = ErrorResponse(error=ApiError(code=problem.code, message=problem.message))
    return JSONResponse(status_code=problem.status_code, content=payload.model_dump(by_alias=True))


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/documents/parse", response_model=ParseResponse)
async def parse_document(file: UploadFile = File(...)) -> ParseResponse:
    file_name = file.filename or ""
    content_type = file.content_type or ""

    if not file_name.lower().endswith(".pdf") or content_type not in ALLOWED_CONTENT_TYPES:
        raise ApiProblem(400, "invalid_file_type", "Only PDF files are supported.")

    try:
        content = await file.read(MAX_FILE_SIZE_BYTES + 1)
    finally:
        await file.close()

    if not content:
        raise ApiProblem(400, "empty_file", "The uploaded PDF is empty.")
    if len(content) > MAX_FILE_SIZE_BYTES:
        raise ApiProblem(413, "file_too_large", "The PDF must be 50 MB or smaller.")
    if b"%PDF-" not in content[:1024]:
        raise ApiProblem(400, "invalid_file_type", "The uploaded file is not a valid PDF.")

    temporary_path: Path | None = None
    try:
        with NamedTemporaryFile(suffix=".pdf", delete=False) as temporary_file:
            temporary_file.write(content)
            temporary_path = Path(temporary_file.name)

        return await run_in_threadpool(parse_pdf_file, temporary_path, file_name, len(content))
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
