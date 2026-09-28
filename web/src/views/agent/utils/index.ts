import type {
  MessageModel,
  MessageFileModel, 
  User,
} from "@/views/agent/types";
import type { ChatMessageDto } from "../types";
import type { ComputedRef } from "vue";

export function toMessageModel(
  item: ChatMessageDto,
  currentUser: ComputedRef<User>,
  assistantUser: User,
): MessageModel {
  const sender = item.role === "assistant" ? assistantUser : currentUser.value;

  const files: MessageFileModel[] = (item.attachments ?? []).map((attachment) => ({
    name: getDisplayName(attachment.name),
    type: attachment.mimeType ?? "application/octet-stream",
    extension: getExtension(attachment.name),
    size: attachment.size,
    url: "",
    previewable: false,
  }));

  return {
    id: item._id,
    sender,
    files,
    content:item.content,
    createdAt: item.createdAt,
    status: item.status,
  };
}

function getExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");

  if (dotIndex < 0) {
    return "";
  }

  return fileName.slice(dotIndex + 1).toLowerCase();
}


export function getDisplayName(fileName: string): string {
  const extensionIndex = fileName.lastIndexOf(".");

  if (extensionIndex < 0) {
    return fileName;
  }

  const extension = fileName.slice(extensionIndex);
  const name = fileName.slice(0, extensionIndex);

  if (name.length <= 16) {
    return fileName;
  }

  return `${name.slice(0, 12)}...${extension}`;
}