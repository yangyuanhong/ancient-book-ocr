import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import pymupdf

from app.core.config import ocr_config
from app.tasks.page_process_runner import run_page_process
from app.tasks.pdf_task_repository import PdfTaskRepository


Recognizer = Callable[[int, str, str], Awaitable[dict[str, Any]]]


async def default_recognizer(
    page_number: int,
    pdf_path: str,
    ocr_type: str,
) -> dict[str, Any]:
    return await run_page_process(pdf_path, page_number, ocr_type)


async def process_one_task(
    repository: PdfTaskRepository,
    task_id: str,
    recognizer: Recognizer = default_recognizer,
) -> None:
    task = repository.get_task(task_id)
    if task is None:
        return

    pdf_path = Path(task.pdf_path)
    if not pdf_path.is_file():
        repository.fail_task(task_id, f"源 PDF 不存在：{pdf_path}")
        return

    document: pymupdf.Document | None = None
    current_page = 0
    try:
        document = pymupdf.open(pdf_path)
        if document.page_count == 0:
            raise ValueError("PDF 没有任何页面")
        repository.initialize_pages(task_id, document.page_count)

        while page_record := repository.next_incomplete_page(task_id):
            if repository.is_task_cancelled(task_id):
                return
            current_page = page_record.page_number
            last_error: Exception | None = None
            for _attempt in range(ocr_config.page_max_attempts):
                repository.mark_page_processing(task_id, current_page)
                try:
                    result = await recognizer(
                        current_page, str(pdf_path), task.ocr_type
                    )
                    if repository.is_task_cancelled(task_id):
                        return
                    repository.complete_page(
                        task_id,
                        current_page,
                        str(result.get("text", "")).strip(),
                        list(result.get("items", [])),
                    )
                    last_error = None
                    break
                except asyncio.CancelledError:
                    raise
                except Exception as error:
                    # 子进程崩溃（PageProcessError）以外，识别器本身抛的异常也只算这一页失败
                    last_error = error
            if last_error is not None:
                # 单页失败不拖垮整本书：记下这一页，继续后面的页
                repository.fail_page(
                    task_id,
                    current_page,
                    f"第 {current_page} 页处理失败：{type(last_error).__name__}: {last_error}",
                )
        if repository.is_task_cancelled(task_id):
            return

        # 一页都没识别出来才算整本失败；部分页失败时照常完成，失败页数通过 failedPages 返回
        pages = repository.list_pages(task_id)
        if pages and all(page.status == "failed" for page in pages):
            repository.fail_task(task_id, f"全部 {len(pages)} 页识别失败：{pages[-1].error}")
            return

        repository.complete_task(task_id)
    except Exception as error:
        if repository.is_task_cancelled(task_id):
            return

        message = f"第 {current_page} 页处理失败：{type(error).__name__}: {error}"
        if current_page:
            repository.fail_page_and_task(task_id, current_page, message)
        else:
            repository.fail_task(task_id, message)
    finally:
        if document is not None:
            document.close()


async def worker_loop(
    repository: PdfTaskRepository,
    wake_event: asyncio.Event,
    stop_event: asyncio.Event,
) -> None:
    while not stop_event.is_set():
        task = repository.claim_next_task()
        if task is not None:
            await process_one_task(repository, task.task_id)
            continue

        wake_event.clear()
        try:
            await asyncio.wait_for(wake_event.wait(), timeout=5)
        except asyncio.TimeoutError:
            pass
