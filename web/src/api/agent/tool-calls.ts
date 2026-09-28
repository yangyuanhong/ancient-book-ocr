import api from "@/utils/axios";

export function getConversationToolCalls(conversationId: string) {
  return api.get(`/agent/conversations/${conversationId}/tool-calls`);
}

export function setModelEmit(modelMode: string, modelName: string) {
  return api.post(`/agent/model/config`, {
    modelMode,
    modelName
  })
}