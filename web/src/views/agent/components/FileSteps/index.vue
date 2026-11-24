<template>
  <div class="file-steps">
    <div class="file-steps__name" :title="name">{{ name }}</div>
    <ThoughtChain size="small" :items="items" />
  </div>
</template>
<script lang="ts" setup name="FileSteps">
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  ReloadOutlined,
} from "@ant-design/icons-vue";
import { ThoughtChain, type ThoughtChainItem } from "ant-design-x-vue";
import { computed, h } from "vue";
import type { FileProcessingInfo, OcrPageProgress } from "@/views/agent/types";
import { buildFileSteps, type FileStep } from "@/views/agent/utils/file-steps";

const props = defineProps<{
  name: string;
  info: FileProcessingInfo;
}>();
const emit = defineEmits<{ retry: [] }>();

function stepIcon(step: FileStep) {
  if (step.status === "success") return h(CheckCircleOutlined);
  if (step.status === "error") return h(CloseCircleOutlined);
  return step.active ? h(LoadingOutlined, { spin: true }) : h(ClockCircleOutlined);
}

/**
 * OCR 逐页进度条：绿色 = 成功页，红色 = 失败页，灰色 = 未处理。
 * 放在 footer 而不是 content：ThoughtChain 的 content 只在可折叠且展开时显示，footer 始终显示。
 */
function renderPageBar(pages: OcrPageProgress) {
  const total = Math.max(pages.pageCount, 1);
  const succeeded = (pages.succeededPages / total) * 100;
  const failed = (pages.failedPages / total) * 100;
  const handled = pages.succeededPages + pages.failedPages;

  return h(
    "div",
    {
      class: "file-steps__bar",
      role: "progressbar",
      "aria-valuemin": 0,
      "aria-valuemax": pages.pageCount,
      "aria-valuenow": handled,
      "aria-label": `已处理 ${handled} / ${pages.pageCount} 页`,
    },
    [
      h("span", { class: "file-steps__bar-ok", style: { width: `${succeeded}%` } }),
      h("span", { class: "file-steps__bar-fail", style: { width: `${failed}%` } }),
    ],
  );
}

const items = computed<ThoughtChainItem[]>(() =>
  buildFileSteps(props.info).map((step) => ({
    key: step.key,
    title: step.title,
    description: step.description,
    status: step.status,
    icon: stepIcon(step),
    footer: step.pages
      ? renderPageBar(step.pages)
      : step.key === "correction" && step.status === "error"
        ? h("button", { class: "file-steps__retry", type: "button", onClick: () => emit("retry") }, [
            h(ReloadOutlined), " 重试古籍校正",
          ])
        : undefined,
  })),
);
</script>
<style lang="scss" scoped>
.file-steps {
  min-width: 220px;
  max-width: 360px;
  padding: 8px 12px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  text-align: left;
}

:deep(.file-steps__bar) {
  display: flex;
  width: 200px;
  max-width: 100%;
  height: 4px;
  overflow: hidden;
  background: #f0f0f0;
  border-radius: 2px;
}

:deep(.file-steps__bar-ok),
:deep(.file-steps__bar-fail) {
  height: 100%;
  transition: width 0.4s ease;
}

:deep(.file-steps__bar-ok) {
  background: #52c41a;
}

:deep(.file-steps__bar-fail) {
  background: #ff4d4f;
}

.file-steps__name {
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 500;
  color: #1f2937;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-steps__retry {
  margin-top: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #1677ff;
  cursor: pointer;
  font-size: 12px;
}
</style>
