import { Router } from "express";
import { authRequired } from "../../middleware/auth.js";
import { ConversationModel } from "../../models/ConversationModel.js";
import { ChatMessageModel } from "../../models/ChatMessageModel.js";
import { ChatFileModel } from "../../models/ChatFileModel.js";
import { logger } from "../../utils/logger.js";
import { toFileProcessingInfo } from "../../services/chat-file-processor.js";

const router = Router();

router.get(
  "/conversations/:conversationId/messages",
  authRequired,
  async (req, res) => {
    try {
      const userId = req.user!.sub;
      const conversationId = req.params.conversationId;

      // 先校验会话归属
      const conversation = await ConversationModel.findOne({
        _id: conversationId,
        participantIds: userId,
        status: "active",
      }).lean();

      if (!conversation) {
        res.status(404).json({
          code: 20004,
          message: "会话不存在或无权访问",
          data: [],
        });
        return;
      }

      const messages = await ChatMessageModel.find({
        conversationId,
        status: "sent",
      })
        .sort({ createdAt: 1 })
        .limit(100)
        .lean();
      const fileIds = [
        ...new Set(
          messages.flatMap(message => message.fileIds ?? []),
        ),
      ];

      const files = fileIds.length > 0 ? await ChatFileModel.find({
        _id: { $in: fileIds },
        conversationId,
        ownerId: userId
      }).lean() : [];

      const fileMap = new Map(
        files.map(file => [file._id.toString(), file]),
      );

      const messagesWithAttachments = messages.map((message) => ({
        ...message,
        attachments: (message.fileIds ?? [])
          .map(fileId => fileMap.get(fileId))
          .filter(Boolean)
          .map(file => (
            {
              fileId: file!._id.toString(),
              name: file!.originalName,
              mimeType: file!.mimeType,
              size: file!.size,
              // 带上处理链路和分类结果，刷新后前端能还原附件的处理步骤
              ...toFileProcessingInfo(file!),
              processingError: file!.processingError??null,
            }
          ))
      }))

      res.json({
        code: 20000,
        message: "查询成功",
        data: messagesWithAttachments,
      });
    } catch (error) {
      logger.error(
        {
          err: error,
          userId: req.user?.sub,
          conversationId: req.params.conversationId,
        },
        "查询历史消息失败",
      );

      res.status(500).json({
        code: 20002,
        message: "查询历史消息失败",
        data: [],
      });
    }
  },
);


export default router;

