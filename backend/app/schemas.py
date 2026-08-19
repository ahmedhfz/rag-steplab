from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class CamelCaseModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


ElementType = Literal["heading", "paragraph", "list", "table", "other"]


class DocumentMetadata(CamelCaseModel):
    file_name: str
    media_type: str
    size_bytes: int = Field(ge=0)
    page_count: int = Field(ge=0)


class ParsedTable(CamelCaseModel):
    rows: list[list[str]] = Field(default_factory=list)
    markdown: str = ""


class ParsedElement(CamelCaseModel):
    id: str
    type: ElementType
    page_numbers: list[int] = Field(default_factory=list)
    text: str = ""
    level: int | None = Field(default=None, ge=1)
    table: ParsedTable | None = None


class ParsedPage(CamelCaseModel):
    page_number: int = Field(ge=1)
    elements: list[ParsedElement] = Field(default_factory=list)


class StructuredContent(CamelCaseModel):
    pages: list[ParsedPage] = Field(default_factory=list)
    elements: list[ParsedElement] = Field(default_factory=list)


class ParseSummary(CamelCaseModel):
    page_count: int = Field(ge=0)
    heading_count: int = Field(ge=0)
    paragraph_count: int = Field(ge=0)
    list_count: int = Field(ge=0)
    table_count: int = Field(ge=0)


class ParseResponse(CamelCaseModel):
    document: DocumentMetadata
    structured: StructuredContent
    markdown: str
    summary: ParseSummary


class ApiError(CamelCaseModel):
    code: str
    message: str


class ErrorResponse(CamelCaseModel):
    error: ApiError
