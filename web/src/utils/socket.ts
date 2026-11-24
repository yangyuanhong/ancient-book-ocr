import { io, type Socket } from "socket.io-client";
import { getToken } from "@/utils/auth";

export interface AgentDeltaPayload {
  conversationId: string;
  messageId: string;
  delta: string;
  done: boolean;
  /** 递增序号，断线恢复时用来去重 */
  sequence?: number;
  /** done 为 true 时的结束原因 */
  status?: "completed" | "cancelled";
}

export interface SimpleResult {
  success: boolean;
  error?: string;
}

export interface ResumeGenerationResult extends SimpleResult {
  /** 进行中回复的快照；没有进行中的回复时为 null */
  generation?: {
    messageId: string;
    content: string;
    sequence: number;
  } | null;
}

export interface AgentErrorPayload {
  conversationId: string
  messageId: string;
  error: string
}

export interface AgentResumeContentPayload {
  messageId: string;
  content: string;
  status: "running" | "cancelled" | "completed" | "failed";
}

export interface AgentToolStartPayload {
  conversationId: string
  messageId: string
  toolName: string
}

export interface AgentToolEndPayload {
  conversationId: string
  messageId: string
  toolName: string
  result?: string
}

export interface FileStatusPayload {
  conversationId: string;
  fileId: string;
  name: string;
  status: "uploaded" | "processing" | "ready" | "failed";
  processingStage: "uploaded" | "parsing" | "ocr" | "correction" | "completed" | "failed";
  processingError?: string;
  processingMode?: "document" | "ocr";
  correctionError?: string;
  ocrProgress?: {
    pageCount: number;
    succeededPages: number;
    failedPages: number;
    currentPage?: number;
  };
  documentType?: "ancient_book" | "modern_document" | "mixed" | "unknown";
  classificationConfidence?: number;
  classificationReasons?: string[];
}

export interface ChatMessagePayload {
  id: string;
  clientMessageId: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
}

export interface SendMessagePayload {
  conversationId: string;
  content: string;
  clientMessageId: string;
}

export interface SendMessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface ServerToClientEvents {
  "agent:delta": (payload: AgentDeltaPayload) => void
  "agent:error": (payload: AgentErrorPayload) => void
  "chat:message": (message: ChatMessagePayload) => void
  "agent:tool-start": (payload: AgentToolStartPayload) => void
  "agent:tool-end": (payload: AgentToolEndPayload) => void
  "file:status": (payload: FileStatusPayload) => void
}

interface ClientToServerEvents {
  "chat:join": (
    conversationId: string,
    callback: (result: SimpleResult) => void,
  ) => void;
  "chat:leave": (conversationId: string) => void;
  "chat:send": (
    payload: SendMessagePayload,
    callback: (result: SendMessageResult) => void,
  ) => void;
  "chat:cancel": (
    payload: { conversationId: string; messageId?: string },
    callback: (result: SimpleResult) => void,
  ) => void;
  "chat:resume": (
    conversationId: string,
    callback: (result: ResumeGenerationResult) => void,
  ) => void;
}

export interface SendMessagePayload {
  conversationId: string;
  content: string;
  clientMessageId: string;
  fileIds?: string[];
  /** 模型 value，如 gpt-6-sol */
  modelName?: string;
  /** 推理强度，如 low / medium / high */
  reasoningEffort?: string;
}

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

/** 获取全局 Socket.IO 连接；首次调用时携带当前登录用户的 JWT。 */
export function getSocket(): AppSocket {
  if (!socket) {
    socket = io(import.meta.env.VITE_BASE_API, {
      autoConnect: false,
      transports: ["websocket"],
      reconnection: true,
    });
  }

  socket.auth = { token: getToken() };
  if (!socket.connected) socket.connect();
  return socket;
}

/** 主动关闭连接，通常在退出登录时调用。 */
export function disconnectSocket(): void {
  socket?.disconnect();
}

export function joinChat(conversationId: string): void {
  getSocket().emit("chat:join", conversationId, (result) => {
    // 服务端会校验会话归属，无权访问时不会加入房间
    if (!result.success) console.warn("加入会话失败：", result.error);
  });
}

export function sendChatMessage(
  payload: SendMessagePayload,
  callback: (result: SendMessageResult) => void,
): void {
  getSocket().emit("chat:send", payload, callback);
}

/** 停止当前回复；messageId 不传时停止该会话里正在进行的回复 */
export function cancelGeneration(
  conversationId: string,
  messageId?: string,
): Promise<SimpleResult> {
  return new Promise((resolve) => {
    getSocket()
      .timeout(10_000)
      .emit("chat:cancel", { conversationId, messageId }, (error, result) => {
        resolve(error ? { success: false, error: "停止请求超时" } : result);
      });
  });
}

/** 重新加入会话房间，并拿到进行中回复的快照（刷新、重连、切回会话时调用） */
export function resumeGeneration(
  conversationId: string,
): Promise<ResumeGenerationResult> {
  return new Promise((resolve) => {
    getSocket()
      .timeout(10_000)
      .emit("chat:resume", conversationId, (error, result) => {
        resolve(error ? { success: false, error: "恢复请求超时" } : result);
      });
  });
}




