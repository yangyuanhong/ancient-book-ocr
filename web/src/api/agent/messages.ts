import api from "@/utils/axios";
import type { ApiResponse } from "@/utils/types";
import type { ChatMessageDto } from "@/views/agent/types";

export function getConversationMessages(
  conversationId: string,
): Promise<ApiResponse<ChatMessageDto[]>> {
  return api.get(`/agent/conversations/${conversationId}/messages`);
}
