import { type Document } from "mongoose";

export interface ConversationDocument extends Document {
  title: string;
  ownerId: string;
  participantIds: string[];
  type: "agent" | "group";
  status: "active" | "archived";
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessageDocument extends Document {
  conversationId: string;
  senderId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  clientMessageId?: string;
  status: "sending" | "sent" | "failed";
  createdAt: Date;
  updatedAt: Date;
}

export interface ToolCallDocument extends Document {
  conversationId: string;
  messageId: string;
  userId: string;

  toolCallId: string;
  toolName: string;

  input: unknown;
  output?: unknown;

  status: "running" | "success" | "failed";
  error?: string;

  startedAt: Date;
  finishedAt?: Date;
  durationMs?: number;

  createdAt: Date;
  updatedAt: Date;
}

export interface ChatFileDocument extends Document {
  ownerId: string;
  conversationId: string;

  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  path: string;
  extractedMarkdown?: string;
  ocrRawText?: string;
  processedText?: string;
  ocrTaskId?: string;

  processingStage:
  | "uploaded"
  | "parsing"
  | "ocr"
  | "correction"
  | "completed"
  | "failed";

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

  status: "uploaded" | "processing" | "ready" | "failed";
  error?: string;

  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessageDocument extends Document {
  conversationId: string;
  senderId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  clientMessageId?: string;

  fileIds: string[];

  status: "sending" | "sent" | "failed";
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentGenerationDocument extends Document {
  generationId: string;
  conversationId: string;
  messageId: string;
  userId: string;
  originalPrompt: string;
  content: string;
  lastSequence: number;
  deltas: Array<{ sequence: number; delta: string }>;
  status: "running" | "cancelled" | "completed" | "failed";
  error?: string;
}
