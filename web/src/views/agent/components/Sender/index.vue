<template>
  <Sender
    :value="value"
    :loading="loading"
    :disabled="disabled"
    :placeholder="placeholder"
    :on-change="(v: string) => (value = v)"
    :on-submit="onSubmit"
    :on-paste-file="onPasteFile"
    :on-cancel="() => emit('cancel')"
    :actions="false"
  >
    <template #header>
      <Sender.Header
        title="附件"
        :open="attachmentsOpen"
        :on-open-change="(open: boolean) => (attachmentsOpen = open)"
        :styles="{ content: { padding: 0 } }"
      >
        <Attachments
          ref="attachmentsRef"
          :items="fileList"
          :accept="ACCEPT"
          :multiple="true"
          :before-upload="beforeUpload"
          :on-change="onAttachmentsChange"
          :placeholder="attachmentPlaceholder"
          :get-drop-container="getDropContainer"
        />
      </Sender.Header>
    </template>
    <template
      #footer="{
        info: {
          components: { SendButton, LoadingButton },
        },
      }"
    >
      <Flex justify="space-between" align="center">
        <Flex gap="small" align="center">
          <Badge :dot="fileList.length > 0 && !attachmentsOpen">
            <Button
              :style="iconStyle"
              type="text"
              aria-label="添加附件"
              :icon="h(LinkOutlined)"
              @click="attachmentsOpen = !attachmentsOpen"
            />
          </Badge>
          <Divider type="vertical" />
        </Flex>
        <Flex align="center">
          <ModelSelector v-model:effort="modelMode" v-model:model="modelName" />
          <Divider type="vertical" />
          <!-- 回复中点击触发 Sender 的 onCancel，停止生成 -->
          <a-tooltip v-if="loading" title="停止生成">
            <component :is="LoadingButton" type="default" />
          </a-tooltip>
          <component
            :is="SendButton"
            v-else
            type="primary"
            :disabled="disabled || (!value.trim() && !fileList.length)"
          />
        </Flex>
      </Flex>
    </template>
  </Sender>
</template>
<script lang="ts" setup name="SenderIndex">
import { CloudUploadOutlined, LinkOutlined } from "@ant-design/icons-vue";
import { Badge, Button, Divider, Flex, Upload, message, theme } from "ant-design-vue";
import type { UploadChangeParam, UploadFile } from "ant-design-vue";
import { Attachments, Sender, type Attachment } from "ant-design-x-vue";
import ModelSelector from "./ModelSelector.vue";
import { h, nextTick, ref } from "vue";
import type { ChatFileItem } from "@/views/agent/types";

export interface SenderSubmitPayload {
  content: string;
  files: ChatFileItem[];
  modelName: string;
  reasoningEffort: string;
}

// 附件限制：与后端单条消息最多 5 个附件保持一致
const ACCEPT = "image/*,application/pdf,.doc,.docx";
const MAX_FILES = 5;
const MAX_FILE_SIZE = 100 * 1024 * 1024;

defineProps<{
  /** 助手回复中，禁止重复发送 */
  loading?: boolean;
  /** 会话尚未加载完成 */
  disabled?: boolean;
}>();

const emit = defineEmits<{
  submit: [payload: SenderSubmitPayload];
  /** 点击停止按钮 */
  cancel: [];
}>();

const { token } = theme.useToken();
const value = ref("");
const placeholder = "随心输入，Enter 发送，Shift + Enter 换行";
const modelMode = ref("low");
const modelName = ref("gpt-6-sol");
const attachmentsOpen = ref(false);
const fileList = ref<Attachment[]>([]);
const attachmentsRef = ref<InstanceType<typeof Attachments> | null>(null);

const iconStyle = {
  fontSize: 18,
  color: token.value.colorText,
};

const attachmentPlaceholder = (type: "inline" | "drop") =>
  type === "drop"
    ? { title: "拖到这里上传" }
    : {
        icon: h(CloudUploadOutlined),
        title: "上传附件",
        description: `点击或拖拽文件到此区域，最多 ${MAX_FILES} 个，单个不超过 100MB`,
      };

// 拖拽区域覆盖整个输入框
const getDropContainer = () =>
  document.querySelector<HTMLElement>(".agent-outer") ?? undefined;

// 只在本地暂存文件，真正上传发生在点击发送之后（沿用 send-message.ts 的上传流程）
function beforeUpload(file: File) {
  if (file.size > MAX_FILE_SIZE) {
    message.error(`${file.name} 超过 100MB 限制`);
    return Upload.LIST_IGNORE;
  }
  if (fileList.value.length >= MAX_FILES) {
    message.error(`一次最多上传 ${MAX_FILES} 个文件`);
    return Upload.LIST_IGNORE;
  }
  return false;
}

function onAttachmentsChange({ fileList: next }: UploadChangeParam<UploadFile>) {
  fileList.value = next.slice(0, MAX_FILES);
}

/*
 * Sender.Header 关闭时不会渲染里面的 Attachments，此时 attachmentsRef 为 null，
 * 直接调用 upload 会静默失败。所以先打开面板，等 Attachments 挂载后再塞文件。
 */
async function onPasteFile(_first: File, files: FileList) {
  // 剪贴板的 FileList 在 paste 事件结束后可能被清空，先同步拷贝一份
  const pasted = Array.from(files);
  if (!pasted.length) return;

  attachmentsOpen.value = true;
  await nextTick();
  attachmentsRef.value?.upload(pasted);
}

function toChatFileItem(file: Attachment): ChatFileItem | null {
  const blob = file.originFileObj;
  if (!blob) return null;
  return {
    name: file.name,
    type: blob.type,
    extension: file.name.split(".").pop()?.toLowerCase() ?? "",
    size: blob.size,
    url: "",
    blob,
  };
}

function onSubmit(content: string) {
  const files: ChatFileItem[] = [];
  for (const attachment of fileList.value) {
    const file = toChatFileItem(attachment);
    if (file) files.push(file);
  }

  if (!content.trim() && !files.length) return;

  emit("submit", {
    content,
    files,
    modelName: modelName.value,
    reasoningEffort: modelMode.value,
  });

  value.value = "";
  fileList.value = [];
  attachmentsOpen.value = false;
}
</script>
<style scoped></style>
