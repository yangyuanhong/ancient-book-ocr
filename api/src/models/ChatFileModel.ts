import mongoose, { Schema } from "mongoose";
import type { ChatFileDocument } from "./types/index.js";

const chatFileSchema = new Schema<ChatFileDocument>(
  {
    ownerId: {
      type: String,
      required: true,
      index: true,
    },
    conversationId: {
      type: String,
      required: true,
      index: true,
    },
    originalName: {
      type: String,
      required: true,
      trim: true,
    },
    storedName: {
      type: String,
      required: true,
      unique: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    size: {
      type: Number,
      required: true,
      min: 0,
    },
    path: {
      type: String,
      required: true,
    },
    extractedMarkdown: {
      type: String,
    },
    status: {
      type: String,
      enum: ["uploaded", "processing", "ready", "failed"],
      default: "uploaded",
      required: true,
      index: true,
    },
    ocrRawText: {
      type: String,
    },
    processedText: {
      type: String,
    },
    ocrTaskId: {
      type: String,
    },
    processingStage: {
      type: String,
      enum: ["uploaded", "parsing", "ocr", "correction", "completed", "failed"],
      default: "uploaded",
      index: true,
    },
    processingError: {
      type: String,
    },
    // 实际走的处理链路：document = 直接解析文本，ocr = OCR 识别（图片 / 扫描版 PDF）
    // 前端据此画出对应的步骤链，刷新后也能还原
    processingMode: {
      type: String,
      enum: ["document", "ocr"],
    },
    // 荀子校对失败的原因。校对失败不影响附件可用（回退为 OCR 原文），所以单独记录，不写 processingError
    correctionError: {
      type: String,
    },
    // 扫描版 PDF 的逐页识别进度：共几页、成功几页、失败几页、正在识别第几页
    ocrProgress: {
      type: new Schema(
        {
          pageCount: { type: Number, required: true },
          succeededPages: { type: Number, default: 0 },
          failedPages: { type: Number, default: 0 },
          currentPage: { type: Number },
        },
        { _id: false },
      ),
      default: undefined,
    },
    documentType: {
      type: String,
      enum: ["ancient_book", "modern_document", "mixed", "unknown"],
    },
    classificationConfidence: {
      type: Number,
      min: 0,
      max: 1,
    },
    classificationReasons: {
      type: [String],
      default: undefined,
    },

    error: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

chatFileSchema.index({
  conversationId: 1,
  createdAt: -1,
});

chatFileSchema.index({
  ownerId: 1,
  createdAt: -1,
});

export const ChatFileModel = mongoose.model<ChatFileDocument>(
  "ChatFile",
  chatFileSchema,
);
