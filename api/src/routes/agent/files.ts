import multer from "multer";
import path from "node:path";
import { unlink } from "node:fs/promises";
import { Router, type Request, type Response } from "express";

import { ChatFileModel } from "../../models/ChatFileModel.js";
import { uploadDirectory, uploadSingleFile } from "../../middleware/upload.js";
import { logger } from "../../utils/logger.js";
import { authRequired } from "../../middleware/auth.js";
import { ConversationModel } from "../../models/ConversationModel.js";
import {
  startChatFileProcessing,
  toFileProcessingInfo,
  retryAncientCorrection,
  emitFileStatus,
} from "../../services/chat-file-processor.js";
import { cancelPdfOcrTask } from "../../services/ocr-client.js";

const router = Router();

function runSingleFileUpload(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    uploadSingleFile(req, res, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function removeUploadedFile(filePath: string | undefined): Promise<void> {
  if (!filePath) return;

  try {
    await unlink(filePath);
  } catch (error) {
    logger.warn(
      {
        err: error,
        filePath,
      },
      "删除上传残留文件失败",
    );
  }
}

router.post(
  "/conversations/:conversationId/files",
  authRequired,
  async (req, res) => {
    const userId = req.user!.sub;
    const { conversationId } = req.params;

    try {
      // 必须先验证权限，再允许文件写入磁盘
      const conversation = await ConversationModel.findOne({
        _id: conversationId,
        participantIds: userId,
        status: "active",
      }).lean();

      if (!conversation) {
        res.status(404).json({
          code: 40400,
          message: "会话不存在或无权访问",
          data: null,
        });

        return;
      }

      // 校验通过后，才让Multer接收文件
      await runSingleFileUpload(req, res);

      if (!req.file) {
        res.status(400).json({
          code: 40000,
          message: "请选择要上传的文件",
          data: null,
        });
        return;
      }
      const file = req.file;
      const ancientImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff"]);
      let needsOcr = ancientImageMimeTypes.has(file.mimetype);
      

      const fileRecord = await ChatFileModel.create({
        ownerId: userId,
        conversationId,
        originalName: file.originalname,
        storedName: file.filename,
        mimeType: file.mimetype,
        size: file.size,

        // 数据库保存相对路径，避免绑定本机绝对路径
        path: path.posix.join("uploads", req.file.filename),
        status:"processing",
        processingStage: needsOcr?"ocr":"parsing",
      });

      startChatFileProcessing(fileRecord._id.toString(), file.path);

      logger.info(
        {
          userId,
          conversationId,
          fileId: fileRecord._id.toString(),
          storedName: fileRecord.storedName,
          mimeType: fileRecord.mimeType,
          size: fileRecord.size,
          hasText: false,
        },
        "聊天文件上传成功",
      );

      res.status(201).json({
        code: 20000,
        message: "上传成功",
        data: {
          fileId: fileRecord._id.toString(),
          name: fileRecord.originalName,
          mimeType: fileRecord.mimeType,
          size: fileRecord.size,
          status: fileRecord.status,
          hasText: false,
          createdAt: fileRecord.createdAt,
          processingStage: fileRecord.processingStage,
        },
      });
    } catch (error) {
      // Multer 已经落盘，但数据库写入失败时，删除残留文件
      await removeUploadedFile(req.file?.path);

      logger.error(
        {
          err: error,
          userId,
          conversationId,
          originalName: req.file?.originalname,
        },
        "聊天文件上传失败",
      );

      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          res.status(413).json({
            code: 41300,
            message: "文件不能超过 100MB",
            data: null,
          });

          return;
        }

        if (error.code === "LIMIT_FILE_COUNT") {
          res.status(400).json({
            code: 40001,
            message: "一次只能上传一个文件",
            data: null,
          });

          return;
        }

        res.status(400).json({
          code: 40002,
          message: `文件上传失败：${error.message}`,
          data: null,
        });

        return;
      }

      res.status(400).json({
        code: 40003,
        message: error instanceof Error ? error.message : "文件上传失败",
        data: null,
      });
    }
  },
);

router.get("/conversations/:conversationId/files/:fileId", authRequired, async (req, res) => {
  const userId = req.user!.sub;
  const { conversationId, fileId } = req.params;

  try {
    const file = await ChatFileModel.findOne({
      _id: fileId,
      conversationId,
      ownerId: userId
    }).lean();

    if (!file) {
      res.status(404).json({
        code: 40400,
        message: "文件不存在或无权访问",
        data:null,
      })

      return;
    }

    res.json({
      code: 20000,
      message: "查询成功",
      data: {
        fileId: file._id.toString(),
        name: file.originalName,
        ...toFileProcessingInfo(file),
        processingError: file.processingError || file.error,
        hasOcrText: Boolean(file.ocrRawText),
        hasProcessedText: Boolean(file.processedText),
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
      }
    });
  } catch (error) {
    res.status(500).json({
      code: 50000,
      message: error instanceof Error ? error.message : "查询文件状态失败",
      data: null,
    })
  }
})

router.post("/conversations/:conversationId/files/:fileId/retry",
  authRequired, async (req, res) => {
    const userId = req.user!.sub;
    const { conversationId, fileId } = req.params;

    const file = await ChatFileModel.findOne({
      _id: fileId,
      conversationId,
      ownerId: userId,
    });

    if (!file) {
      res.status(404).json({
        code: 40400,
        message: "文件不存在或无权访问",
        data: null,
      });

      return;
    }

    if (file.status === "processing") {
      res.status(409).json({
        code: 40900,
        message: "文件正在处理中",
        data: null,
      });

      return;
    }

    file.status = "processing";
    const imageMimeTypes = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/bmp",
      "image/tiff",
    ]);
    file.processingStage = file.ocrRawText
      ? "correction"
      : imageMimeTypes.has(file.mimeType)
        ? "ocr"
        : "parsing";
    file.processingError = undefined;
    file.error = undefined;

    await file.save();

    const absoluteFilePath = path.join(
      uploadDirectory,
      file.storedName,
    )

    startChatFileProcessing(
      file._id.toString(),
      absoluteFilePath,
    );

    res.status(202).json({
      code: 20000,
      message: "已重新提交处理",
      data: {
        fileId: file._id.toString(),
        processingStage: file.processingStage,
      }
    })
})

router.post("/conversations/:conversationId/files/:fileId/retry-correction",
  authRequired, async (req, res) => {
    const userId = req.user!.sub;
    const { conversationId, fileId } = req.params;
    try {
      const file = await ChatFileModel.findOne({ _id: fileId, conversationId, ownerId: userId });
      if (!file) return res.status(404).json({ code: 40400, message: "文件不存在或无权访问", data: null });
      if (file.documentType !== "ancient_book" || !file.ocrRawText?.trim()) {
        return res.status(409).json({ code: 40900, message: "当前文件没有可重试的古籍 OCR 校正", data: null });
      }
      if (file.status === "processing") {
        return res.status(409).json({ code: 40900, message: "文件正在处理中", data: null });
      }
      file.status = "processing";
      file.processingStage = "correction";
      file.processingError = undefined;
      file.correctionError = undefined;
      file.error = undefined;
      await file.save();
      // 立即推送“校对中”，前端荀子节点据此回到加载状态
      emitFileStatus(file);

      void retryAncientCorrection(file._id.toString()).catch(async (error) => {
        logger.error({ err: error, fileId }, "重试荀子校正失败");
        // 兜底：意外异常也要把节点打回失败，不能一直转圈
        const message = error instanceof Error ? error.message : "荀子模型调用失败";
        const failed = await ChatFileModel.findByIdAndUpdate(
          fileId,
          { $set: { status: "ready", processingStage: "completed", correctionError: message } },
          { new: true },
        ).catch(() => null);
        if (failed) emitFileStatus(failed);
      });

      return res.status(202).json({
        code: 20000,
        message: "已重新提交荀子校正",
        data: { fileId: file._id.toString(), processingStage: file.processingStage },
      });
    } catch (error) {
      logger.error({ err: error, userId, conversationId, fileId }, "重试荀子校正失败");
      return res.status(500).json({ code: 50000, message: "重试荀子校正失败", data: null });
    }
  });

/**
 * PDF 已经创建 OCR 任务：调用 OCR 服务取消；
 * 图片或尚未创建 OCR 任务：直接把 Node 文件状态标记为失败；
 * 已经完成的文件不能取消；
 * ocrRawText 已保存时仍然保留，后续可以重新处理。
 */
router.post(
  "/conversations/:conversationId/files/:fileId/cancel",
  authRequired,
  async (req, res) => {
    const userId = req.user!.sub;
    const { conversationId, fileId } = req.params;

    try {
      const file = await ChatFileModel.findOne({
        _id: fileId,
        conversationId,
        ownerId: userId,
      });

      if (!file) {
        res.status(404).json({
          code: 40400,
          message: "文件不存在或无权访问",
          data: null,
        });
        return;
      }

      if (file.status !== "processing") {
        res.status(409).json({
          code: 40900,
          message: "当前文件不在处理中",
          data: {
            fileId: file._id.toString(),
            status: file.status,
            processingStage: file.processingStage,
          },
        });
        return;
      }

      if (file.ocrTaskId) {
        await cancelPdfOcrTask(file.ocrTaskId);
      }

      file.status = "failed";
      file.processingStage = "failed";
      file.processingError = "用户取消了文件处理";
      file.error = "用户取消了文件处理";

      await file.save();

      res.status(202).json({
        code: 20000,
        message: "文件处理已取消",
        data: {
          fileId: file._id.toString(),
          status: file.status,
          processingStage: file.processingStage,
          processingError: file.processingError,
        },
      });
    } catch (error) {
      logger.error(
        {
          err: error,
          userId,
          conversationId,
          fileId,
        },
        "取消文件处理失败",
      );

      res.status(500).json({
        code: 50000,
        message:
          error instanceof Error
            ? error.message
            : "取消文件处理失败",
        data: null,
      });
    }
  },
);
export default router;

