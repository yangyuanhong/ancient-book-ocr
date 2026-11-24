import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pymupdf

from app.tasks.pdf_task_repository import PdfTaskRepository
from app.tasks.pdf_task_queue import PdfTaskQueue
from app.tasks.pdf_task_worker import process_one_task


class PdfTaskWorkerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.pdf_path = root / "source.pdf"
        document = pymupdf.open()
        document.new_page()
        document.new_page()
        document.save(self.pdf_path)
        document.close()

        self.repository = PdfTaskRepository(root / "tasks.sqlite3")
        self.repository.initialize()
        self.repository.create_task(
            task_id="task-1",
            pdf_path=str(self.pdf_path),
            filename="book.pdf",
            ocr_type="ancient",
        )
        self.repository.initialize_pages("task-1", 2)
        self.repository.claim_next_task()
        self.repository.mark_page_processing("task-1", 1)
        self.repository.complete_page("task-1", 1, "page 1", [])

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_worker_skips_completed_pages_after_restart(self) -> None:
        calls: list[int] = []

        async def recognize(
            page_number: int,
            image_path: str,
            ocr_type: str,
        ) -> dict:
            calls.append(page_number)
            self.assertTrue(Path(image_path).exists())
            self.assertEqual(ocr_type, "ancient")
            return {"text": f"page {page_number}", "items": []}

        asyncio.run(process_one_task(self.repository, "task-1", recognize))

        self.assertEqual(calls, [2])
        task = self.repository.get_task("task-1")
        self.assertEqual(task.status, "completed")
        self.assertIn("## 第 1 页", task.full_text)
        self.assertIn("## 第 2 页", task.full_text)

    def test_worker_continues_after_page_failure(self) -> None:
        # 第 1 页在 setUp 里已完成，第 2 页识别失败：任务照常完成，只记下失败页
        async def recognize(
            page_number: int,
            image_path: str,
            ocr_type: str,
        ) -> dict:
            raise RuntimeError("model crashed")

        asyncio.run(process_one_task(self.repository, "task-1", recognize))

        task = self.repository.get_task("task-1")
        page = self.repository.list_pages("task-1")[1]
        self.assertEqual(task.status, "completed")
        self.assertEqual(page.status, "failed")
        self.assertIn("model crashed", page.error)
        self.assertIn("## 第 1 页", task.full_text)
        self.assertNotIn("## 第 2 页", task.full_text)

        snapshot = task.to_public_dict(self.repository.list_pages("task-1"))
        self.assertEqual(snapshot["pageCount"], 2)
        self.assertEqual(snapshot["succeededPages"], 1)
        self.assertEqual(snapshot["failedPages"], 1)
        self.assertEqual(snapshot["progress"], 100)

    def test_worker_fails_task_when_every_page_fails(self) -> None:
        self.repository.create_task(
            task_id="task-2",
            pdf_path=str(self.pdf_path),
            filename="broken.pdf",
            ocr_type="ancient",
        )
        self.repository.claim_next_task()

        async def recognize(
            page_number: int,
            image_path: str,
            ocr_type: str,
        ) -> dict:
            raise RuntimeError("model crashed")

        asyncio.run(process_one_task(self.repository, "task-2", recognize))

        task = self.repository.get_task("task-2")
        self.assertEqual(task.status, "failed")
        self.assertIn("全部 2 页识别失败", task.error)
        self.assertTrue(
            all(page.status == "failed" for page in self.repository.list_pages("task-2"))
        )

    def test_queue_start_recovers_interrupted_task(self) -> None:
        self.repository.mark_page_processing("task-1", 2)

        async def start_and_inspect() -> tuple[str, str]:
            async def idle_worker(repository, wake_event, stop_event) -> None:
                await stop_event.wait()

            with patch("app.tasks.pdf_task_queue.worker_loop", new=idle_worker):
                queue = PdfTaskQueue(self.repository)
                await queue.start()
                task = queue.repository.get_task("task-1")
                page = queue.repository.list_pages("task-1")[1]
                await queue.stop()
            return task.status, page.status

        task_status, page_status = asyncio.run(start_and_inspect())

        self.assertEqual(task_status, "queued")
        self.assertEqual(page_status, "pending")


if __name__ == "__main__":
    unittest.main()
