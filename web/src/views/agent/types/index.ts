export interface ConversationDto {
  _id: string;
  title: string;
  ownerId: string;
  participantIds: string[];
  type: "agent" | "group";
  status: "active" | "archived";
  createdAt: string;
  updateAt: string;
}

export interface ChatMessageDto {
  _id: string;
  conversationId: string;
  senderId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  fileIds: string[];
  clientMessageId?: string;
  status: "sending" | "sent" | "failed";
  createdAt: string;
  updatedAt: string;
  attachments?: MessageAttachment[];
}

export type FileProcessingStage =
  | "uploaded"
  | "parsing"
  | "ocr"
  | "correction"
  | "completed"
  | "failed";

export interface OcrPageProgress {
  pageCount: number;
  succeededPages: number;
  failedPages: number;
  /** 正在识别的页码，识别结束后不再返回 */
  currentPage?: number;
}

/**
 * 附件处理状态。与后端 toFileProcessingInfo 对应，
 * Socket 推送、状态查询接口、历史消息附件都返回这组字段。
 */
export interface FileProcessingInfo {
  status: Status;
  processingStage?: FileProcessingStage;
  processingError?: string | null;
  /** 实际走的链路：document = 直接解析文本，ocr = OCR 识别 */
  processingMode?: "document" | "ocr";
  /** 荀子校对失败原因；此时附件仍可用，内容回退为 OCR 原文 */
  correctionError?: string;
  /** 扫描版 PDF 的逐页识别进度 */
  ocrProgress?: OcrPageProgress;
  documentType?: "ancient_book" | "modern_document" | "mixed" | "unknown";
  classificationConfidence?: number;
  classificationReasons?: string[];
}

export interface UploadedChatFileDto extends FileProcessingInfo {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface ConversationFileStatus extends FileProcessingInfo {
  fileId: string;
  name: string;
  hasOcrText: boolean;
  hasProcessedText: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MessageAttachment extends FileProcessingInfo {
  fileId: string;
  name: string;
  mimeType?: string;
  size?: number;
}

export type Status = "uploaded" | "processing" | "ready" | "failed";

export interface SendMessageOptions {
  onStarted?: (messageId: string) => void;
  isGenerating?: () => boolean;
}

export type Id = string;
export interface User {
  id: Id;
  name: string;
  key: Id;
  /**
   * Optional URL of the user's profile picture. Rendered as an avatar
   * in the message author block, the user-tag autocomplete row, and
   * (for 1:1 chats) as a fallback for `Chat.avatar`.
   */
  avatar?: string;
  status: {
    state: "online" | "offline" | "away" | "busy";
    lastActiveAt?: string;
  };
}

export interface MessageFileModel {
  /** 服务端附件 id，收到 file:status 时据此更新处理步骤 */
  fileId?: string;
  /** 附件处理状态，助手气泡里据此渲染“解析 / OCR → 校对”的步骤链 */
  processing?: FileProcessingInfo;
  /** 上传状态，用户气泡里的文件卡片据此显示进度底色 */
  uploadStatus?: "uploading" | "done" | "error";
  name: string;
  type: string;
  extension: string;
  url: string;
  previewUrl?: string;
  /** Set to `false` to force image/video files through the host-controlled download flow. */
  previewable?: boolean;
  size?: number;
  /** Duration in seconds for audio/video files. */
  duration?: number;
  /** Upload progress (0-100) while a pending file is being sent. */
  progress?: number;
  /** In-memory blob for pending uploads (not for received files). */
  blob?: Blob;
}

export interface MessageSummary {
  id: Id;
  sender: User;
  content?: string;
  createdAt: string;
  status?: MessageStatus;
  deleted?: boolean;
  edited?: boolean;
  files?: MessageFileModel[];
}

export type MessageStatus =
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed";
export interface UserReference {
  id: Id;
}
/** 发送/流式处理只依赖会话 id 和 typingUsers */
export interface ActiveChatLike {
  id: Id;
  typingUsers?: UserReference[];
}

/** ant-design-x-vue Conversations 的会话项，补充业务字段 */
export interface AgentChat extends ActiveChatLike {
  key: string;
  label?: string;
  users?: User[];
  disabled?: boolean;
  [key: string]: unknown;
}

export interface MessageModel extends MessageSummary {
    reactions?: Record<string, Id[]>;
    /** True if this message is part of the unread batch that triggers the divider line. */
    unread?: boolean;
    system?: boolean;
    disableActions?: boolean;
    disableReactions?: boolean;
    /**
     * The message being quoted by this one. Tightened to `MessageSummary`
     * so a reply preview never recurses into yet another reply chain.
     */
    reply?: MessageSummary;
}

export interface ChatFileItem extends MessageFileModel {
    loading?: boolean;
    /** 本地预览用的 Object URL，由 sendMessage 在上传结束后统一释放 */
    localUrl?: string;
}