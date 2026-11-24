import api from "@/utils/axios";
import type { ApiResponse } from "@/utils/types";
import type { ConversationDto } from "@/views/agent/types";

export function getConversations(keyword = ""): Promise<ApiResponse<ConversationDto[]>> {
  return api.get("/agent/conversations", { params: keyword ? { keyword } : undefined });
}

export function createConversation(
  title = "新对话",
): Promise<ApiResponse<ConversationDto>> {
  return api.post("/agent/conversations", { title });
}

export function updateConversation(
  conversationId: string,
  title: string,
): Promise<ApiResponse<ConversationDto>> {
  return api.patch(`/agent/conversations/${conversationId}`, { title });
}

export function deleteConversation(conversationId: string): Promise<ApiResponse<ConversationDto>> {
  return api.delete(`/agent/conversations/${conversationId}`);
}
