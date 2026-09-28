import path from "node:path";

import { ChatFileModel } from "../models/ChatFileModel.js";
import { logger } from "../utils/logger.js";
import {
  createPdfOcrTask,
  recognizeImage,
  recognizeAncientImage,
  waitForPdfOcrTask,
} from "./ocr-client.js";
import { correctAncientText } from "./xunzi-client.js";
import { DocumentNeedsOcrError, parseDocument } from "./document-parser.js";
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
  file.status = "processing";
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

  const completedTask = await waitForPdfOcrTask(taskId);
  const ocrText = completedTask.text.trim();
  file.ocrRawText = ocrText;
  await file.save();
  emitFileStatus(file);
  await correctAndComplete(file, ocrText);
}

async function correctAndComplete(file: ChatFileDocument, ocrText: string) {
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
  // 交给荀子大模型解析古籍文本
  const processedText = await correctAncientText(ocrText);

  file.processedText = processedText;
  file.extractedMarkdown = processedText;
  file.processingStage = "completed";
  file.status = "ready";
  file.processingError = undefined;

  await file.save();
  emitFileStatus(file);
  logger.info({ originalName: file.originalName, ocrTextLength: ocrText.length, processedTextLength: processedText.length }, "扫描文件处理完成");
}

function classifyOcrDocument(file: ChatFileDocument, text: string): void {
  const sample = text.slice(0, 20000);
  const chars = [...sample].filter((char) => /[\u3400-\u9fff]/u.test(char));
  const traditional = [...sample].filter((char) => /[臺萬與為國學書體門後會見來時無從說實發傅]/u.test(char)).length;
  const classical = (sample.match(/之乎者也、矣焉哉兮於以其乃若夫盖曰/gu) || []).length;
  const punctuation = (sample.match(/[，。！？；：、“”‘’《》]/gu) || []).length;
  const traditionalRatio = chars.length ? traditional / chars.length : 0;
  const classicalRatio = chars.length ? Math.min(classical / chars.length * 35, 1) : 0;
  const punctuationRatio = sample.length ? punctuation / sample.length : 0;
  const verticalHints = /(卷[一二三四五六七八九十百]|第[一二三四五六七八九十百]+卷|序|跋|目錄|目录|版心|魚尾|鱼尾)/u.test(sample);
  const score = Math.min(
    traditionalRatio * 0.35 + classicalRatio * 0.4 + (verticalHints ? 0.2 : 0) + (punctuationRatio < 0.015 ? 0.05 : 0),
    1,
  );
  const type = score >= 0.65 ? "ancient_book" : score >= 0.4 ? "mixed" : "modern_document";
  file.documentType = type;
  file.classificationConfidence = Number(Math.max(score, 1 - score).toFixed(3));
  file.classificationReasons = [
    `繁体字比例 ${(traditionalRatio * 100).toFixed(1)}%`,
    `文言特征 ${classicalRatio >= 0.2 ? "明显" : "较弱"}`,
    verticalHints ? "检测到古籍版式关键词" : "未检测到明显古籍版式关键词",
  ];
}

function emitFileStatus(file: ChatFileDocument): void {
  emitChatFileStatus({
    conversationId: file.conversationId,
    fileId: file._id.toString(),
    name: file.originalName,
    status: file.status,
    processingStage: file.processingStage,
    ...(file.processingError ? { processingError: file.processingError } : {}),
    ...(file.documentType ? { documentType: file.documentType } : {}),
    ...(file.classificationConfidence !== undefined ? { classificationConfidence: file.classificationConfidence } : {}),
    ...(file.classificationReasons?.length ? { classificationReasons: file.classificationReasons } : {}),
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
