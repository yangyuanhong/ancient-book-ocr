import { Router } from "express";
import { authRequired } from "../../middleware/auth.js";
import { ConversationModel } from "../../models/ConversationModel.js";
import { ToolCallModel } from "../../models/ToolCallModel.js";
import { logger } from "../../utils/logger.js";

const router = Router();

router.get(
  "/conversations/:conversationId/tool-calls",
  authRequired,
  async (req, res) => {
    try {
      const userId = req.user?.sub;
      const { conversationId } = req.params;

      const conversation = await ConversationModel.findOne({
        _id: conversationId,
        participantIds: userId,
        status: "active",
      });

      if (!conversation) {
        return res.status(404).json({
          code: 40400,
          message: "会话不存在或无权访问",
        });
      }

      const records = await ToolCallModel.find({
        conversationId,
        userId,
      })
        .sort({ createdAt: 1 })
        .lean();

      return res.json({
        code: 20000,
        message: "查询成功",
        data: records,
      });
    } catch (error) {
      logger.error(
        {
          err: error,
          userId: req.user?.sub,
          conversationId: req.params.conversationId,
        },
        "查询 Tool 调用记录失败",
      );

      return res.status(500).json({
        code: 50000,
        message: "查询 Tool 调用记录失败",
      });
    }
  },
);

export default router;

