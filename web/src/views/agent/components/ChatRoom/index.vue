<template>
  <div class="chat-room" @click="onRoomClick">
    <Flex v-if="loading" class="chat-room__state" justify="center" align="center">
      <Spin tip="加载消息中..." />
    </Flex>
    <Welcome
      v-else-if="!messages.length"
      class="chat-room__welcome"
      variant="borderless"
      :icon="welcomeIcon"
      :title="`你好，我是${assistantName}`"
      description="可以直接提问，也可以上传图片、PDF、Word 附件让我分析。"
    />
    <!-- Bubble.List 设置了 inheritAttrs: false，普通 class 不会落到 DOM 上，必须用 root-class-name -->
    <Bubble.List
      v-else
      ref="listRef"
      root-class-name="chat-room__list"
      :items="bubbleItems"
      :roles="roles"
      auto-scroll
    />
  </div>
</template>
<script lang="ts" setup name="ChatRoom">
import { Bubble, Welcome, Attachments } from "ant-design-x-vue";
import type { BubbleListProps } from "ant-design-x-vue";
import {
  CheckOutlined,
  CopyOutlined,
  RobotOutlined,
  UserOutlined,
} from "@ant-design/icons-vue";
import { Avatar, Button, Flex, Spin, Tooltip, message } from "ant-design-vue";
import { computed, h, nextTick, ref, watch } from "vue";
import type { MessageFileModel, MessageModel } from "@/views/agent/types";
import { renderMarkdown } from "@/views/agent/utils/markdown";
import { copyText } from "@/views/agent/utils/copy";
import FileSteps from "@/views/agent/components/FileSteps/index.vue";

const props = defineProps<{
  messages: MessageModel[];
  loading: boolean;
  currentUserId: string;
  currentUserAvatar?: string;
  assistantName: string;
  onRetryCorrection?: (fileId: string) => void;
}>();

const listRef = ref<InstanceType<typeof Bubble.List> | null>(null);

function scrollToBottom(behavior: ScrollBehavior = "smooth") {
  void nextTick(() => {
    const el = listRef.value?.nativeElement;
    el?.scrollTo({ top: el.scrollHeight, behavior });
  });
}

/*
 * Bubble.List 自带的 autoScroll 只在“倒数第二条消息仍在可视区”时才跟随，
 * 用户往上翻过或一次追加多条（用户消息 + 助手占位）时不会滚动。
 * 这里在消息条数增加时（发送、收到新回复）强制滚到底；流式追加文字仍交给 autoScroll 跟随。
 */
watch(
  () => props.messages.length,
  (length, prevLength) => {
    if (length > (prevLength ?? 0)) scrollToBottom();
  },
);

// 切换会话或首次加载完成后直接定位到底部
watch(
  () => props.loading,
  (loading) => {
    if (!loading) scrollToBottom("auto");
  },
);

const welcomeIcon = () =>
  h(Avatar, {
    size: 56,
    style: { backgroundColor: "#1677ff" },
    icon: h(RobotOutlined),
  });

/**
 * 用户气泡上方：文件卡片。上传中卡片底色从左往右按进度填充，
 * 描述显示百分比；上传失败卡片变红。
 */
function renderUserFiles(files: MessageFileModel[]) {
  return h(
    Flex,
    { wrap: "wrap", gap: 8, justify: "flex-end", class: "chat-room__files" },
    () =>
      files.map((file, index) => {
        const uploading = file.uploadStatus === "uploading";
        const failed = file.uploadStatus === "error";
        const progress = uploading ? (file.progress ?? 0) : 100;

        return h(Attachments.FileCard, {
          key: file.fileId ?? `${file.name}-${index}`,
          className: [
            "chat-room__file-card",
            uploading && "is-uploading",
            failed && "is-failed",
          ]
            .filter(Boolean)
            .join(" "),
          // 进度通过 CSS 变量传给背景渐变，宽度变化带过渡动画
          style: { "--upload-progress": `${progress}%` },
          item: {
            uid: file.fileId ?? `${file.name}-${index}`,
            name: file.name,
            size: file.size,
            status: "done",
            description: uploading
              ? `上传中 ${progress}%`
              : failed
                ? "上传失败"
                : undefined,
          },
        });
      }),
  );
}

/**
 * 助手气泡上方：展示 agent 处理附件的步骤（解析 / OCR → 分类 → 荀子校对）。
 * 附件挂在用户消息上，这里取紧挨着的上一条用户消息里、已上传成功的附件。
 */
function renderAgentSteps(files: MessageFileModel[]) {
  return h(
    Flex,
    { vertical: true, gap: 8, class: "chat-room__steps" },
    () =>
      files.map((file, index) =>
        h(FileSteps, {
          key: file.fileId ?? `${file.name}-${index}`,
          name: file.name,
          info: file.processing!,
          onRetry: () => file.fileId && props.onRetryCorrection?.(file.fileId),
        }),
      ),
  );
}

/** 找到助手消息对应的附件：必须是紧挨着的上一条用户消息 */
function stepFilesFor(index: number): MessageFileModel[] {
  const previous = props.messages[index - 1];
  if (!previous || previous.sender.id !== props.currentUserId) return [];
  return (previous.files ?? []).filter((file) => file.processing);
}

const roles: BubbleListProps["roles"] = {
  assistant: {
    placement: "start",
    variant: "filled",
    avatar: () =>
      h(Avatar, { style: { backgroundColor: "#1677ff" }, icon: h(RobotOutlined) }),
    // 模型输出经 markdown-it 渲染（已禁用原始 HTML）
    messageRender: (content: string) =>
      h("div", { class: "chat-room__markdown", innerHTML: renderMarkdown(content) }),
  },
  user: {
    placement: "end",
    variant: "filled",
    avatar: () =>
      props.currentUserAvatar
        ? h(Avatar, { src: props.currentUserAvatar })
        : h(Avatar, { style: { backgroundColor: "#87d068" }, icon: h(UserOutlined) }),
    messageRender: (content: string) =>
      h("div", { class: "chat-room__text" }, content),
  },
};

const bubbleItems = computed<BubbleListProps["items"]>(() =>
  props.messages.map((item, messageIndex) => {
    const isUser = item.sender.id === props.currentUserId;
    const failed = item.status === "failed";
    const pending = !isUser && item.status === "sending";
    const stepFiles = isUser ? [] : stepFilesFor(messageIndex);

    return {
      key: item.id,
      role: isUser ? "user" : "assistant",
      content: item.content ?? "",
      // 还没有任何文字时显示加载动画；“正在思考/调用工具”等状态文案照常展示
      loading: pending && !item.content,
      // 用户气泡上方是文件卡片，助手气泡上方是处理附件的步骤链
      header: isUser
        ? item.files?.length
          ? renderUserFiles(item.files)
          : undefined
        : stepFiles.length
          ? renderAgentSteps(stepFiles)
          : undefined,
      footer: failed
        ? h("span", { class: "chat-room__failed" }, "发送失败")
        : !isUser && !pending && item.content
          ? renderReplyActions(item)
          : undefined,
    };
  }),
);

// ---------- 复制 ----------
const copiedMessageId = ref<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function copyReply(item: MessageModel) {
  // 复制原始 Markdown，粘贴到编辑器/文档里格式不会丢
  if (!(await copyText(item.content ?? ""))) {
    message.error("复制失败");
    return;
  }

  copiedMessageId.value = item.id;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copiedMessageId.value = null), 1500);
}

// 回复气泡左下方的操作栏，默认隐藏，鼠标悬浮在该条回复上才显示（见样式）
function renderReplyActions(item: MessageModel) {
  const copied = copiedMessageId.value === item.id;

  return h("div", { class: "chat-room__actions" }, [
    h(
      Tooltip,
      { title: copied ? "已复制" : "复制", placement: "bottom" },
      () =>
        h(Button, {
          type: "text",
          size: "small",
          class: "chat-room__action-btn",
          "aria-label": "复制回复",
          icon: h(copied ? CheckOutlined : CopyOutlined),
          onClick: () => void copyReply(item),
        }),
    ),
  ]);
}

// 代码块是 innerHTML 渲染的，无法绑定 Vue 事件，在根节点上做事件委托
async function onRoomClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  const button = target?.closest<HTMLButtonElement>("[data-copy-code]");
  if (!button) return;

  const code = button.closest("pre")?.querySelector("code")?.textContent ?? "";
  if (!(await copyText(code))) {
    message.error("复制失败");
    return;
  }

  button.textContent = "已复制";
  button.classList.add("is-copied");
  setTimeout(() => {
    button.textContent = "复制";
    button.classList.remove("is-copied");
  }, 1500);
}
</script>
<style lang="scss" scoped>
.chat-room {
  height: 100%;
  display: flex;
  flex-direction: column;
  text-align: left;
  line-height: 1.6;
}

.chat-room__state,
.chat-room__welcome {
  flex: 1;
}

.chat-room__welcome {
  max-width: 720px;
  margin: 0 auto;
  padding-top: 80px;
}

/* 头像 32px + 间距 12px：气泡在对侧留出同样宽度，不越过对方头像所在列 */
$avatar-gutter: 44px;

/*
 * Bubble.List 是子组件，根节点不一定带本组件的 data-v 属性，
 * 所以统一挂在自己的根 .chat-room 下，再用 :deep 穿透。
 */
.chat-room {
  :deep(.chat-room__list) {
    flex: 1;
    min-height: 0;
    padding: 16px 24px;
  }

  :deep(.ant-bubble-start) {
    padding-inline-end: $avatar-gutter;
  }

  :deep(.ant-bubble-end) {
    padding-inline-start: $avatar-gutter;
  }

  /* 助手气泡：白底 + 描边，在浅灰背景上更清晰 */
  :deep(.ant-bubble-start .ant-bubble-content-filled) {
    background: #ffffff;
    border: 1px solid #dbe1ea;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
  }

  /* 用户气泡：主色填充 */
  :deep(.ant-bubble-end .ant-bubble-content-filled) {
    background: #1677ff;
    color: #ffffff;
  }
}

:deep(.chat-room__text) {
  white-space: pre-wrap;
  word-break: break-word;
}

/*
 * 上传进度：卡片底下铺一层主色浅底，宽度 = 进度，从左往右慢慢填满。
 * 用伪元素而不是背景渐变，因为 width 可以做过渡动画，渐变的色标不行。
 */
:deep(.chat-room__file-card) {
  overflow: hidden;
  isolation: isolate;

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    width: 0;
    background: #d6e4ff;
    transition: width 0.3s ease, opacity 0.4s ease;
  }

  &.is-uploading::before {
    width: var(--upload-progress, 0%);
  }

  // 完成后填满再淡出，回到普通卡片的底色
  &:not(.is-uploading):not(.is-failed)::before {
    width: 100%;
    opacity: 0;
  }

  &.is-failed {
    border-color: #ffccc7;

    &::before {
      width: 100%;
      background: #fff1f0;
    }

    .ant-attachment-list-card-desc {
      color: #ff4d4f;
    }
  }
}

:deep(.chat-room__steps) {
  margin-bottom: 4px;
}

:deep(.chat-room__files) {
  margin-bottom: 4px;
}

:deep(.chat-room__failed) {
  color: #ff4d4f;
  font-size: 12px;
}

/* 回复气泡左下方的操作栏：默认隐藏，悬浮到该条回复（或键盘聚焦按钮）时显示 */
.chat-room {
  :deep(.ant-bubble-start .ant-bubble-footer) {
    margin-top: 4px;
  }

  :deep(.chat-room__actions) {
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  /*
   * 只在悬浮到气泡本身时显示：.ant-bubble-start 是整行宽度，
   * 鼠标从输入框移上来时很容易停在最后一条的空白区域，导致它看起来一直显示。
   * 键盘聚焦用 :focus-visible，鼠标点击复制后按钮保留的焦点不会让它常驻。
   */
  :deep(.ant-bubble-start .ant-bubble-content-wrapper:hover .chat-room__actions),
  :deep(.chat-room__actions:has(:focus-visible)) {
    opacity: 1;
  }

  :deep(.chat-room__action-btn) {
    color: #8c8c8c;

    &:hover {
      color: #1677ff;
    }
  }
}

/* markdown-it 输出的排版 */
:deep(.chat-room__markdown) {
  word-break: break-word;

  > :first-child {
    margin-top: 0;
  }

  > :last-child {
    margin-bottom: 0;
  }

  p,
  ul,
  ol,
  blockquote,
  pre,
  table {
    margin: 0 0 12px;
  }

  h1,
  h2,
  h3,
  h4 {
    margin: 16px 0 8px;
    font-weight: 600;
    line-height: 1.4;
  }

  h1 { font-size: 20px; }
  h2 { font-size: 18px; }
  h3 { font-size: 16px; }

  ul,
  ol {
    padding-left: 22px;
  }

  li + li {
    margin-top: 4px;
  }

  a {
    color: #1677ff;
  }

  blockquote {
    padding: 4px 12px;
    color: #475569;
    border-left: 3px solid #cbd5e1;
    background: #f8fafc;
  }

  code {
    padding: 1px 6px;
    font-family: Consolas, Monaco, "Courier New", monospace;
    font-size: 0.9em;
    color: #c7254e;
    background: #f1f5f9;
    border-radius: 4px;
  }

  /* 代码块：底色和关键字配色来自 highlight.js 的 github-dark 主题 */
  pre.code-block {
    padding: 0;
    overflow: hidden;
    border-radius: 8px;

    code {
      display: block;
      padding: 12px 14px;
      overflow-x: auto;
      color: inherit;
      background: transparent;
      white-space: pre;
      font-size: 13px;
      line-height: 1.6;
    }
  }

  .code-block__bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 8px 4px 14px;
    font-size: 12px;
    line-height: 20px;
    color: #8b949e;
    background: #161b22;
    border-bottom: 1px solid #30363d;
    user-select: none;
  }

  .code-block__copy {
    padding: 0 8px;
    font-size: 12px;
    line-height: 20px;
    color: #8b949e;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;

    &:hover {
      color: #e6edf3;
      background: #30363d;
    }

    &:focus-visible {
      outline: 2px solid #1677ff;
      outline-offset: 1px;
    }

    &.is-copied {
      color: #3fb950;
    }
  }

  table {
    display: block;
    max-width: 100%;
    overflow-x: auto;
    border-collapse: collapse;
  }

  th,
  td {
    padding: 6px 12px;
    border: 1px solid #e2e8f0;
  }

  th {
    background: #f8fafc;
    font-weight: 600;
  }

  hr {
    margin: 16px 0;
    border: none;
    border-top: 1px solid #e2e8f0;
  }
}
</style>
