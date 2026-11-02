import { createServer } from "node:http";

const MAX_BODY_BYTES = 1_000_000;
const MODEL_TIMEOUT_MS = 120_000;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getModelConfig(config) {
  const apiKey = config.apiKey?.trim();
  const model = config.model?.trim();
  const baseUrl = config.baseUrl?.trim().replace(/\/+$/, "");

  if (!apiKey || !model || !baseUrl) return null;

  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;

  return { apiKey, model, baseUrl };
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("请求内容过大，请缩短故事内容后重试。");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("请求格式无效，请重试。");
    error.statusCode = 400;
    throw error;
  }
}

function requireText(body, key, label, { optional = false, max = 100_000 } = {}) {
  const value = body[key];
  if (optional && value === undefined) return "";
  if (typeof value !== "string" || value.length > max) {
    const error = new Error(`${label}格式无效或长度超出限制。`);
    error.statusCode = 400;
    throw error;
  }
  return value.trim();
}

function requireOutlineChapters(body) {
  if (!Array.isArray(body.outlineChapters) || body.outlineChapters.length > 500) {
    const error = new Error("章节大纲格式无效。");
    error.statusCode = 400;
    throw error;
  }

  return body.outlineChapters.map((chapter, index) => {
    if (
      !isRecord(chapter) ||
      typeof chapter.title !== "string" ||
      typeof chapter.summary !== "string"
    ) {
      const error = new Error(`第 ${index + 1} 章大纲格式无效。`);
      error.statusCode = 400;
      throw error;
    }

    return {
      title: chapter.title.slice(0, 500),
      summary: chapter.summary.slice(0, 10_000),
    };
  });
}

function parseOutline(content, chapterCount) {
  const json = content.trim().replace(/^```(?:json)?\s*|\s*```$/gi, "");
  let result;
  try {
    result = JSON.parse(json);
  } catch {
    throw new Error("模型返回的大纲格式无法解析，请重试或更换模型。");
  }

  if (!isRecord(result) || typeof result.summary !== "string" || !Array.isArray(result.chapters)) {
    throw new Error("模型返回的大纲缺少故事梗概或章节列表，请重试。");
  }

  const validChapters = result.chapters.filter(
      (chapter) =>
        isRecord(chapter) &&
        typeof chapter.title === "string" &&
        typeof chapter.summary === "string",
  );
  if (validChapters.length !== chapterCount) {
    throw new Error(`模型应返回 ${chapterCount} 章，但实际返回 ${validChapters.length} 章。请重试。`);
  }

  const chapters = validChapters
    .map((chapter, index) => ({
      id: `chapter-${index + 1}`,
      title: chapter.title.trim(),
      summary: chapter.summary.trim(),
    }))
    .filter((chapter) => chapter.title.length > 0);

  if (chapters.length === 0) {
    throw new Error("模型没有返回有效章节，请重试。");
  }

  return { summary: result.summary.trim(), chapters };
}

function outlineMessages(body) {
  const chapterCount = body.chapterCount;
  if (!Number.isInteger(chapterCount) || chapterCount < 1 || chapterCount > 500) {
    const error = new Error("计划章节数需为 1 到 500 之间的整数。");
    error.statusCode = 400;
    throw error;
  }

  const title = requireText(body, "title", "小说名称", { max: 500 });
  const genre = requireText(body, "genre", "题材", { optional: true, max: 500 });
  const premise = requireText(body, "premise", "故事灵感", { optional: true, max: 20_000 });

  return {
    chapterCount,
    messages: [
      {
        role: "system",
        content:
          "你是一位擅长中文小说创作的作家和故事策划。根据设定创作有吸引力、前后连贯的故事大纲。只返回 JSON，不要使用 Markdown 代码块。JSON 格式为 {\"summary\":\"故事总梗概\",\"chapters\":[{\"title\":\"章节标题\",\"summary\":\"本章剧情概要\"}]}。章节必须从开端到结局推进完整故事，严格返回用户要求的章节数。",
      },
      {
        role: "user",
        content: `小说名称：${title}\n题材：${genre || "由你根据故事灵感判断"}\n故事灵感：${premise || "请根据小说名称和题材构思一个完整、有新意的故事。"}\n计划章节数：${chapterCount}`,
      },
    ],
  };
}

function chapterMessages(body) {
  const title = requireText(body, "title", "小说名称", { max: 500 });
  const genre = requireText(body, "genre", "题材", { optional: true, max: 500 });
  const premise = requireText(body, "premise", "故事灵感", { optional: true, max: 20_000 });
  const outline = requireText(body, "outline", "故事梗概", { optional: true, max: 30_000 });
  const previousChapter = requireText(body, "previousChapter", "上一章正文", {
    optional: true,
    max: 80_000,
  });
  const chapter = body.chapter;

  if (
    !isRecord(chapter) ||
    typeof chapter.title !== "string" ||
    typeof chapter.summary !== "string"
  ) {
    const error = new Error("当前章节信息无效。");
    error.statusCode = 400;
    throw error;
  }

  const outlineChapters = requireOutlineChapters(body);

  return [
    {
      role: "system",
      content:
        "你是一位中文小说作家。根据已定大纲创作当前一章正文，写出完整、有画面感的剧情，保持人物、叙事视角和前文一致。只输出小说正文，不要标题解释、摘要或创作说明；除非剧情需要，不要复述之前发生的内容。",
    },
    {
      role: "user",
      content: [
        `小说名称：${title}`,
        `题材：${genre || "未指定"}`,
        `故事灵感：${premise || "未指定"}`,
        `故事梗概：${outline || "未指定"}`,
        `完整章节规划：\n${outlineChapters.map((item, index) => `${index + 1}. ${item.title}：${item.summary}`).join("\n") || "暂无"}`,
        `当前章节：${chapter.title.slice(0, 500)}`,
        `本章概要：${chapter.summary.slice(0, 10_000)}`,
        previousChapter ? `上一章正文（用于保持连贯）：\n${previousChapter}` : "",
        "请完成本章正文，并为后续章节留下自然的发展空间。",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}

function upstreamErrorMessage(status) {
  return `模型服务请求失败（HTTP ${status}），请检查服务地址、模型名称和 API Key。`;
}

function createUpstreamRequest(config, messages, jsonResponse, fetchImpl) {
  const url = `${config.baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

  return fetchImpl(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      ...(jsonResponse ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
}

export function createNovelServer(config, fetchImpl = globalThis.fetch) {
  return createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;

    if (request.method === "GET" && pathname === "/api/status") {
      sendJson(response, 200, { configured: Boolean(getModelConfig(config)) });
      return;
    }

    if (request.method !== "POST" || !["/api/outline", "/api/chapter"].includes(pathname)) {
      sendJson(response, 404, { error: "找不到该接口。" });
      return;
    }

    const modelConfig = getModelConfig(config);
    if (!modelConfig) {
      sendJson(response, 503, {
        error: "模型服务尚未配置。请在项目根目录创建 .env.local，填写服务地址、模型名称和 API Key 后重新启动。",
        code: "MODEL_NOT_CONFIGURED",
      });
      return;
    }

    try {
      const body = await readJsonBody(request);
      if (!isRecord(body)) {
        sendJson(response, 400, { error: "请求格式无效，请重试。" });
        return;
      }

      const outlineRequest = pathname === "/api/outline";
      const prepared = outlineRequest ? outlineMessages(body) : null;
      const messages = prepared?.messages ?? chapterMessages(body);
      const result = await createUpstreamRequest(
        modelConfig,
        messages,
        outlineRequest,
        fetchImpl,
      );

      let payload;
      try {
        payload = await result.json();
      } catch {
        sendJson(response, 502, {
          error: "模型服务返回了无法识别的响应，请检查 API 地址是否正确。",
        });
        return;
      }

      if (!result.ok) {
        sendJson(response, 502, {
          error: upstreamErrorMessage(result.status),
        });
        return;
      }

      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.trim().length === 0) {
        sendJson(response, 502, { error: "模型没有返回生成内容，请重试或更换模型。" });
        return;
      }

      sendJson(
        response,
        200,
        outlineRequest ? parseOutline(content, prepared.chapterCount) : { content: content.trim() },
      );
    } catch (error) {
      if (error?.name === "AbortError") {
        sendJson(response, 504, { error: "模型生成超时，请重试；较长的章节可能需要更久。" });
        return;
      }
      if (Number.isInteger(error?.statusCode)) {
        sendJson(response, error.statusCode, { error: error.message });
        return;
      }
      if (error instanceof TypeError) {
        sendJson(response, 502, {
          error: "无法连接模型服务，请检查 API 地址和网络后重试。",
        });
        return;
      }
      if (error instanceof SyntaxError) {
        sendJson(response, 502, { error: "模型返回的大纲格式无法解析，请重试。" });
        return;
      }
      sendJson(response, 502, {
        error: error instanceof Error ? error.message : "模型生成失败，请重试。",
      });
    }
  });
}
