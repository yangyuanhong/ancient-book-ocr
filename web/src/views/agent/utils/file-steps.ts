import type { FileProcessingInfo, OcrPageProgress } from "@/views/agent/types";

export type StepStatus = "pending" | "success" | "error";

export interface FileStep {
  key: string;
  title: string;
  description?: string;
  status: StepStatus;
  /** 当前正在执行的步骤，用来显示加载图标 */
  active?: boolean;
  /** OCR 逐页进度，用来在步骤下方画进度条 */
  pages?: OcrPageProgress;
}

/**
 * OCR 步骤的描述文字：
 *   识别中：已识别 12 / 30 页，正在识别第 13 页（2 页失败）
 *   完成：  已识别 30 页，其中 2 页失败已跳过
 */
function describeOcr(
  ocrDone: boolean,
  failed: boolean,
  error: string,
  pages?: OcrPageProgress,
): string {
  if (failed && !ocrDone) return error;
  if (!pages?.pageCount) return ocrDone ? "已识别文字" : "正在识别文字";

  const { pageCount, succeededPages, failedPages, currentPage } = pages;
  const failedText = failedPages ? `${failedPages} 页失败` : "";

  if (ocrDone) {
    return failedPages
      ? `已识别 ${pageCount} 页，其中 ${failedText}已跳过`
      : `已识别全部 ${pageCount} 页`;
  }

  const handled = succeededPages + failedPages;
  const current = currentPage ? `，正在识别第 ${currentPage} 页` : "";
  return `已识别 ${handled} / ${pageCount} 页${current}${failedText ? `（${failedText}）` : ""}`;
}

const documentTypeLabels: Record<string, string> = {
  ancient_book: "古籍",
  modern_document: "现代文档",
  mixed: "古今混排",
  unknown: "无法判断，按普通文档处理",
};

/**
 * 根据附件处理状态推导步骤链：
 *   普通文件：上传 → 解析文档
 *   图片 / 扫描版 PDF：上传 → OCR 识别 → 文档分类 → （古籍才有）古籍大模型校对
 * 后端只给出“当前阶段”，这里按链路顺序把之前的步骤补成已完成。
 */
export function buildFileSteps(info: FileProcessingInfo): FileStep[] {
  const stage = info.processingStage ?? "uploaded";
  const failed = info.status === "failed" || stage === "failed";
  const done = info.status === "ready" || stage === "completed";
  const error = info.processingError || "处理失败";

  const steps: FileStep[] = [{ key: "upload", title: "上传文件", status: "success" }];

  // 还没开始处理，或刚上传（服务端尚未确定链路）
  if (!info.processingMode && stage === "uploaded" && !failed) {
    steps.push({ key: "queue", title: "等待处理", status: "pending", active: true });
    return steps;
  }

  // 老数据没有 processingMode：进行中看当前阶段，已结束看是否有 OCR 分类结果
  const mode =
    info.processingMode ??
    (stage === "ocr" || stage === "correction" || info.documentType ? "ocr" : "document");

  if (mode === "document") {
    steps.push({
      key: "parse",
      title: "解析文档",
      description: failed ? error : done ? "已提取正文" : "正在提取正文",
      status: failed ? "error" : done ? "success" : "pending",
      active: !failed && !done,
    });
    return steps;
  }

  // ---------- OCR 链路 ----------
  const classified = Boolean(info.documentType);
  const ocrDone = classified || stage === "correction" || done;
  const pageProgress = info.ocrProgress;

  steps.push({
    key: "ocr",
    title: "OCR 识别",
    description: describeOcr(ocrDone, failed, error, pageProgress),
    status: ocrDone ? "success" : failed ? "error" : "pending",
    active: !ocrDone && !failed,
    // 扫描版 PDF 才有逐页进度；单张图片没有这个字段
    ...(pageProgress?.pageCount ? { pages: pageProgress } : {}),
  });

  if (!ocrDone) return steps;

  const typeLabel = documentTypeLabels[info.documentType ?? "unknown"];
  const confidence =
    info.classificationConfidence !== undefined
      ? `，置信度 ${Math.round(info.classificationConfidence * 100)}%`
      : "";
  steps.push({
    key: "classify",
    title: "文档分类",
    description: classified ? `${typeLabel}${confidence}` : "正在判断文档类型",
    status: classified ? "success" : failed ? "error" : "pending",
    active: !classified && !failed,
  });

  // 只有判定为古籍才会调用古籍大模型
  if (info.documentType === "ancient_book") {
    // 校对失败时附件仍然可用（回退为 OCR 原文），这一步标红但整体不算失败
    const correctionFailed = Boolean(info.correctionError) || failed;
    steps.push({
      key: "correction",
      title: "古籍大模型校对",
      description: info.correctionError
        ? `校对失败，已改用 OCR 原文（${info.correctionError}）`
        : failed
          ? error
          : done
            ? "已完成古籍校对"
            : "正在校对古籍文本",
      status: correctionFailed ? "error" : done ? "success" : "pending",
      active: !correctionFailed && !done,
    });
  } else if (classified && failed) {
    // 分类之后出错（例如保存失败），挂在分类步骤上
    steps[steps.length - 1] = { ...steps[steps.length - 1], status: "error", description: error };
  }

  return steps;
}
