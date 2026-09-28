import type {
  ChatFileItem,
  ActiveChatLike,
  MessageFileModel,
  MessageModel,
  User,
} from "@/views/agent/types";
import { message } from "ant-design-vue";
import { type Ref } from "vue";
import { getSocket, sendChatMessage, type FileStatusPayload } from "@/utils/socket";
import { getConversationFile, uploadConversationFile } from "@/api/agent";
import type { SendMessageOptions, UploadedChatFileDto } from "../types";
import { getDisplayName } from "@/views/agent/utils"

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

  let uploadedFiles: UploadedChatFileDto[] = [];
  const messageContent = content || "请分析我上传的附件";
  const clientMessageId = crypto.randomUUID();
  let userMessageInserted = false;

  try {
    if (payload.files.length > 0) {
      message.loading({
        content: "正在上传附件...",
        key: "chat-file-upload",
        duration: 0,
      });

      uploadedFiles = await uploadMessageFiles(
        activeChat.value.id,
        payload.files,
      );

      let userMessageStart:MessageModel = {
        id: clientMessageId,
        sender: currentUser,
        content: messageContent,
        files: toMessageFiles(uploadedFiles),
        createdAt: new Date().toISOString(),
        status: "sending", //'sending' | 'sent' | 'delivered' | 'read' | 'failed'
      }

      // 上传成功后立即展示用户消息和附件卡片；解析在后台轮询。
      messagesText.value.push(userMessageStart);
      userMessageInserted = true;

      message.success({
        content: "附件上传成功",
        key: "chat-file-upload",
      });

      for (const file of uploadedFiles) {
        if (file.status === "ready") {
          continue;
        }

        await waitForUploadedFileReady(activeChat.value.id, file.fileId);
      }

      const userMessage = messagesText.value.find(
        (item) => item.id === clientMessageId,
      );
      if (userMessage) userMessage.status = "sent";

      message.success({
        content: "附件处理完成",
        key: "chat-file-upload",
      });
    }
  } catch (error) {
    const userMessage = messagesText.value.find(
      (item) => item.id === clientMessageId,
    );
    if (userMessage) {
      userMessage.status = "failed";
      userMessage.content = `${messageContent}\n\n附件处理失败：${
        error instanceof Error ? error.message : "未知错误"
      }`;
    }

    message.error({
      content: error instanceof Error ? error.message : "附件上传失败",
      key: "chat-file-upload",
    });

    return;
  } finally {
    // 上传结束（成功或失败）后释放本地预览 URL，避免内存泄漏
    for (const file of payload.files) {
      if (file.localUrl) {
        URL.revokeObjectURL(file.localUrl);
      }
    }
  }

  const fileIds = uploadedFiles.map((file) => file.fileId);

  activeChat.value.typingUsers = [{ id: assistantUser.id }];

  const pendingAgentMessageId = `pending-agent-${clientMessageId}`;
  if (!userMessageInserted) {
    messagesText.value.push({
      id: clientMessageId,
      sender: currentUser,
      content: messageContent,
      files: toMessageFiles(uploadedFiles),
      createdAt: new Date().toISOString(),
      status: "sent",
    });
  }

  messagesText.value.push({
    id: pendingAgentMessageId,
    sender: assistantUser,
    content: "💭 正在思考…",
    createdAt: new Date().toISOString(),
    status: "sending",
  });

  try {
    sendChatMessage(
      {
        conversationId: activeChat.value.id,
        content: messageContent,
        fileIds,
        clientMessageId,
        modelName: payload.modelName,
        reasoningEffort: payload.reasoningEffort,
      },
      (result) => {
        if (!result.success || !result.messageId) {
          const pendingMessage = messagesText.value.find(
            (item) => item.id === pendingAgentMessageId,
          );
          if (pendingMessage) {
            pendingMessage.status = "failed";
            pendingMessage.content = "回复失败";
          }
          activeChat.value.typingUsers = [];

          return;
        }

        const pendingMessage = messagesText.value.find(
          (item) => item.id === pendingAgentMessageId,
        );

        if (pendingMessage) {
          pendingMessage.id = result.messageId;
        }
      },
    );
  } catch {
    const pendingIndex = messagesText.value.findIndex(
      (item) => item.id === pendingAgentMessageId,
    );
    if (pendingIndex >= 0) messagesText.value[pendingIndex].status = "failed";
    activeChat.value.typingUsers = [];
  }

}

async function uploadMessageFiles(
  conversationId: string,
  files: ChatFileItem[],
): Promise<UploadedChatFileDto[]> {
  const uploadedFiles: UploadedChatFileDto[] = [];

  for (const file of files) {
    if (!file.blob) {
      throw new Error(`无法读取文件：${file.name}`);
    }

    const response = await uploadConversationFile(
      conversationId,
      file.blob,
      file.name,
      (percent) => message.loading({
        content: `正在上传附件 ${percent}%...`,
        key: "chat-file-upload",
        duration: 0,
      }),
    );

    uploadedFiles.push(response.data);
  }

  return uploadedFiles;
}

async function waitForUploadedFileReady(
  conversationId: string,
  fileId: string,
): Promise<void> {
  const socket = getSocket();
  const deadline = Date.now() + 30 * 60 * 1000;
  let timer: number | undefined;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      socket.off("file:status", onStatus);
      if (timer !== undefined) window.clearTimeout(timer);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      error ? reject(error) : resolve();
    };
    const onStatus = (payload: FileStatusPayload) => {
      if (payload.conversationId !== conversationId || payload.fileId !== fileId) return;
      if (payload.status === "ready") finish();
      else if (payload.status === "failed") finish(new Error(payload.processingError || "文件处理失败"));
    };

    socket.on("file:status", onStatus);
    timer = window.setTimeout(() => finish(new Error("等待文件处理完成超时")), Math.max(1, deadline - Date.now()));

    // 监听器已注册，再做一次快照查询，覆盖上传完成和监听注册之间的竞态。
    void getConversationFile(conversationId, fileId)
      .then(({ data }) => {
        if (data.status === "ready") finish();
        else if (data.status === "failed") finish(new Error(data.processingError || "文件处理失败"));
      })
      .catch(() => {
        // 以 Socket 推送为准，快照查询失败不影响等待事件。
      });
  });
}

function getExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");

  return index >= 0 ? fileName.slice(index + 1).toLowerCase() : "";
}

function toMessageFiles(files: UploadedChatFileDto[]): MessageFileModel[] {
  return files.map((file) => ({
    name: getDisplayName(file.name),
    type: file.mimeType,
    extension: getExtension(file.name),
    size: file.size,
    url: "",
    previewable: false,
  }));
}
