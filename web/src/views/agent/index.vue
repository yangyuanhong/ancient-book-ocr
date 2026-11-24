<template>
  <div class="agent-outer">
    <AgentLayout>
      <template #sider>
        <YConversations
          v-model:items="chats"
          :active-key="activeChat.id"
          :loading="conversationLoading"
          @select="handleOpenChat"
          @create="handleAddChat"
          @delete="handleDeleteChat"
          @edit="handleEditRequest"
          @search="handleSearchChat"
        />
        <ConversationNameModal
          v-model:open="createModalOpen"
          :confirm-loading="conversationLoading"
          @submit="handleCreateConversation"
        />
        <ConversationNameModal
          v-model:open="editModalOpen"
          title="编辑会话"
          ok-text="保存"
          :initial-name="editingChat?.label ?? ''"
          :confirm-loading="conversationLoading"
          @submit="handleEditConversation"
        />
      </template>
      <template #header>
        <ChatHeader :title="activeChat.label" :typing="replying" />
      </template>
      <template #content>
        <ChatRoom
          :messages="messagesText"
          :loading="!messagesLoaded"
          :current-user-id="currentUser.id"
          :current-user-avatar="currentUser.avatar"
          :assistant-name="assistantUser.name"
          :on-retry-correction="handleRetryCorrection"
        />
      </template>
      <template #footer>
        <Sender
          :loading="replying"
          :disabled="!activeChat.id || !messagesLoaded"
          @submit="handleSend"
          @cancel="handleCancel"
        />
      </template>
    </AgentLayout>
  </div>
</template>
<script lang="ts" setup name="AgentChatPage">
import { useAuthStore } from "@/stores/auth";
import {
  cancelGeneration,
  getSocket,
  resumeGeneration,
  type AgentDeltaPayload,
  type AgentErrorPayload,
  type AgentToolEndPayload,
  type AgentToolStartPayload,
  type FileStatusPayload,
} from "@/utils/socket";
import AgentLayout from "@/views/agent/components/Layout/index.vue";
import ChatHeader from "@/views/agent/components/Header/index.vue";
import YConversations from "@/views/agent/components/YConversations/index.vue";
import ChatRoom from "@/views/agent/components/ChatRoom/index.vue";
import Sender, {
  type SenderSubmitPayload,
} from "@/views/agent/components/Sender/index.vue";
import ConversationNameModal from "@/views/agent/vue/ConversationNameModal.vue";
import { Modal, message } from "ant-design-vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { AgentChat, MessageModel, User } from "@/views/agent/types";
import {
  continueAfterCorrectionRetry,
  sendMessage as sendAgentMessage,
} from "@/views/agent/ts/send-message";
import {
  applyGenerationSnapshot,
  handleAgentDelta,
  handleFileStatus,
  handleAgentError,
  handleAgentToolEnd,
  handleAgentToolStart,
} from "@/views/agent/ts/agent-event-handle";
import { useConversations } from "./composables/useConversations";
import { retryConversationFileCorrection } from "@/api/agent/files";

const authStore = useAuthStore();
const socket = getSocket();
const chatsLoaded = ref(false);
const messagesLoaded = ref(false);
const chats = ref<AgentChat[]>([]);
const messagesText = ref<MessageModel[]>([]);
const conversationLoading = ref(false);
const createModalOpen = ref(false);
const editModalOpen = ref(false);
const editingChat = ref<AgentChat | null>(null);

const currentUser = computed<User>(() => ({
  id: authStore.user?.id ?? "guest",
  key: authStore.user?.id ?? "guest",
  name: authStore.user?.username ?? "Guest",
  avatar: authStore.avatar,
  status: { state: "online" },
}));
const assistantUser: User = {
  id: "assistant",
  key: "assistant",
  name: "小O",
  status: { state: "online" },
};

const activeChat = ref<AgentChat>({
  id: "",
  key: "",
  label: "加载中...",
  users: [currentUser.value, assistantUser],
  typingUsers: [],
});

// 发送/流式处理函数通过 typingUsers 标记助手是否在回复，这里直接复用
const replying = computed(() => !!activeChat.value.typingUsers?.length);

async function handleRetryCorrection(fileId: string) {
  const conversationId = activeChat.value.id;
  if (!conversationId) return;
  try {
    await retryConversationFileCorrection(conversationId, fileId);
  } catch (error: any) {
    message.error(error?.response?.data?.message || "重试古籍校正失败");
    return;
  }
  markCorrectionRetrying(fileId);
  // 等重新校对的结果：成功就接着调用主模型，失败则节点回到失败状态等下一次重试
  await continueAfterCorrectionRetry(conversationId, fileId, messagesText, activeChat, assistantUser);
}

/** 不等 socket 推送，先把古籍节点切回“校对中”（去掉 correctionError 即显示加载状态） */
function markCorrectionRetrying(fileId: string) {
  const owner = messagesText.value.find((item) => item.files?.some((file) => file.fileId === fileId));
  const current = owner?.files?.find((file) => file.fileId === fileId);
  if (!current?.processing) return;
  handleFileStatus(
    {
      ...current.processing,
      conversationId: activeChat.value.id,
      fileId,
      name: current.name,
      status: "processing",
      processingStage: "correction",
      processingError: undefined,
      correctionError: undefined,
    },
    messagesText,
  );
}

const {
  initializeChat,
  handleOpenChat,
  handleAddChat: createChat,
  handleEditChat,
  handleDeleteChat: deleteChat,
  handleSearchChat,
} = useConversations({
  socket,
  currentUser,
  assistantUser,
  chats,
  activeChat,
  messagesText,
  chatsLoaded,
  messagesLoaded,
  conversationLoading,
});

// ---------- 会话管理 ----------
function handleCreateConversation(name: string) {
  createModalOpen.value = false;
  void createChat(name);
}

function handleAddChat() {
  createModalOpen.value = true;
}

function handleDeleteChat(chat: { key?: string; label?: unknown }) {
  if (!chat.key) return;
  Modal.confirm({
    title: "确认删除会话？",
    content: `删除后将无法查看“${String(chat.label ?? "")}”。`,
    okText: "删除",
    cancelText: "取消",
    okButtonProps: { danger: true },
    onOk: () => deleteChat(String(chat.key)),
  });
}

function handleEditRequest(chat: AgentChat) {
  editingChat.value = chat;
  editModalOpen.value = true;
}

function handleEditConversation(name: string) {
  if (!editingChat.value?.key) return;
  editModalOpen.value = false;
  void handleEditChat(String(editingChat.value.key), name);
}

// ---------- 发送消息 ----------
function handleSend(payload: SenderSubmitPayload) {
  if (replying.value) {
    message.warning("请等待当前回复完成");
    return;
  }

  void sendAgentMessage(
    {
      content: payload.content,
      files: payload.files,
      mentionedUsers: [],
      modelName: payload.modelName,
      reasoningEffort: payload.reasoningEffort,
    },
    activeChat,
    messagesText,
    currentUser.value,
    assistantUser,
  );
}

// ---------- 中断 ----------
const cancelling = ref(false);

async function handleCancel() {
  const conversationId = activeChat.value.id;
  if (!conversationId || cancelling.value) return;

  // 服务端 ack 之前助手消息还是 pending 占位 id，此时只传会话 id，由服务端找到进行中的生成
  const pending = [...messagesText.value]
    .reverse()
    .find((item) => item.sender.id === assistantUser.id && item.status === "sending");
  const messageId =
    pending && !pending.id.startsWith("pending-agent-") ? pending.id : undefined;

  cancelling.value = true;
  try {
    const result = await cancelGeneration(conversationId, messageId);
    // 成功后等服务端推送 done(status: cancelled) 再更新界面，保证和落库内容一致
    if (!result.success) message.warning(result.error || "停止失败");
  } finally {
    cancelling.value = false;
  }
}

// ---------- 恢复 ----------
/**
 * 刷新页面、切回会话或网络重连后调用：重新加入房间，
 * 如果服务端还在生成，就用快照补齐已生成内容，后续 delta 继续实时追加。
 */
async function restoreGeneration() {
  const conversationId = activeChat.value.id;
  if (!conversationId) return;

  const result = await resumeGeneration(conversationId);
  // 请求期间用户可能已经切到别的会话
  if (!result.success || conversationId !== activeChat.value.id) return;

  if (result.generation) {
    applyGenerationSnapshot(result.generation, messagesText, assistantUser, activeChat);
  }
}

// 会话消息加载完成（首次进入、切换会话）后检查是否有进行中的回复
watch(messagesLoaded, (loaded) => {
  if (loaded) void restoreGeneration();
});

// Socket 断线重连后服务端房间关系会丢失，需要重新加入并补齐内容
const handleReconnect = () => {
  if (messagesLoaded.value) void restoreGeneration();
};

// ---------- Socket 事件 ----------
const handleAgentDeltaEvent = (payload: AgentDeltaPayload) => {
  if (payload.conversationId !== activeChat.value.id) return;
  handleAgentDelta(payload, messagesText, assistantUser, activeChat);
};

const handleAgentErrorEvent = (payload: AgentErrorPayload) => {
  if (payload.conversationId !== activeChat.value.id) return;
  handleAgentError(payload, messagesText, activeChat);
};

const handleAgentToolStartEvent = (payload: AgentToolStartPayload) => {
  if (payload.conversationId !== activeChat.value.id) return;
  handleAgentToolStart(payload, messagesText, assistantUser);
};

const handleAgentToolEndEvent = (payload: AgentToolEndPayload) => {
  if (payload.conversationId !== activeChat.value.id) return;
  handleAgentToolEnd(payload, messagesText);
};

// 处理进度由消息里附件的步骤链实时展示，这里只在失败时额外弹提示，避免漏看
const handleFileStatusEvent = (payload: FileStatusPayload) => {
  if (payload.conversationId !== activeChat.value.id) return;
  handleFileStatus(payload, messagesText);

  if (payload.status === "failed") {
    message.error({
      content: `${payload.name} 处理失败：${payload.processingError || "未知错误"}`,
      key: `file-${payload.fileId}`,
    });
  }
};

onMounted(() => {
  socket.on("agent:delta", handleAgentDeltaEvent);
  socket.on("agent:error", handleAgentErrorEvent);
  socket.on("agent:tool-start", handleAgentToolStartEvent);
  socket.on("agent:tool-end", handleAgentToolEndEvent);
  socket.on("file:status", handleFileStatusEvent);
  socket.io.on("reconnect", handleReconnect);

  void initializeChat();
});

onBeforeUnmount(() => {
  // 页面离开时只移除当前页面监听，连接由 socket 工具统一管理
  socket.off("agent:delta", handleAgentDeltaEvent);
  socket.off("agent:error", handleAgentErrorEvent);
  socket.off("agent:tool-start", handleAgentToolStartEvent);
  socket.off("agent:tool-end", handleAgentToolEndEvent);
  socket.off("file:status", handleFileStatusEvent);
  socket.io.off("reconnect", handleReconnect);
});
</script>
<style lang="scss" scoped>
.agent-outer {
  margin: 40px auto 60px;
  width: 1200px;
  height: calc(100vh - 184px);
  background: #e1e2e9;
  border: 1px solid #aaabad;
  padding: 4px;
  border-radius: 12px;
  box-shadow:
    0 8px 24px rgba(31, 41, 55, 0.08),
    0 2px 6px rgba(31, 41, 55, 0.04);
  overflow: hidden;
}
</style>
