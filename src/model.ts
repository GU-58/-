import type { OutlineChapter } from "./types";

export interface OutlineRequest {
  title: string;
  genre: string;
  premise: string;
  chapterCount: number;
}

export interface OutlineResult {
  summary: string;
  chapters: OutlineChapter[];
}

export interface ChapterRequest {
  title: string;
  genre: string;
  premise: string;
  outline: string;
  outlineChapters: OutlineChapter[];
  chapter: OutlineChapter;
  previousChapter: string;
}

export interface NovelWriter {
  getStatus(): Promise<ModelStatus>;
  generateOutline(request: OutlineRequest): Promise<OutlineResult>;
  generateChapter(request: ChapterRequest): Promise<string>;
}

export interface ModelStatus {
  configured: boolean;
}

export class ModelNotConfiguredError extends Error {
  constructor() {
    super("模型服务尚未配置。请在项目根目录创建 .env.local 并填写模型服务地址、模型名称和 API Key，然后重启应用。");
    this.name = "ModelNotConfiguredError";
  }
}

export class ModelRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelRequestError";
  }
}

async function postJson<T>(
  fetchImpl: typeof fetch,
  path: string,
  body: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ModelRequestError("无法连接本地生成服务，请检查应用是否正在运行。");
  }

  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      typeof result === "object" && result !== null && "error" in result
        ? result.error
        : null;
    const message = typeof error === "string" ? error : "模型生成失败，请重试。";
    if (
      response.status === 503 &&
      typeof result === "object" &&
      result !== null &&
      "code" in result &&
      result.code === "MODEL_NOT_CONFIGURED"
    ) {
      throw new ModelNotConfiguredError();
    }
    throw new ModelRequestError(message);
  }

  if (typeof result !== "object" || result === null) {
    throw new ModelRequestError("本地生成服务返回了无法识别的结果，请重试。");
  }

  return result as T;
}

export function createApiWriter(fetchImpl: typeof fetch = fetch): NovelWriter {
  return {
    async getStatus() {
      let response: Response;
      try {
        response = await fetchImpl("/api/status");
      } catch {
        throw new ModelRequestError("无法连接本地生成服务，请重启应用后再试。");
      }

      if (!response.ok) {
        throw new ModelRequestError("无法读取模型服务状态，请稍后重试。");
      }
      return (await response.json()) as ModelStatus;
    },
    generateOutline(request) {
      return postJson<OutlineResult>(fetchImpl, "/api/outline", request);
    },
    async generateChapter(request) {
      const result = await postJson<{ content: string }>(
        fetchImpl,
        "/api/chapter",
        request,
      );
      if (typeof result.content !== "string" || result.content.trim().length === 0) {
        throw new ModelRequestError("模型没有返回章节正文，请重试。");
      }
      return result.content;
    },
  };
}
