import { message } from "ant-design-vue";
import type { AgentChat, MessageModel, User } from "@/views/agent/types";
import type { ComputedRef, Ref } from "vue";
import {
  createConversation,
  deleteConversation,
  getConversationMessages,
  getConversations,
  updateConversation,
} from "@/api/agent";
import { joinChat, type AppSocket } from "@/utils/socket";
import type { ChatMessageDto, ConversationDto } from "../types";
import { toMessageModel } from "../utils";

export interface ChatListContext {
  socket: AppSocket;
  currentUser: ComputedRef<User>;
  assistantUser: User;
  chats: Ref<AgentChat[]>;
  activeChat: Ref<AgentChat>;
  messagesText: Ref<MessageModel[]>;
  chatsLoaded: Ref<boolean>;
  messagesLoaded: Ref<boolean>;
  conversationLoading: Ref<boolean>;
}

export function useConversations(context: ChatListContext) {
  const {
    socket,
    currentUser,
    assistantUser,
    chats,
    activeChat,
    messagesText,
    chatsLoaded,
    messagesLoaded,
    conversationLoading,
  } = context;

  async function initializeChat(): Promise<void> {
    chatsLoaded.value = false;
    messagesLoaded.value = false;

    try {
      const conversationResponse = await getConversations();
      let conversations: ConversationDto[] = conversationResponse.data;

      if (!conversations.length) {
        const createResponse = await createConversation();
        conversations = [createResponse.data];
      }

      const conversationChats: AgentChat[] = conversations.map(
        (conversation) => ({
          id: conversation._id,
          key: conversation._id,
          label: conversation.title,
          users: [currentUser.value, assistantUser],
          typingUsers: [],
          disabled: false,
        }),
      );
      chats.value = conversationChats;
      const firstChat = conversationChats[0];
      activeChat.value = firstChat;

      const messageResponse = await getConversationMessages(firstChat.id);
      messagesText.value = messageResponse.data.map((item: ChatMessageDto) =>
        toMessageModel(item, currentUser, assistantUser),
      );

      joinChat(firstChat.id);
    } catch (error) {
      console.error("初始化会话失败：", error);
      message.error("加载会话失败");
    } finally {
      chatsLoaded.value = true;
      messagesLoaded.value = true;
    }
  }

  async function handleOpenChat(key: string) {
    if (key === activeChat.value.id) {
      return;
    }

    try {
      const chat = chats.value.find((item) => item.key === key);
      if (chat) {
        messagesLoaded.value = false;
        const previousConversationId = activeChat.value.id;
        activeChat.value = chat;
        messagesText.value = [];

        if (previousConversationId) {
          socket.emit("chat:leave", previousConversationId);
        }

        const response = await getConversationMessages(chat.id);
        messagesText.value = response.data.map((item) =>
          toMessageModel(item, currentUser, assistantUser),
        );

        joinChat(chat.id);
      }
    } catch (error) {
      console.error("切换会话失败", error);
      message.error("切换会话失败");
    } finally {
      messagesLoaded.value = true;
    }
  }

  async function handleAddChat(title = "新对话") {
    try {
      conversationLoading.value = true;
      const response = await createConversation(title);
      const conversation = response.data;
      const newChat: AgentChat = {
        id: conversation._id,
        key: conversation._id,
        label: conversation.title,
        users: [currentUser.value, assistantUser],
        typingUsers: [],
        disabled: false,
      };
      chats.value = [newChat, ...chats.value];
      activeChat.value = newChat;
      messagesText.value = [];
      joinChat(newChat.id);
    } catch (error) {
      console.error("创建会话失败", error);
      message.error("创建会话失败");
    } finally {
      conversationLoading.value = false;
    }
  }

  async function handleEditChat(key: string, title: string) {
    try {
      conversationLoading.value = true;
      const response = await updateConversation(key, title);
      const updated = response.data;
      chats.value = chats.value.map((item) =>
        item.key === key ? { ...item, label: updated.title } : item,
      );
      if (activeChat.value.id === key) activeChat.value = { ...activeChat.value, label: updated.title };
    } catch (error) {
      console.error("更新会话失败", error);
      message.error("更新会话失败");
    } finally {
      conversationLoading.value = false;
    }
  }

  async function handleDeleteChat(key: string) {
    try {
      conversationLoading.value = true;
      await deleteConversation(key);
      chats.value = chats.value.filter((item) => item.key !== key);
      if (activeChat.value.id === key) {
        const nextChat = chats.value[0];
        if (nextChat) await handleOpenChat(String(nextChat.key));
        else await handleAddChat();
      }
    } catch (error) {
      console.error("删除会话失败", error);
      message.error("删除会话失败");
    } finally { conversationLoading.value = false; }
  }

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  function handleSearchChat(val: string) {
    if (searchTimer) clearTimeout(searchTimer);
    const keyword = typeof val === "string" ? val.trim() : "";
    searchTimer = setTimeout(async () => {
      try {
        conversationLoading.value = true;
        const response = await getConversations(keyword);
        chats.value = response.data.map((conversation) => ({
          id: conversation._id, key: conversation._id, label: conversation.title,
          users: [currentUser.value, assistantUser], typingUsers: [], disabled: false,
        }));
      } catch (error) {
        console.error("搜索会话失败", error);
        message.error("搜索会话失败");
      } finally { conversationLoading.value = false; }
    }, 300);
  }

  return {
    initializeChat,
    handleOpenChat,
    handleAddChat,
    handleEditChat,
    handleDeleteChat,
    handleSearchChat,
  };
}
