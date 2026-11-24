const XUNZI_BASE_URL = process.env.XUNZI_BASE_URL || "http://127.0.0.1:8000/v1";

const XUNZI_MODEL = process.env.XUNZI_MODEL || "Xunzi-Qwen1.5-7B_chat";

function getApiKey(): string {
  const configuredKey = process.env.XUNZI_API_KEY?.trim();
  // dotenv treats `process.env.OPENAI_API_KEY` as a literal string. Support
  // that old placeholder while keeping XUNZI_API_KEY independently configurable.
  const apiKey =
    configuredKey && configuredKey !== "process.env.OPENAI_API_KEY"
      ? configuredKey
      : process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("XUNZI_API_KEY 未配置");
  }

  return apiKey;
}

function splitAncientText(
  text: string,
  maximumLength = 800,
): string[] {
  // OCR text can arrive with escaped newlines ("\\n") after being stored in
  // JSON/Mongo. Normalize both escaped and real newlines before splitting.
  const normalized = text.replace(/\\r?\\n/g, "\n");
  const paragraphs = normalized
    .split(/\r?\n+/)
    .map(item => item.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 1 > maximumLength) {
      chunks.push(current);
      current = "";
    }

    if (paragraph.length <= maximumLength) {
      current = current ? `${current}\n${paragraph}` : paragraph;

      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    for (let offset = 0; offset < paragraph.length; offset += maximumLength) {
      chunks.push(
        paragraph.slice(offset, offset + maximumLength),
      );
    }
  }

  if (current) {
    chunks.push(current);
  }
  return chunks;
}

async function correctOneChunk(text: string): Promise<string> {
  const startedAt = Date.now();
  logger.info({ inputLength: text.length }, "古籍模型调用开始");
  const response = await fetch(
    `${XUNZI_BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: XUNZI_MODEL,
        messages: [
          {
            role: "system",
            content: [
              "你是 OCR 古文文本整理助手。",
              "请直接处理用户提供的 OCR 文本，不要判断它是否为古籍、是否真实或来源是什么。",
              "只做三件事：修正明显的 OCR 错字、合理断句、添加中文标点。",
              "必须保留原文的字词、顺序和段落信息，不得删除、翻译、解释、概括、扩写或续写。",
              "遇到无法确定的字词，保留原样，不要用说明文字替代。",
              "不要拒答，不要道歉，不要输出处理过程或免责声明。",
              "只输出整理后的正文，不要加标题、引号或 Markdown 代码块。",
            ].join("\n"),
          },
          {
            role: "user",
            content: `请整理以下 OCR 原文：\n\n${text}`,
          },
        ],
        temperature: 0,
        max_new_tokens: 2046,
      }),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    logger.error(
      { status: response.status, inputLength: text.length, elapsedMs: Date.now() - startedAt },
      "古籍模型调用失败",
    );
    throw new Error(
      `古籍模型调用失败：HTTP ${response.status} ${detail}`,
    );
  }

  const result = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
      };
      finish_reason?: string;
    }>;
  };

  const rawContent = result.choices?.[0]?.message?.content;
  const content = Array.isArray(rawContent)
    ? rawContent
        .map(part => part.text ?? "")
        .join("")
        .trim()
    : rawContent?.trim();

  if (!content) {
    const finishReason = result.choices?.[0]?.finish_reason;
    logger.error(
      { inputLength: text.length, finishReason, elapsedMs: Date.now() - startedAt },
      "古籍模型返回空结果",
    );
    throw new Error(
      `古籍模型没有返回处理结果${finishReason ? `（finish_reason: ${finishReason}）` : ""}`,
    );
  }

  logger.info(
    { inputLength: text.length, outputLength: content.length, elapsedMs: Date.now() - startedAt },
    "古籍模型调用完成",
  );
  return content;
}

export async function correctAncientText(
  text: string,
): Promise<string> {
  const chunks = splitAncientText(text);

  if (chunks.length === 0) {
    throw new Error("没有可供古籍模型处理的文字");
  }

  const results: string[] = [];
  logger.info(
    { inputLength: text.length, chunkCount: chunks.length },
    "古籍文本校正开始",
  );

  // 串行处理，防止同时请求占用过多显存。
  for (let index = 0; index < chunks.length; index+=1) {
    logger.info(
      { chunk: index + 1, totalChunks: chunks.length, inputLength: chunks[index].length },
      "古籍文本分块处理中",
    );
    const result = await correctOneChunk(chunks[index]);
    results.push(result);
  }

  const output = results.join("\n\n");
  logger.info(
    { inputLength: text.length, outputLength: output.length, chunkCount: chunks.length },
    "古籍文本校正完成",
  );
  return output;
}
import { logger } from "../utils/logger.js";
