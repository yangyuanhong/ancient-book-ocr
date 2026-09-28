import { ChatOpenAI } from "@langchain/openai";
import type { ReasoningEffort } from "./types/index.js";

export const DEFAULT_MODEL_NAME = "gpt-5.6-sol";

// 按 模型 + 推理强度 缓存，切换任一参数都会拿到新的实例
const modelCache = new Map<string, ChatOpenAI>();

// 封装model，抽离配置
export function getModel(
  modelName: string = DEFAULT_MODEL_NAME,
  reasoningEffort?: ReasoningEffort,
): ChatOpenAI {
  const cacheKey = `${modelName}:${reasoningEffort ?? "default"}`;
  const cachedModel = modelCache.get(cacheKey);

  if (cachedModel) {
    return cachedModel;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL;

  if (!apiKey) {
    throw new Error("系统环境变量 OPENAI_API_KEY 未配置");
  }

  if (!baseURL) {
    throw new Error("系统环境变量 OPENAI_BASE_URL 未配置");
  }

  const model = new ChatOpenAI({
    model: modelName,
    temperature: 0.7,
    timeout: 30_000,
    maxRetries: 1,
    // 统一走 Responses API：当前代理的 Chat Completions 流式响应不带 delta.role，
    // LangChain 会把分片解析成 ChatMessageChunk，tool_calls 被丢掉，agent 拿到空回复。
    // LangChain 默认只对 gpt-5.6-sol 等少数模型启用 Responses API，其它模型需要显式打开。
    useResponsesApi: true,
    // 推理强度只能在模型上配置，agent.stream 的 config 不认这个字段
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    configuration: {
      baseURL,
    },
  });

  modelCache.set(cacheKey, model);

  return model;
}
