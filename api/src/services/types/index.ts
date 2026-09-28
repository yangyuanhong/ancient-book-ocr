export interface ParsedDocument {
  markdown: string;
  format?: string;
}

export interface OcrPage {
  page: number;
  status: string;
  text: string;
  error?: string | null;
}

export interface PdfOcrTask {
  taskId: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  text: string;
  error?: string | null;
  pages?: OcrPage[];
}