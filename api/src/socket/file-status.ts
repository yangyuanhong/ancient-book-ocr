import type { AppSocketServer } from "./types/index.js";

export interface ChatFileStatusPayload {
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

let socketServer: AppSocketServer | undefined;

export function setFileStatusSocket(io: AppSocketServer): void {
  socketServer = io;
}

export function emitChatFileStatus(payload: ChatFileStatusPayload): void {
  socketServer?.to(payload.conversationId).emit("file:status", payload);
}
