import type {
  AppSocket,
  AppSocketServer,
  CancelGenerationPayload,
  ResumeGenerationResult,
  SendMessagePayload,
  SendMessageResult,
  SimpleResult,
} from "./types/index.js";
import { streamAgent, streamToolAgent } from "../agent/index.js";
import { DEFAULT_MODEL_NAME } from "../agent/model.js";
import type { ReasoningEffort } from "../agent/types/index.js";
import {
  findConversationGeneration,
  finishGeneration,
  getGeneration,
  startGeneration,
  type ActiveGeneration,
} from "../agent/generation-registry.js";
import { ConversationModel } from "../models/ConversationModel.js";
import { ChatMessageModel } from "../models/ChatMessageModel.js";
import { AIMessage, HumanMessage, SystemMessage } from "langchain";
import { ToolCallModel } from "../models/ToolCallModel.js";
import { logger } from "../utils/logger.js";
import mongoose from "mongoose";
import { ChatFileModel } from "../models/ChatFileModel.js";

const systemMessage = new SystemMessage(
  "你是一个友好的中文智能助手，回答要清晰、简洁、准确。",
);


function positiveEnvInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const MAX_ATTACHMENT_CHARS_PER_FILE = positiveEnvInt(
  "AGENT_MAX_ATTACHMENT_CHARS_PER_FILE",
  20_000,
);
const MAX_ATTACHMENT_CHARS_TOTAL = positiveEnvInt(
  "AGENT_MAX_ATTACHMENT_CHARS_TOTAL",
  60_000,
);

// 与前端 ModelSelector 的选项保持一致；不在白名单内的值一律回退默认，防止客户端随意指定模型
const ALLOWED_MODELS = new Set([
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
]);
const ALLOWED_REASONING_EFFORTS = new Set<ReasoningEffort>([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

function resolveModelOptions(payload: SendMessagePayload): {
  modelName: string;
  reasoningEffort?: ReasoningEffort;
} {
  const modelName =
    payload.modelName && ALLOWED_MODELS.has(payload.modelName)
      ? payload.modelName
      : DEFAULT_MODEL_NAME;
  const reasoningEffort = ALLOWED_REASONING_EFFORTS.has(
    payload.reasoningEffort as ReasoningEffort,
  )
    ? (payload.reasoningEffort as ReasoningEffort)
    : undefined;

  return { modelName, reasoningEffort };
}

function parseToolResult(result: string): unknown {
  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}

function emitAgentError(
  io: AppSocketServer,
  conversationId: string,
  messageId: string,
  error: unknown,
): void {
  io.to(conversationId).emit("agent:error", {
    conversationId,
    messageId,
    error: getPublicAgentError(error),
  });
}

async function handleChatSend(
  io: AppSocketServer,
  payload: SendMessagePayload,
  callback: (result: SendMessageResult) => void,
  socket: AppSocket,
): Promise<void> {
  const content = payload.content.trim();
  const userId = socket.data.user.sub;

  if (!payload.conversationId || (!content && !payload.fileIds?.length)) {
    callback({
      success: false,
      error: "conversationId 和 content 不能为空",
    });
    return;
  }

  const messageId = crypto.randomUUID();
  let generation: ActiveGeneration | undefined;
  let fullAnswer = "";

  try {
    // 1. 查询并校验当前用户是否属于这个会话
    const conversation = await ConversationModel.findOne({
      _id: payload.conversationId,
      participantIds: userId,
      status: "active",
    });

    if (!conversation) {
      callback({
        success: false,
        error: "会话不存在或无权访问",
      });
      return;
    }

    // 同一会话同一时间只允许一条回复在生成，避免中断/恢复时对不上
    if (findConversationGeneration(payload.conversationId, userId)) {
      callback({
        success: false,
        error: "上一条回复还在生成中，请先等待或停止",
      });
      return;
    }

    const fileIds = [...new Set(payload.fileIds ?? [])];
    const messageContent = content || "请分析我上传的附件";

    if (fileIds.length > 5) {
      callback({
        success: false,
        error: "一条消息最多关联 5 个附件",
      });

      return;
    }

    const hasInvalidFileId = fileIds.some(
      (fileId) => !mongoose.isValidObjectId(fileId),
    );

    if (hasInvalidFileId) {
      callback({
        success: false,
        error: "附件 ID 格式错误",
      });

      return;
    }

    if (fileIds.length > 0) {
      const ownedFileCount = await ChatFileModel.countDocuments({
        _id: {
          $in: fileIds,
        },
        conversationId: payload.conversationId,
        ownerId: userId,
        status: {
          $in: ["uploaded", "processing", "ready"],
        },
      });

      if (ownedFileCount !== fileIds.length) {
        callback({
          success: false,
          error: "附件不存在或无权访问",
        });

        return;
      }
    }

    // 2、保存用户消息
    const userMessage = {
      conversationId: payload.conversationId,
      senderId: userId,
      role: "user",
      content: messageContent,
      fileIds,
      status: "sent",
      ...(payload.clientMessageId?.trim()
        ? { clientMessageId: payload.clientMessageId.trim() }
        : {}),
    };

    await ChatMessageModel.create(userMessage);

    // 3、查询最近20条历史
    const historyRecords = await ChatMessageModel.find({
      conversationId: payload.conversationId,
      status: "sent",
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    historyRecords.reverse();

    const historyFileIds = [
      ...new Set(historyRecords.flatMap((item) => item.fileIds ?? [])),
    ];
    const historyFiles =
      historyFileIds.length > 0
        ? await ChatFileModel.find({
            _id: {
              $in: historyFileIds,
            },
            conversationId: payload.conversationId,
            ownerId: userId,
          }).lean()
        : [];

    const fileMap = new Map(
      historyFiles.map((file) => [file._id.toString(), file]),
    );
    let remainingAttachmentChars = MAX_ATTACHMENT_CHARS_TOTAL;

    // 4、转成LangChain消息
    const history = historyRecords
      .filter((item) => item.role === "user" || item.role === "assistant")
      .map((item) => {
        if (item.role === "assistant") {
          return new AIMessage(item.content);
        }

        const attachedFiles = (item.fileIds ?? [])
          .map((fileId) => fileMap.get(fileId))
          .filter((file) => Boolean(file));

        if (attachedFiles.length === 0) {
          return new HumanMessage(item.content);
        }

        const attachmentDescription = attachedFiles
          .map((file) => {
            const text = getAttachmentText(
              file?.extractedMarkdown,
              Math.min(MAX_ATTACHMENT_CHARS_PER_FILE, remainingAttachmentChars),
            );
            if (file?.extractedMarkdown) {
              remainingAttachmentChars = Math.max(
                0,
                remainingAttachmentChars -
                  Math.min(
                    file.extractedMarkdown.length,
                    MAX_ATTACHMENT_CHARS_PER_FILE,
                    remainingAttachmentChars,
                  ),
              );
            }

            return [
              `文件名：${file!.originalName}`,
              `类型：${file!.mimeType}`,
              "文件正文：",
              text,
            ].join("\n");
          })
          .join("\n\n");

        return new HumanMessage(
          [
            item.content,
            "",
            "[用户随消息上传了以下附件]",
            attachmentDescription,
          ].join("\n"),
        );
      });
    

    // 5. 登记进行中的生成（供中断和断线恢复使用），再告诉前端服务端已接收
    generation = startGeneration({
      messageId,
      conversationId: payload.conversationId,
      userId,
    });

    callback({
      success: true,
      messageId,
    });

    // 6、流式调用Agent
    // for await (const delta of streamAgent([systemMessage, ...history])) {
    //   fullAnswer += delta;

    //   io.to(payload.conversationId).emit("agent:delta", {
    //     conversationId: payload.conversationId,
    //     messageId,
    //     delta,
    //     done: false,
    //   });
    // }
    // 进入循环之前保存 Tool 开始时间
    const toolStartedAtMap = new Map<string, Date>();

    // 使用带工具的agent流式输出
    const { modelName, reasoningEffort } = resolveModelOptions(payload);

    for await (const event of streamToolAgent(
      [...history],
      userId,
      modelName,
      reasoningEffort,
      generation.controller.signal,
    )) {
      if (event.type === "tool-start") {
        const startedAt = new Date();
        toolStartedAtMap.set(event.toolCallId, startedAt);
        //使用 findOneAndUpdate + upsert，可以防止流式消息重复产生 Tool Start 时插入多条记录
        await ToolCallModel.findOneAndUpdate(
          {
            conversationId: payload.conversationId,
            toolCallId: event.toolCallId,
          },
          {
            $setOnInsert: {
              conversationId: payload.conversationId,
              messageId,
              userId,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              input: event.input,
              status: "running",
              startedAt,
            },
          },
          {
            upsert: true,
            new: true,
          },
        );

        logger.info(
          {
            conversationId: payload.conversationId,
            messageId,
            userId,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
          },
          "Tool 开始执行",
        );

        io.to(payload.conversationId).emit("agent:tool-start", {
          conversationId: payload.conversationId,
          messageId,
          toolName: event.toolName,
        });

        continue;
      }

      if (event.type === "tool-end") {
        const finishedAt = new Date();
        const startedAt = toolStartedAtMap.get(event.toolCallId);

        await ToolCallModel.findOneAndUpdate(
          {
            conversationId: payload.conversationId,
            toolCallId: event.toolCallId,
          },
          {
            $set: {
              output: parseToolResult(event.result || ""),
              status: "success",
              finishedAt,
              durationMs: startedAt
                ? finishedAt.getTime() - startedAt.getTime()
                : undefined,
            },
          },
        );

        logger.info(
          {
            conversationId: payload.conversationId,
            messageId,
            userId,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            durationMs: startedAt
              ? finishedAt.getTime() - startedAt.getTime()
              : undefined,
          },
          "Tool 执行完成",
        );
        io.to(payload.conversationId).emit("agent:tool-end", {
          conversationId: payload.conversationId,
          messageId,
          toolName: event.toolName,
          result: event.result,
        });

        continue;
      }


      if (event.type !== "text" || !event.content) {
        continue;
      }

      fullAnswer += event.content;
      generation.content = fullAnswer;
      generation.sequence += 1;

      io.to(payload.conversationId).emit("agent:delta", {
        conversationId: payload.conversationId,
        messageId,
        delta: event.content,
        done: false,
        sequence: generation.sequence,
      });
    }

    const cancelled = generation.controller.signal.aborted;
    await saveAssistantAnswer(payload.conversationId, fullAnswer, cancelled);
    if (cancelled) await markRunningToolsCancelled(payload.conversationId, messageId);

    io.to(payload.conversationId).emit("agent:delta", {
      conversationId: payload.conversationId,
      messageId,
      delta: "",
      done: true,
      sequence: generation.sequence,
      status: cancelled ? "cancelled" : "completed",
    });
  } catch (error) {
    // 中断时底层请求会抛 AbortError：按“已停止”收尾，保留已生成的部分内容
    if (generation?.controller.signal.aborted) {
      try {
        await saveAssistantAnswer(payload.conversationId, fullAnswer, true);
        await markRunningToolsCancelled(payload.conversationId, messageId);
      } catch (persistError) {
        logger.error({ err: persistError, messageId }, "保存已中断回复失败");
      }

      io.to(payload.conversationId).emit("agent:delta", {
        conversationId: payload.conversationId,
        messageId,
        delta: "",
        done: true,
        sequence: generation.sequence,
        status: "cancelled",
      });
      return;
    }

    logger.error(
      {
        err: error,
        conversationId: payload.conversationId,
        messageId,
        userId,
      },
      "Agent 调用失败",
    );
    const errorMessage =
      
      (error instanceof Error ? error.message : "Agent 回复失败");
   
    try {
      await ToolCallModel.updateMany(
        {
          conversationId: payload.conversationId,
          messageId,
          status: "running",
        },
        {
          $set: {
            status: "failed",
            error: errorMessage,
            finishedAt: new Date(),
          },
        },
      );
    } catch (persistError) {
      logger.error(
        {
          err: persistError,
          conversationId: payload.conversationId,
          messageId,
        },
        "更新 Tool 失败状态失败",
      );
    }

    emitAgentError(io, payload.conversationId, messageId, error);
  } finally {
    // 无论完成、中断还是失败都要移除，否则该会话会一直被判定为“生成中”
    if (generation) finishGeneration(messageId);
  }
}

/** 保存助手回复；中断时只有已生成内容才落库，避免产生空消息 */
async function saveAssistantAnswer(
  conversationId: string,
  content: string,
  cancelled: boolean,
): Promise<void> {
  if (cancelled && !content.trim()) return;

  await ChatMessageModel.create({
    conversationId,
    senderId: "assistant",
    role: "assistant",
    content: cancelled ? `${content}\n\n（已停止生成）` : content,
    status: "sent",
  });
}

async function markRunningToolsCancelled(
  conversationId: string,
  messageId: string,
): Promise<void> {
  await ToolCallModel.updateMany(
    { conversationId, messageId, status: "running" },
    {
      $set: {
        status: "failed",
        error: "用户已停止生成",
        finishedAt: new Date(),
      },
    },
  );
}

/** 中断：只有发起这次生成的用户本人可以停止 */
function handleChatCancel(
  payload: CancelGenerationPayload,
  socket: AppSocket,
  callback?: (result: SimpleResult) => void,
): void {
  const userId = socket.data.user.sub;
  const generation = payload?.messageId
    ? getGeneration(payload.messageId)
    : findConversationGeneration(payload?.conversationId, userId);

  if (
    !generation ||
    generation.userId !== userId ||
    generation.conversationId !== payload.conversationId
  ) {
    callback?.({ success: false, error: "没有正在生成的回复" });
    return;
  }

  logger.info(
    { conversationId: generation.conversationId, messageId: generation.messageId, userId },
    "用户停止生成",
  );
  generation.controller.abort();
  callback?.({ success: true });
}

/**
 * 断线恢复：刷新页面、网络重连或切回会话后调用。
 * 校验会话归属后重新加入房间，并返回进行中回复的当前快照，后续 delta 继续实时推送。
 */
/** 当前用户是否是该会话的参与者；非法 id 直接返回 false，避免 Mongoose CastError */
async function canAccessConversation(
  conversationId: unknown,
  userId: string,
): Promise<boolean> {
  if (typeof conversationId !== "string" || !mongoose.isValidObjectId(conversationId)) {
    return false;
  }

  const conversation = await ConversationModel.exists({
    _id: conversationId,
    participantIds: userId,
    status: "active",
  });
  return Boolean(conversation);
}

/**
 * 加入会话房间。房间里会广播该会话的回复内容和文件状态，
 * 必须先校验归属，否则任何登录用户只要知道会话 id 就能旁听别人的对话。
 */
async function handleChatJoin(
  conversationId: string,
  socket: AppSocket,
  callback?: (result: SimpleResult) => void,
): Promise<void> {
  const userId = socket.data.user.sub;

  try {
    if (!(await canAccessConversation(conversationId, userId))) {
      logger.warn({ conversationId, userId }, "拒绝加入无权访问的会话房间");
      callback?.({ success: false, error: "会话不存在或无权访问" });
      return;
    }

    await socket.join(conversationId);
    callback?.({ success: true });
  } catch (error) {
    logger.error({ err: error, conversationId, userId }, "加入会话房间失败");
    callback?.({ success: false, error: "加入会话失败" });
  }
}

async function handleChatResume(
  conversationId: string,
  socket: AppSocket,
  callback: (result: ResumeGenerationResult) => void,
): Promise<void> {
  const userId = socket.data.user.sub;

  try {
    if (!(await canAccessConversation(conversationId, userId))) {
      callback({ success: false, error: "会话不存在或无权访问" });
      return;
    }

    // 先入房间再取快照：保证快照之后产生的 delta 一定能收到，重复部分由前端按 sequence 丢弃
    await socket.join(conversationId);
    const generation = findConversationGeneration(conversationId, userId);

    callback({
      success: true,
      generation: generation
        ? {
            messageId: generation.messageId,
            content: generation.content,
            sequence: generation.sequence,
          }
        : null,
    });
  } catch (error) {
    logger.error({ err: error, conversationId, userId }, "恢复生成状态失败");
    callback({ success: false, error: "恢复生成状态失败" });
  }
}

function getProviderError(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as Record<string, unknown>;
  const response = value.response as Record<string, unknown> | undefined;
  const data = response?.data as Record<string, unknown> | undefined;
  const nested = data?.error as Record<string, unknown> | undefined;
  const message = nested?.message ?? data?.message ?? value.message;
  return typeof message === "string" ? message : undefined;
}

function getAttachmentText(text: string | undefined, limit: number): string {
  if (!text?.trim()) return "文件正文尚未解析";
  if (limit <= 0) return "文件正文过大，已跳过正文内容";
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[文件正文过大，已截断，未发送剩余内容]`;
}

export function registerSocketHandlers(
  io: AppSocketServer,
  socket: AppSocket,
): void {
  socket.on("chat:join", (conversationId, callback) => {
    void handleChatJoin(conversationId, socket, callback);
  });

  socket.on("chat:send", (payload, callback) => {
    void handleChatSend(io, payload, callback, socket);
  });

  socket.on("chat:cancel", (payload, callback) => {
    handleChatCancel(payload, socket, callback);
  });

  socket.on("chat:resume", (conversationId, callback) => {
    void handleChatResume(conversationId, socket, callback);
  });

  socket.on("chat:leave", (conversationId) => {
    socket.leave(conversationId);
  });
}

function getPublicAgentError(error: unknown): string {
  const originalMessage = error instanceof Error ? error.message : "";

  if (originalMessage.toLowerCase().includes("overloaded")) {
    return "模型服务当前繁忙，请稍后重试。附件已经上传成功。";
  }

  return originalMessage || "Agent 回复失败";
}
