import {
  AgentToolEndPayload,
  AgentToolStartPayload,
  type AgentDeltaPayload,
  type AgentErrorPayload,
  type FileStatusPayload,
} from "@/utils/socket";
import { toFileProcessing } from "@/views/agent/utils";
import type { ActiveChatLike, MessageModel, User } from "@/views/agent/types";
import { message } from "ant-design-vue";
import { type Ref } from "vue";

const toolStatusMessageIds = new Set<string>();
const toolNameMap: Record<string, string> = {
  get_current_time: "获取当前时间",
  calculate: "进行数学计算",
  get_current_user: "查询当前用户信息",
};

export const handleAgentError = (
  payload: AgentErrorPayload,
  messagesText: Ref<MessageModel[]>,
  activeChat: Ref<ActiveChatLike>,
) => {
  const agentMessage = messagesText.value.find(
    (item) => item.id === payload.messageId,
  );

  if (agentMessage) {
    agentMessage.status = "failed";
    agentMessage.content = `❌ ${payload.error}`;
  } else {
    messagesText.value.push({
      id: payload.messageId,
      sender: {
        id: "assistant",
        name: "小o",
        key: "assistant",
        status: { state:"online" },
      },
      content: `❌ ${payload.error}`,
      createdAt: new Date().toISOString(),
      status: "failed"
    })
  }

  activeChat.value.typingUsers = [];
  toolStatusMessageIds.delete(payload.messageId);
  answeringMessageIds.delete(payload.messageId);
  message.error(payload.error);
};

const answeringMessageIds = new Set<string>();
// 每条回复已处理到的 delta 序号
const lastSequences = new Map<string, number>();

/**
 * 应用断线恢复快照：用服务端当前完整内容覆盖/创建助手消息，
 * 并记录快照序号，之后收到的重复 delta 会被 handleAgentDelta 丢弃。
 */
export const applyGenerationSnapshot = (
  snapshot: { messageId: string; content: string; sequence: number },
  messagesText: Ref<MessageModel[]>,
  assistantUser: User,
  activeChat: Ref<ActiveChatLike>,
) => {
  lastSequences.set(snapshot.messageId, snapshot.sequence);
  if (snapshot.content) answeringMessageIds.add(snapshot.messageId);

  const restored: MessageModel = {
    id: snapshot.messageId,
    sender: assistantUser,
    // 还没产生文字（例如在调用工具）时沿用思考中的占位
    content: snapshot.content || "💭 正在思考…",
    createdAt: new Date().toISOString(),
    status: "sending",
  };

  const index = messagesText.value.findIndex(
    (item) => item.id === snapshot.messageId,
  );
  if (index >= 0) messagesText.value.splice(index, 1, restored);
  else messagesText.value.push(restored);

  activeChat.value.typingUsers = [{ id: assistantUser.id }];
};

export const handleAgentDelta = (
  payload: AgentDeltaPayload,
  messagesText: Ref<MessageModel[]>,
  assistantUser: User,
  activeChat: Ref<ActiveChatLike>,
) => {
  // 断线恢复时快照已包含这些片段，序号不大于已处理序号的 delta 直接丢弃
  const lastSequence = lastSequences.get(payload.messageId) ?? 0;
  if (payload.delta && payload.sequence !== undefined) {
    if (payload.sequence <= lastSequence) return;
    lastSequences.set(payload.messageId, payload.sequence);
  }

  let agentMessage = messagesText.value.find(
    (item) => item.id === payload.messageId,
  );
  if (!agentMessage) {
    agentMessage = {
      id: payload.messageId,
      sender: assistantUser,
      content: "",
      createdAt: new Date().toISOString(),
      status: "sending",
    };

    messagesText.value.push(agentMessage);
  }

  if (payload.delta) {
    // 第一个真实回答片段到达时，清除工具状态文案
    // if (toolStatusMessageIds.has(payload.messageId)) {
    //   agentMessage.content = "";
    //   toolStatusMessageIds.delete(payload.messageId)
    // }
    if (!answeringMessageIds.has(payload.messageId)) {
      answeringMessageIds.add(payload.messageId);
      agentMessage.content = "";
    }

    const nextContent = `${agentMessage.content ?? ""}${payload.delta}`;
    const messageIndex = messagesText.value.findIndex(
      (item) => item.id === payload.messageId,
    );
    if (messageIndex >= 0) {
      messagesText.value.splice(messageIndex, 1, {
        ...agentMessage,
        content: nextContent,
      });
    } else {
      agentMessage.content = nextContent;
    }
  }

  if (payload.done) {
    // 上面的 splice 会换成新对象，agentMessage 已是旧引用，这里必须按 id 重新取当前数组里的项
    const index = messagesText.value.findIndex(
      (item) => item.id === payload.messageId,
    );
    const current = index >= 0 ? messagesText.value[index] : agentMessage;
    const hasAnswer = answeringMessageIds.has(payload.messageId);
    let finished: MessageModel;

    if (payload.status === "cancelled") {
      // 用户主动停止：保留已生成的部分，和服务端落库的内容保持一致
      finished = {
        ...current,
        content: hasAnswer ? `${current.content ?? ""}\n\n（已停止生成）` : "已停止生成",
        status: "sent",
      };
    } else if (hasAnswer) {
      finished = { ...current, status: "sent" };
    } else {
      // 整轮没有收到任何回答文字：替换掉“正在思考/正在调用工具”的占位文案，避免界面看起来一直卡住
      finished = {
        ...current,
        content: "⚠️ 模型没有返回内容，请重试或切换模型",
        status: "failed",
      };
    }

    if (index >= 0) messagesText.value.splice(index, 1, finished);
    activeChat.value.typingUsers = [];
    toolStatusMessageIds.delete(payload.messageId);
    answeringMessageIds.delete(payload.messageId);
    lastSequences.delete(payload.messageId);
  }
};

/**
 * 收到 file:status 时，按 fileId 找到消息里的附件并更新处理状态，驱动步骤链刷新。
 * 用 splice 替换整条消息，保证 Bubble.List 的 computed 能感知到变化。
 * 返回是否找到了对应附件。
 */
export const handleFileStatus = (
  payload: FileStatusPayload,
  messagesText: Ref<MessageModel[]>,
): boolean => {
  for (let index = messagesText.value.length - 1; index >= 0; index--) {
    const item = messagesText.value[index];
    const fileIndex = item.files?.findIndex((file) => file.fileId === payload.fileId) ?? -1;
    if (fileIndex < 0 || !item.files) continue;

    const files = [...item.files];
    files[fileIndex] = { ...files[fileIndex], processing: toFileProcessing(payload) };
    messagesText.value.splice(index, 1, { ...item, files });
    return true;
  }
  return false;
};

// 调用工具处理
export const handleAgentToolStart = (
  payload: AgentToolStartPayload,
  messagesText: Ref<MessageModel[]>,
  assistantUser: User,
) => {
  toolStatusMessageIds.add(payload.messageId);

  let agentMessage = messagesText.value.find(
    (item) => item.id === payload.messageId,
  );

  if (!agentMessage) {
    agentMessage = {
      id: payload.messageId,
      sender: assistantUser,
      content: "",
      createdAt: new Date().toISOString(),
      status: "sending",
    };
    messagesText.value.push(agentMessage);
  }

  const label = toolNameMap[payload.toolName] ?? payload.toolName;

  agentMessage.content = `🔧 正在${label}...`;
  agentMessage.status = "sending";
};

export const handleAgentToolEnd = (
  payload: AgentToolEndPayload,
  messagesText: Ref<MessageModel[]>,
) => {
  const label = toolNameMap[payload.toolName] || payload.toolName;

  const agentMessage = messagesText.value.find(
    (item) => item.id === payload.messageId,
  );

  if (agentMessage) {
    agentMessage.content = `✅ ${label}完成，正在整理回答…`;
  }
};

