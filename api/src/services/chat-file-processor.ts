import path from "node:path";

import { ChatFileModel } from "../models/ChatFileModel.js";
import { logger } from "../utils/logger.js";
import {
  createPdfOcrTask,
  recognizeImage,
  recognizeAncientImage,
  toOcrPageProgress,
  waitForPdfOcrTask,
} from "./ocr-client.js";
import { correctAncientText } from "./xunzi-client.js";
import { DocumentNeedsOcrError, parseDocument } from "./document-parser.js";
import { classifyDocument } from "./document-classifier.js";
import { ChatFileDocument } from "../models/types/index.js";
import { emitChatFileStatus } from "../socket/file-status.js";

const imageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/bmp",
  "image/tiff",
]);

async function processDocument(absoluteFilePath: string, file: ChatFileDocument) {
  file.status = "processing";
  file.processingMode = "document";
  file.processingStage = "parsing";
  file.processingError = undefined;
  await file.save();
  emitFileStatus(file);

  const parsed = await parseDocument(absoluteFilePath);

  file.extractedMarkdown = parsed.markdown;
  file.processedText = parsed.markdown;
  file.processingStage = "completed";
  file.status = "ready";
  file.processingError = undefined;
  await file.save();
  emitFileStatus(file);
}

export async function processChatFile(
  fileId: string,
  absoluteFilePath: string,
): Promise<void> {
  const file = await ChatFileModel.findById(fileId);

  if (!file) {
    return;
  }

  try {
    if (file.ocrRawText?.trim()) {
      await correctAndComplete(file, file.ocrRawText.trim());
      return;
    }

    if (imageMimeTypes.has(file.mimeType)) {
      await processImageByOcr(file, absoluteFilePath);
      return;
    }

    try {
      await processDocument(absoluteFilePath, file);
      return;
    } catch (error) {
      if (!(error instanceof DocumentNeedsOcrError) || file.mimeType !== "application/pdf") {
        throw error;
      }
    }

    await processPdfByOcr(file, absoluteFilePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : "文件处理失败";

    await ChatFileModel.findByIdAndUpdate(fileId, {
      $set: {
        status: "failed",
        processingStage: "failed",
        processingError: message,
        error: message,
      },
    });
    const failedFile = await ChatFileModel.findById(fileId);
    if (failedFile) emitFileStatus(failedFile);

    logger.error(
      { err: error, fileId, filePath: path.basename(absoluteFilePath) },
      "文件处理失败",
    );
  }
}

async function processImageByOcr(file: ChatFileDocument, absoluteFilePath: string) {
  let ocrText = file.ocrRawText?.trim() || "";
  if (!ocrText) {
    file.status = "processing";
    file.processingMode = "ocr";
    file.processingStage = "ocr";
    file.processingError = undefined;
    await file.save();
    emitFileStatus(file);
    try {
      // 普通图片使用通用 OCR；通用引擎没有识别结果时再回退古籍引擎。
      ocrText = await recognizeImage(absoluteFilePath, file.originalName, file.mimeType);
      console.log(ocrText, "-->");
    } catch (normalError) {
      logger.warn({ err: normalError, fileId: file._id.toString() }, "普通 OCR 无结果，回退古籍 OCR");
      ocrText = await recognizeAncientImage(absoluteFilePath, file.originalName, file.mimeType);
    }
    file.ocrRawText = ocrText;
    await file.save();
    emitFileStatus(file);
  }

  await correctAndComplete(file, ocrText);
}

async function processPdfByOcr(file: ChatFileDocument, absoluteFilePath: string) {
  // 先尝试过直接解析，文本层为空才会走到这里，所以链路改记为 OCR
  file.status = "processing";
  file.processingMode = "ocr";
  file.processingStage = "ocr";
  file.processingError = undefined;
  await file.save();
  emitFileStatus(file);

  let taskId = file.ocrTaskId;
  if (!taskId) {
    const task = await createPdfOcrTask(absoluteFilePath, file.originalName);
    taskId = task.taskId;
    file.ocrTaskId = taskId;
    await file.save();
    emitFileStatus(file);
  }

  // 每 3 秒轮询一次 OCR 任务，只有页数进度真的变化时才落库、推送，避免空写
  let lastProgressKey = "";
  const completedTask = await waitForPdfOcrTask(taskId, async (task) => {
    const progress = toOcrPageProgress(task);
    const key = JSON.stringify(progress ?? null);
    if (!progress || key === lastProgressKey) return;
    lastProgressKey = key;
    file.ocrProgress = progress;
    await file.save();
    emitFileStatus(file);
  });

  const ocrText = completedTask.text.trim();
  file.ocrRawText = ocrText;
  // 完成后保留总页数和失败页数，去掉“正在识别第几页”，刷新后也能看到最终结果
  const finalProgress = toOcrPageProgress(completedTask);
  if (finalProgress) file.ocrProgress = { ...finalProgress, currentPage: undefined };
  await file.save();
  emitFileStatus(file);
  if (finalProgress?.failedPages) {
    logger.warn(
      { fileId: file._id.toString(), ...finalProgress },
      "PDF 部分页面 OCR 失败，使用其余页面的识别结果继续处理",
    );
  }
  await correctAndComplete(file, ocrText);
}

export async function retryAncientCorrection(fileId: string): Promise<void> {
  const file = await ChatFileModel.findById(fileId);
  if (!file) throw new Error("文件不存在");
  const ocrText = file.ocrRawText?.trim();
  if (!ocrText) throw new Error("没有可供荀子模型处理的 OCR 原文");
  await correctAndComplete(file, ocrText);
}

async function correctAndComplete(file: ChatFileDocument, ocrText: string) {
  // 重试时可能直接从已保存的 OCR 结果进入，这里补记链路
  file.processingMode = "ocr";
  classifyOcrDocument(file, ocrText);
  await file.save();
  emitFileStatus(file);

  // 只有明确判定为古籍时才调用荀子模型；普通 OCR 文档直接保留识别结果。
  if (file.documentType !== "ancient_book") {
    file.processedText = ocrText;
    file.extractedMarkdown = ocrText;
    file.processingStage = "completed";
    file.status = "ready";
    file.processingError = undefined;
    await file.save();
    emitFileStatus(file);
    logger.info(
      { originalName: file.originalName, documentType: file.documentType, ocrTextLength: ocrText.length },
      "非古籍 OCR 文件处理完成，跳过荀子模型",
    );
    return;
  }

  file.status = "processing";
  file.processingStage = "correction";
  file.processingError = undefined;
  await file.save();
  emitFileStatus(file);
  // 交给荀子大模型校对古籍文本。校对只是提升质量的附加步骤：
  // 失败时回退为 OCR 原文，附件照样可用，对话不中断；失败原因记在 correctionError 里给前端展示
  let processedText = ocrText;
  file.correctionError = undefined;
  try {
    processedText = await correctAncientText(ocrText);
  } catch (error) {
    file.correctionError = error instanceof Error ? error.message : "荀子模型调用失败";
    logger.warn(
      { err: error, fileId: file._id.toString(), originalName: file.originalName },
      "荀子模型校对失败，回退使用 OCR 原文",
    );
  }

  file.processedText = processedText;
  file.extractedMarkdown = processedText;
  file.processingStage = "completed";
  file.status = "ready";
  file.processingError = undefined;

  await file.save();
  emitFileStatus(file);
  logger.info({ originalName: file.originalName, ocrTextLength: ocrText.length, processedTextLength: processedText.length, corrected: !file.correctionError }, "扫描文件处理完成");
}

function classifyOcrDocument(file: ChatFileDocument, text: string): void {
  // 判定逻辑见 document-classifier.ts；只有 ancient_book 会调用荀子大模型校对
  const result = classifyDocument(text);
  file.documentType = result.documentType;
  file.classificationConfidence = result.confidence;
  file.classificationReasons = result.reasons;
}

/**
 * 附件处理状态的公开字段。Socket 推送、状态查询接口、历史消息附件共用，
 * 保证前端的处理步骤链在实时更新和刷新后看到的是同一份数据。
 */
export function toFileProcessingInfo(
  // 用 Pick 而不是整个文档类型，这样 .lean() 查出来的普通对象也能直接传入
  file: Pick<
    ChatFileDocument,
    | "status"
    | "processingStage"
    | "processingError"
    | "processingMode"
    | "correctionError"
    | "ocrProgress"
    | "documentType"
    | "classificationConfidence"
    | "classificationReasons"
  >,
) {
  return {
    status: file.status,
    processingStage: file.processingStage,
    ...(file.processingError ? { processingError: file.processingError } : {}),
    ...(file.processingMode ? { processingMode: file.processingMode } : {}),
    ...(file.correctionError ? { correctionError: file.correctionError } : {}),
    // 显式拷成普通对象：Mongoose 子文档直接交给 socket.io / res.json 可能带出内部字段
    ...(file.ocrProgress?.pageCount
      ? {
          ocrProgress: {
            pageCount: file.ocrProgress.pageCount,
            succeededPages: file.ocrProgress.succeededPages ?? 0,
            failedPages: file.ocrProgress.failedPages ?? 0,
            ...(file.ocrProgress.currentPage ? { currentPage: file.ocrProgress.currentPage } : {}),
          },
        }
      : {}),
    ...(file.documentType ? { documentType: file.documentType } : {}),
    ...(file.classificationConfidence !== undefined ? { classificationConfidence: file.classificationConfidence } : {}),
    ...(file.classificationReasons?.length ? { classificationReasons: file.classificationReasons } : {}),
  };
}

export function emitFileStatus(file: ChatFileDocument): void {
  emitChatFileStatus({
    conversationId: file.conversationId,
    fileId: file._id.toString(),
    name: file.originalName,
    ...toFileProcessingInfo(file),
  });
}

export function startChatFileProcessing(
  fileId: string,
  absoluteFilePath: string,
): void {
  setImmediate(() => {
    void processChatFile(fileId, absoluteFilePath);
  });
}
