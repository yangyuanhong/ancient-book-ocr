import type {
  ChatFileItem,
  ActiveChatLike,
  FileProcessingInfo,
  MessageFileModel,
  MessageModel,
  User,
} from "@/views/agent/types";
import { message } from "ant-design-vue";
import { type Ref } from "vue";
import { getSocket, sendChatMessage, type FileStatusPayload } from "@/utils/socket";
import { getConversationFile, uploadConversationFile } from "@/api/agent";
import type { UploadedChatFileDto } from "../types";
import { getDisplayName, toFileProcessing } from "@/views/agent/utils"

export interface SendPayload {
  content: string;
  files: ChatFileItem[];
  mentionedUsers: Array<{ id: string }>;
  modelName?: string;
  reasoningEffort?: string;
}

export async function sendMessage(
  payload: SendPayload,
  activeChat: Ref<ActiveChatLike>,
  messagesText: Ref<MessageModel[]>,
  currentUser: User,
  assistantUser: User,
): Promise<void> {
  if (!activeChat.value.id) {
    message.error("会话尚未加载完成");
    return;
  }

  const content = payload.content.trim();
  if (!content && payload.files.length === 0) return;

  const conversationId = activeChat.value.id;
  const messageContent = content || "请分析我上传的附件";
  const clientMessageId = crypto.randomUUID();
  const pendingAgentMessageId = `pending-agent-${clientMessageId}`;
  const hasFiles = payload.files.length > 0;

  // 1. 用户消息立即上屏；有附件时文件卡片从 0% 开始显示上传进度
  messagesText.value.push({
    id: clientMessageId,
    sender: currentUser,
    content: messageContent,
    files: payload.files.map(toPendingMessageFile),
    createdAt: new Date().toISOString(),
    status: hasFiles ? "sending" : "sent",
  });
  activeChat.value.typingUsers = [{ id: assistantUser.id }];

  let uploadedFiles: UploadedChatFileDto[] = [];
  const ctx: PendingSend = {
    conversationId,
    clientMessageId,
    pendingAgentMessageId,
    messageContent,
    fileIds: [],
    modelName: payload.modelName,
    reasoningEffort: payload.reasoningEffort,
  };

  if (hasFiles) {
    // 2. 逐个上传，进度写回用户气泡上方对应的文件卡片。
    //    只有这一步失败才算“发送失败”，标在用户消息上
    try {
      uploadedFiles = await uploadMessageFiles(conversationId, payload.files, (index, patch) =>
        patchUserFile(messagesText, clientMessageId, index, patch),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "附件上传失败";
      patchMessage(messagesText, clientMessageId, { status: "failed" });
      activeChat.value.typingUsers = [];
      message.error(reason);
      return;
    } finally {
      // 上传结束（成功或失败）后释放本地预览 URL，避免内存泄漏
      for (const file of payload.files) {
        if (file.localUrl) URL.revokeObjectURL(file.localUrl);
      }
    }

    // 上传成功，用户这条消息就算发出去了；后面的解析 / OCR 是 agent 的工作
    patchMessage(messagesText, clientMessageId, { status: "sent" });

    // 3. 助手气泡出现，上方展示处理附件的步骤（解析 / OCR / 荀子校对）；
    //    步骤数据取自上一条用户消息的附件，见 ChatRoom
    messagesText.value.push({
      id: pendingAgentMessageId,
      sender: assistantUser,
      content: "📎 正在处理附件…",
      createdAt: new Date().toISOString(),
      status: "sending",
    });

    ctx.fileIds = uploadedFiles.map((file) => file.fileId);

    let correctionFailed: boolean;
    try {
      correctionFailed = await waitForAllFilesReady(ctx, uploadedFiles);
    } catch (error) {
      // 处理失败是 agent 这边的问题：步骤链已标红具体哪一步，气泡里说明原因，
      // 不标“发送失败”（用户消息已经发出去了）
      const reason = error instanceof Error ? error.message : "附件处理失败";
      patchMessage(messagesText, pendingAgentMessageId, {
        status: "sent",
        content: `附件处理失败：${reason}\n\n可以重新上传，或换一个文件再试。`,
      });
      activeChat.value.typingUsers = [];
      return;
    }

    // 荀子校对失败：先不调用主模型，等用户点重试，成功后由 continueAfterCorrectionRetry 继续
    if (correctionFailed) {
      waitForCorrectionRetry(ctx, messagesText, activeChat);
      return;
    }
  }

  dispatchAgentMessage(ctx, messagesText, activeChat, assistantUser);
}

/** 一条待调用主模型的消息；荀子校对失败时暂存，重试成功后继续发送 */
interface PendingSend {
  conversationId: string;
  clientMessageId: string;
  pendingAgentMessageId: string;
  messageContent: string;
  fileIds: string[];
  modelName?: string;
  reasoningEffort?: string;
}

/** fileId → 等待荀子重试的消息。只存在内存里，刷新页面后丢失 */
const pendingSends = new Map<string, PendingSend>();

const correctionFailedText =
  "荀子大模型校对失败，点击上方「重试荀子校正」，成功后会自动继续分析。";

/**
 * 等所有附件处理结束，返回是否有古籍的荀子校对失败。
 * 处理本身失败（OCR 出错等）时抛错。
 */
async function waitForAllFilesReady(
  ctx: PendingSend,
  files: Array<{ fileId: string } & Partial<FileProcessingInfo>>,
): Promise<boolean> {
  let correctionFailed = false;
  for (const file of files) {
    const info =
      file.status === "ready" ? file : await waitForUploadedFileReady(ctx.conversationId, file.fileId);
    if (info.correctionError) {
      correctionFailed = true;
      pendingSends.set(file.fileId, ctx);
    }
  }
  return correctionFailed;
}

function waitForCorrectionRetry(
  ctx: PendingSend,
  messagesText: Ref<MessageModel[]>,
  activeChat: Ref<ActiveChatLike>,
): void {
  patchMessage(messagesText, ctx.pendingAgentMessageId, {
    status: "sent",
    content: correctionFailedText,
  });
  activeChat.value.typingUsers = [];
}

/**
 * 点击“重试荀子校正”并且接口已受理后调用：
 * 等这条消息的附件重新处理完，校对成功就接着调用主模型，仍失败就继续等下一次重试。
 */
export async function continueAfterCorrectionRetry(
  conversationId: string,
  fileId: string,
  messagesText: Ref<MessageModel[]>,
  activeChat: Ref<ActiveChatLike>,
  assistantUser: User,
): Promise<void> {
  const ctx = pendingSends.get(fileId);
  if (!ctx || ctx.conversationId !== conversationId) return;

  patchMessage(messagesText, ctx.pendingAgentMessageId, {
    status: "sending",
    content: "📎 正在校对附件…",
  });
  activeChat.value.typingUsers = [{ id: assistantUser.id }];

  // 先把本条消息的暂存全部清掉，再按最新结果重新登记仍失败的附件
  for (const id of ctx.fileIds) pendingSends.delete(id);

  let correctionFailed: boolean;
  try {
    correctionFailed = await waitForAllFilesReady(
      ctx,
      ctx.fileIds.map((id) => ({ fileId: id })),
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "附件处理失败";
    patchMessage(messagesText, ctx.pendingAgentMessageId, {
      status: "sent",
      content: `附件处理失败：${reason}\n\n可以重新上传，或换一个文件再试。`,
    });
    activeChat.value.typingUsers = [];
    return;
  }

  if (correctionFailed) {
    waitForCorrectionRetry(ctx, messagesText, activeChat);
    return;
  }

  dispatchAgentMessage(ctx, messagesText, activeChat, assistantUser);
}

/** 助手气泡进入“思考中”并调用主模型；有附件时沿用同一个气泡，处理步骤会一直保留在回答上方 */
function dispatchAgentMessage(
  ctx: PendingSend,
  messagesText: Ref<MessageModel[]>,
  activeChat: Ref<ActiveChatLike>,
  assistantUser: User,
): void {
  const thinking = { content: "💭 正在思考…", status: "sending" as const };
  if (!patchMessage(messagesText, ctx.pendingAgentMessageId, thinking)) {
    messagesText.value.push({
      id: ctx.pendingAgentMessageId,
      sender: assistantUser,
      createdAt: new Date().toISOString(),
      ...thinking,
    });
  }
  activeChat.value.typingUsers = [{ id: assistantUser.id }];

  sendChatMessage(
    {
      conversationId: ctx.conversationId,
      content: ctx.messageContent,
      fileIds: ctx.fileIds,
      clientMessageId: ctx.clientMessageId,
      modelName: ctx.modelName,
      reasoningEffort: ctx.reasoningEffort,
    },
    (result) => {
      if (!result.success || !result.messageId) {
        patchMessage(messagesText, ctx.pendingAgentMessageId, {
          status: "failed",
          content: `❌ ${result.error || "回复失败"}`,
        });
        activeChat.value.typingUsers = [];
        return;
      }
      // 换成服务端的 messageId，后续 delta 按它追加
      patchMessage(messagesText, ctx.pendingAgentMessageId, { id: result.messageId });
    },
  );
}

/** 按 id 替换整条消息（splice 新对象，保证 Bubble.List 的 computed 能感知） */
function patchMessage(
  messagesText: Ref<MessageModel[]>,
  id: string,
  patch: Partial<MessageModel>,
): boolean {
  const index = messagesText.value.findIndex((item) => item.id === id);
  if (index < 0) return false;
  messagesText.value.splice(index, 1, { ...messagesText.value[index], ...patch });
  return true;
}

/** 更新用户消息里第 index 个附件（上传进度、上传结果） */
function patchUserFile(
  messagesText: Ref<MessageModel[]>,
  messageId: string,
  index: number,
  patch: Partial<MessageFileModel>,
): void {
  const current = messagesText.value.find((item) => item.id === messageId);
  if (!current?.files?.[index]) return;
  const files = [...current.files];
  files[index] = { ...files[index], ...patch };
  patchMessage(messagesText, messageId, { files });
}

function toPendingMessageFile(file: ChatFileItem): MessageFileModel {
  return {
    name: getDisplayName(file.name),
    type: file.type,
    extension: file.extension,
    size: file.size,
    url: "",
    previewable: false,
    progress: 0,
    uploadStatus: "uploading",
  };
}

/** 逐个上传附件，通过 onUpdate 把第 index 个文件的进度 / 结果写回界面 */
async function uploadMessageFiles(
  conversationId: string,
  files: ChatFileItem[],
  onUpdate: (index: number, patch: Partial<MessageFileModel>) => void,
): Promise<UploadedChatFileDto[]> {
  const uploadedFiles: UploadedChatFileDto[] = [];

  for (const [index, file] of files.entries()) {
    try {
      if (!file.blob) throw new Error(`无法读取文件：${file.name}`);

      const response = await uploadConversationFile(
        conversationId,
        file.blob,
        file.name,
        // 99% 封顶：字节发完后还要等服务端落库返回，拿到响应才算真正完成
        (percent) => onUpdate(index, { progress: Math.min(percent, 99) }),
      );

      uploadedFiles.push(response.data);
      onUpdate(index, {
        progress: 100,
        uploadStatus: "done",
        // 带上 fileId 和处理状态：之后的 file:status 按 fileId 更新这里，
        // 助手气泡从这条用户消息读取附件来画处理步骤
        fileId: response.data.fileId,
        processing: toFileProcessing(response.data),
      });
    } catch (error) {
      onUpdate(index, { uploadStatus: "error" });
      throw error;
    }
  }

  return uploadedFiles;
}

async function waitForUploadedFileReady(
  conversationId: string,
  fileId: string,
): Promise<FileProcessingInfo> {
  const socket = getSocket();
  const deadline = Date.now() + 30 * 60 * 1000;
  let timer: number | undefined;

  // 返回最终处理状态，调用方据此判断荀子校对是否失败
  return new Promise<FileProcessingInfo>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      socket.off("file:status", onStatus);
      if (timer !== undefined) window.clearTimeout(timer);
    };
    const finish = (result: FileProcessingInfo | Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      result instanceof Error ? reject(result) : resolve(result);
    };
    const onStatus = (payload: FileStatusPayload) => {
      if (payload.conversationId !== conversationId || payload.fileId !== fileId) return;
      if (payload.status === "ready") finish(payload);
      else if (payload.status === "failed") finish(new Error(payload.processingError || "文件处理失败"));
    };

    socket.on("file:status", onStatus);
    timer = window.setTimeout(() => finish(new Error("等待文件处理完成超时")), Math.max(1, deadline - Date.now()));

    // 监听器已注册，再做一次快照查询，覆盖上传完成和监听注册之间的竞态。
    void getConversationFile(conversationId, fileId)
      .then(({ data }) => {
        if (data.status === "ready") finish(data);
        else if (data.status === "failed") finish(new Error(data.processingError || "文件处理失败"));
      })
      .catch(() => {
        // 以 Socket 推送为准，快照查询失败不影响等待事件。
      });
  });
}
