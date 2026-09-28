import { readFile } from "node:fs/promises";
import { PdfOcrTask } from "./types/index.js";

const OCR_BASE_URL = process.env.OCR_BASE_URL || "http://127.0.0.1:8001";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function createUploadForm(
  filePath: string,
  originalName: string,
  mimeType: string,
): Promise<FormData> {
  const bytes = await readFile(filePath);
  const blob = new Blob([bytes], {
    type: mimeType,
  });

  const form = new FormData();
  form.append("file", blob, originalName);

  return form;
}

export async function recognizeAncientImage(
  filePath: string,
  originalName: string,
  mimeType: string,
): Promise<string> {
  const form = await createUploadForm(filePath, originalName, mimeType);

  const response = await fetch(`${OCR_BASE_URL}/ocr/ancient-image`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`古籍图片 OCR 失败：HTTP ${response.status} ${detail}`);
  }

  const result = (await response.json()) as {
    ok: boolean;
    text: string;
  };

  if (!result.text?.trim()) {
    throw new Error("古籍图片 OCR 没有返回文字");
  }

  return result.text.trim();
}

export async function recognizeImage(
  filePath: string,
  originalName: string,
  mimeType: string,
): Promise<string> {
  const form = await createUploadForm(filePath, originalName, mimeType);
  const response = await fetch(`${OCR_BASE_URL}/ocr/image`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`普通图片 OCR 失败：HTTP ${response.status} ${detail}`);
  }
  const result = (await response.json()) as { text?: string };
  if (!result.text?.trim()) {
    throw new Error("普通图片 OCR 没有返回文字");
  }
  return result.text.trim();
}

export async function createPdfOcrTask(
  filePath: string,
  originalName: string,
): Promise<PdfOcrTask> {
  const form = await createUploadForm(
    filePath,
    originalName,
    "application/pdf",
  );

  const response = await fetch(
    `${OCR_BASE_URL}/ocr/pdf/tasks?ocr_type=ancient`,
    {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60_000),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`创建 PDF OCR 任务失败：HTTP ${response.status} ${detail}`);
  }

  return await response.json();
}

export async function getPdfOcrTask(taskId: string): Promise<PdfOcrTask> {
  const response = await fetch(`${OCR_BASE_URL}/ocr/pdf/tasks/${taskId}`, {
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`查询 PDF OCR 任务失败：HTTP ${response.status} ${detail}`);
  }

  return (await response.json()) as PdfOcrTask;
}

export async function cancelPdfOcrTask(
  taskId: string,
): Promise<PdfOcrTask> {
  const response = await fetch(
    `${OCR_BASE_URL}/ocr/pdf/tasks/${taskId}/cancel`,
    {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(
      `取消 PDF OCR 任务失败：HTTP ${response.status} ${detail}`,
    );
  }

  return (await response.json())
}

export async function waitForPdfOcrTask(
  taskId: string,
): Promise<PdfOcrTask> {
  // 最多等两个小时。
  const deadline = Date.now() + 2 * 60 * 60 * 1000;

  while (Date.now() < deadline) {
    const task = await getPdfOcrTask(taskId);

    if (task.status === "completed") {
      if (!task.text?.trim()) {
        throw new Error("PDF OCR 已完成，但没有识别到文字");
      }

      return task;
    }

    if (task.status === "failed") {
      throw new Error(task.error || "PDF OCR 任务失败");
    }

    await sleep(3000);
  }

  throw new Error("等待 PDF OCR 完成超时")
}
