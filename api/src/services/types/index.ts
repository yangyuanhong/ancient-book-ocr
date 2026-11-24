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
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress: number;
  text: string;
  error?: string | null;
  pages?: OcrPage[];
  pageCount?: number;
  /** 已处理页数（含失败页） */
  processedPages?: number;
  succeededPages?: number;
  failedPages?: number;
  /** 正在识别的页码 */
  currentPage?: number | null;
}

/** 扫描版 PDF 的逐页识别进度，存到附件上并推给前端 */
export interface OcrPageProgress {
  pageCount: number;
  succeededPages: number;
  failedPages: number;
  currentPage?: number;
}