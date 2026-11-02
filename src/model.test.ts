import { describe, expect, it } from "vitest";
import {
  createApiWriter,
  ModelNotConfiguredError,
  ModelRequestError,
} from "./model";

describe("createApiWriter", () => {
  it("reads the model server status without exposing credentials", async () => {
    const writer = createApiWriter(async (url) => {
      expect(url).toBe("/api/status");
      return Response.json({ configured: true });
    });

    await expect(writer.getStatus()).resolves.toEqual({ configured: true });
  });

  it("sends outline requests to the local generation API", async () => {
    const writer = createApiWriter(async (url, options) => {
      expect(url).toBe("/api/outline");
      expect(JSON.parse(String(options?.body))).toEqual({
        title: "雾中来信",
        genre: "悬疑",
        premise: "一封信改变了一座小镇。",
        chapterCount: 12,
      });
      return Response.json({
        summary: "完整故事",
        chapters: [{ id: "chapter-1", title: "第一章", summary: "相遇" }],
      });
    });

    await expect(
      writer.generateOutline({
        title: "雾中来信",
        genre: "悬疑",
        premise: "一封信改变了一座小镇。",
        chapterCount: 12,
      }),
    ).resolves.toMatchObject({ summary: "完整故事" });
  });

  it("surfaces the explicit model setup guidance when credentials are missing", async () => {
    const writer = createApiWriter(async () =>
      Response.json(
        {
          error: "模型服务尚未配置。",
          code: "MODEL_NOT_CONFIGURED",
        },
        { status: 503 },
      ),
    );

    await expect(
      writer.generateChapter({
        title: "雾中来信",
        genre: "悬疑",
        premise: "一封信改变了一座小镇。",
        outline: "",
        outlineChapters: [],
        chapter: { id: "chapter-1", title: "第一章", summary: "" },
        previousChapter: "",
      }),
    ).rejects.toBeInstanceOf(ModelNotConfiguredError);
  });

  it("reports local server and upstream errors clearly", async () => {
    const unavailable = createApiWriter(async () => {
      throw new TypeError("fetch failed");
    });

    await expect(unavailable.getStatus()).rejects.toThrow("无法连接本地生成服务");

    const rejected = createApiWriter(async () =>
      Response.json({ error: "API Key 无效" }, { status: 502 }),
    );

    await expect(
      rejected.generateOutline({
        title: "雾中来信",
        genre: "悬疑",
        premise: "",
        chapterCount: 12,
      }),
    ).rejects.toBeInstanceOf(ModelRequestError);
  });
});
