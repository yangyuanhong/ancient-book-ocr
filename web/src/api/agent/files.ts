import api from "@/utils/axios";
import type { ApiResponse } from "@/utils/types";
import type { ConversationFileStatus, UploadedChatFileDto } from "@/views/agent/types";

export function uploadConversationFile(conversationId: string, file: Blob, fileName: string, onUploadProgress?: (percent: number) => void): Promise<ApiResponse<UploadedChatFileDto>> {
  const formData = new FormData();
  formData.append("file", file, fileName);
  return api.post(`/agent/conversations/${conversationId}/files`, formData, {
    timeout: 60_000,
    onUploadProgress: (event) => {
      if (event.total) onUploadProgress?.(Math.round((event.loaded / event.total) * 100));
    },
  });
}

export function getConversationFile(conversationId: string, fileId: string): Promise<ApiResponse<ConversationFileStatus>> {
  return api.get(`/agent/conversations/${conversationId}/files/${fileId}`);
}

export function retryConversationFileCorrection(conversationId: string, fileId: string) {
  return api.post(`/agent/conversations/${conversationId}/files/${fileId}/retry-correction`);
}
