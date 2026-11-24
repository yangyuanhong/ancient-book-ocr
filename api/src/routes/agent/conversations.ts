import { Router } from "express";
import { authRequired } from "../../middleware/auth.js";
import { isEmptyObject } from "../../utils/index.js";
import { ConversationModel } from "../../models/ConversationModel.js";
import { logger } from "../../utils/logger.js";

const router = Router();

// 创建会话路由
router.post("/conversations", authRequired, async (req, res) => {
  const body = !isEmptyObject(req.body) ? req.body : req.query;
  try {
    const userId = req.user!.sub;
    const data = await ConversationModel.create({
      title: body.title || "新对话",
      ownerId: userId,
      participantIds: [userId],
      type: "agent",
      status: "active",
    });
    res.json({
      code: 20000,
      message: "创建成功",
      data: data,
    });
  } catch (error) {
    res.status(500).json({
      code: 20002,
      message: "创建失败",
      data: null,
    });
  }
});

router.get("/conversations", authRequired, async (req, res) => {
  try {
    const userId = req.user!.sub;

    const keyword = String(req.query.keyword ?? "").trim();
    const conversations = await ConversationModel.find({
      participantIds: userId,
      status: "active",
      ...(keyword ? { title: { $regex: keyword, $options: "i" } } : {}),
    })
      .sort({ updatedAt: -1 })
      .lean();

    res.json({
      code: 20000,
      message: "查询成功",
      data: conversations,
    });
  } catch (error) {
    logger.error(
      {
        err: error,
        userId: req.user?.sub,
      },
      "查询会话失败",
    );

    res.status(500).json({
      code: 20002,
      message: "查询会话失败",
      data: [],
    });
  }
});

router.patch("/conversations/:conversationId", authRequired, async (req, res) => {
  const title = String(req.body?.title ?? "").trim();
  if (!title || title.length > 30) {
    res.status(400).json({ code: 40000, message: "会话名称无效", data: null });
    return;
  }
  try {
    const conversation = await ConversationModel.findOneAndUpdate(
      { _id: req.params.conversationId, participantIds: req.user!.sub, status: "active" },
      { $set: { title } },
      { new: true, runValidators: true },
    ).lean();
    if (!conversation) {
      res.status(404).json({ code: 40400, message: "会话不存在或无权访问", data: null });
      return;
    }
    res.json({ code: 20000, message: "更新成功", data: conversation });
  } catch (error) {
    logger.error({ err: error, conversationId: req.params.conversationId }, "更新会话失败");
    res.status(500).json({ code: 50000, message: "更新失败", data: null });
  }
});

router.delete("/conversations/:conversationId", authRequired, async (req, res) => {
  const conversation = await ConversationModel.findOneAndUpdate(
    { _id: req.params.conversationId, participantIds: req.user!.sub, status: "active" },
    { $set: { status: "archived" } }, { new: true },
  ).lean();
  if (!conversation) { res.status(404).json({ code: 40400, message: "会话不存在或无权访问", data: null }); return; }
  res.json({ code: 20000, message: "删除成功", data: conversation });
});


export default router;

