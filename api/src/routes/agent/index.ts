import { Router } from "express";
import conversationsRouter from "./conversations.js";
import messagesRouter from "./messages.js";
import toolCallsRouter from "./tool-calls.js";
import filesRouter from "./files.js";

const router = Router();

router.use(filesRouter);
router.use(conversationsRouter);
router.use(messagesRouter);
router.use(toolCallsRouter);

export default router;
