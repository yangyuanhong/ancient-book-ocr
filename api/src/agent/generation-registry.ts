// 正在进行中的 Agent 生成，保存在当前进程内存里。
// 中断（chat:cancel）靠这里的 AbortController，断线恢复（chat:resume）靠这里的实时内容和序号。
// 注意：只在单实例部署下有效，多实例需要换成 Redis 等共享存储。

export interface ActiveGeneration {
  messageId: string;
  conversationId: string;
  userId: string;
  controller: AbortController;
  /** 目前已生成的完整回答 */
  content: string;
  /** 已下发的 delta 序号，前端据此丢弃恢复快照之前的重复片段 */
  sequence: number;
  startedAt: Date;
}

const generations = new Map<string, ActiveGeneration>();

export function startGeneration(params: {
  messageId: string;
  conversationId: string;
  userId: string;
}): ActiveGeneration {
  const generation: ActiveGeneration = {
    ...params,
    controller: new AbortController(),
    content: "",
    sequence: 0,
    startedAt: new Date(),
  };

  generations.set(params.messageId, generation);
  return generation;
}

export function getGeneration(messageId: string): ActiveGeneration | undefined {
  return generations.get(messageId);
}

/** 找出某个用户在某个会话里仍在进行的生成（同一会话同一时间最多一条） */
export function findConversationGeneration(
  conversationId: string,
  userId: string,
): ActiveGeneration | undefined {
  for (const generation of generations.values()) {
    if (
      generation.conversationId === conversationId &&
      generation.userId === userId
    ) {
      return generation;
    }
  }
  return undefined;
}

export function finishGeneration(messageId: string): void {
  generations.delete(messageId);
}
