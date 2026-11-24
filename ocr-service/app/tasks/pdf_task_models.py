import json
from dataclasses import dataclass
from typing import Any, Iterable


@dataclass(frozen=True)
class PdfPageRecord:
    task_id: str
    page_number: int
    status: str
    text: str
    items_json: str
    error: str | None
    started_at: str | None
    completed_at: str | None
    attempt_count: int

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "page": self.page_number,
            "status": self.status,
            "text": self.text,
            "items": json.loads(self.items_json),
            "error": self.error,
            "attemptCount": self.attempt_count,
            "startedAt": self.started_at,
            "completedAt": self.completed_at,
        }


@dataclass(frozen=True)
class PdfTaskRecord:
    task_id: str
    filename: str
    ocr_type: str
    pdf_path: str
    status: str
    page_count: int
    processed_pages: int
    progress: float
    error: str | None
    full_text: str
    created_at: str
    updated_at: str
    started_at: str | None
    heartbeat_at: str | None
    completed_at: str | None
    attempt_count: int

    def to_public_dict(
        self,
        pages: Iterable[PdfPageRecord] = (),
    ) -> dict[str, Any]:
        pages = list(pages)
        return {
            "ok": True,
            "taskId": self.task_id,
            "filename": self.filename,
            "ocrType": self.ocr_type,
            "status": self.status,
            "pageCount": self.page_count,
            # processedPages 包含失败页，用于算进度；成功、失败页数单独给出
            "processedPages": self.processed_pages,
            "succeededPages": sum(1 for page in pages if page.status == "completed"),
            "failedPages": sum(1 for page in pages if page.status == "failed"),
            # 正在识别的页码，前端显示“正在识别第 N 页”
            "currentPage": next(
                (page.page_number for page in pages if page.status == "processing"),
                None,
            ),
            "progress": self.progress,
            "error": self.error,
            "text": self.full_text if self.status == "completed" else "",
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
            "startedAt": self.started_at,
            "heartbeatAt": self.heartbeat_at,
            "completedAt": self.completed_at,
            "attemptCount": self.attempt_count,
            "pages": [page.to_public_dict() for page in pages],
        }
