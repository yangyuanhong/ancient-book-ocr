import type { Server, Socket } from "socket.io";
import type { ChatFileStatusPayload } from "../file-status.js";

export interface SocketUser {
  sub: string;
  username: string;
  role: string;
}

export interface AgentDeltaPayload {
  conversationId: string;
  messageId: string;
  delta: string;
  done: boolean;
  /** 递增序号，断线恢复时用来去重 */
  sequence?: number;
  /** done 为 true 时给出结束原因 */
  status?: "completed" | "cancelled";
}

export interface CancelGenerationPayload {
  conversationId: string;
  /** 不传时停止该会话里当前用户正在进行的生成（前端还没拿到 messageId 时使用） */
  messageId?: string;
}

export interface SimpleResult {
  success: boolean;
  error?: string;
}

export interface ResumeGenerationResult extends SimpleResult {
  /** 没有进行中的生成时为 null */
  generation?: {
    messageId: string;
    content: string;
    sequence: number;
  } | null;
}

export interface AgentErrorPayload {
  conversationId: string;
  messageId: string;
  error: string;
}

export interface SendMessagePayload {
  conversationId: string;
  content: string;
  clientMessageId?: string | null;
}

export interface SendMessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface ChatMessagePayload {
  id: string;
  clientMessageId: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
}

export interface AgentToolStartPayload {
  conversationId: string;
  messageId: string;
  toolName: string;
}

export interface AgentToolEndPayload {
  conversationId: string;
  messageId: string;
  toolName: string;
  result?: string;
}

export interface ServerToClientEvents {
  "chat:message": (message: ChatMessagePayload) => void;
  "agent:delta": (payload: AgentDeltaPayload) => void;
  "agent:error": (payload: AgentErrorPayload) => void;
  "agent:tool-start": (payload: AgentToolStartPayload) => void;
  "agent:tool-end": (payload: AgentToolEndPayload) => void;
  "file:status": (payload: ChatFileStatusPayload) => void;
}

export interface ClientToServerEvents {
  "chat:join": (
    conversationId: string,
    callback?: (result: SimpleResult) => void,
  ) => void;
  "chat:leave": (conversationId: string) => void;
  "chat:send": (
    payload: SendMessagePayload,
    callback: (result: SendMessageResult) => void,
  ) => void;
  /** 中断当前回复 */
  "chat:cancel": (
    payload: CancelGenerationPayload,
    callback?: (result: SimpleResult) => void,
  ) => void;
  /** 刷新/重连/切回会话后，拿到进行中回复的快照并重新加入房间 */
  "chat:resume": (
    conversationId: string,
    callback: (result: ResumeGenerationResult) => void,
  ) => void;
}

export interface InterServerEvents {}

export interface SocketData {
  user: SocketUser;
}

export type AppSocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export interface SendMessagePayload {
  conversationId: string;
  content: string;
  clientMessageId?: string | null;
  fileIds?: string[];
  /** 前端选择的模型，服务端会做白名单校验 */
  modelName?: string;
  /** 前端选择的推理强度 */
  reasoningEffort?: string;
}
