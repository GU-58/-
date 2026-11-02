import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createNovelServer } from "./app.mjs";

const servers = new Set();

async function withServer(config, fetchImpl, run) {
  const server = createNovelServer(config, fetchImpl);
  servers.add(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    servers.delete(server);
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

afterEach(async () => {
  for (const server of servers) {
    await new Promise((resolve) => server.close(resolve));
  }
  servers.clear();
});

describe("novel generation API", () => {
  it("reports whether the model server has secure credentials configured", async () => {
    await withServer({ apiKey: "", baseUrl: "", model: "" }, undefined, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/status`);
      assert.deepEqual(await response.json(), { configured: false });
    });

    await withServer(
      { apiKey: "secret", baseUrl: "https://models.example/v1/", model: "writer" },
      undefined,
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/status`);
        assert.deepEqual(await response.json(), { configured: true });
      },
    );
  });

  it("refuses generation until a model is configured", async () => {
    let upstreamCalled = false;
    await withServer(
      { apiKey: "", baseUrl: "", model: "" },
      async () => {
        upstreamCalled = true;
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/outline`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "雾中来信", chapterCount: 8 }),
        });
        assert.equal(response.status, 503);
        assert.equal((await response.json()).code, "MODEL_NOT_CONFIGURED");
        assert.equal(upstreamCalled, false);
      },
    );
  });

  it("asks the configured model for a structured outline", async () => {
    await withServer(
      {
        apiKey: "private-token",
        baseUrl: "https://models.example/v1/",
        model: "writer",
      },
      async (url, options) => {
        assert.equal(url, "https://models.example/v1/chat/completions");
        assert.equal(options.headers.authorization, "Bearer private-token");
        const request = JSON.parse(options.body);
        assert.equal(request.response_format.type, "json_object");
        assert.match(request.messages[1].content, /计划章节数：2/);
        return Response.json({
          choices: [
            {
              message: {
                content:
                  '{"summary":"一段故事","chapters":[{"title":"第一章","summary":"初遇"},{"title":"第二章","summary":"转折"}]}',
              },
            },
          ],
        });
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/outline`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "雾中来信",
            genre: "悬疑",
            premise: "一封信改变了一座小镇。",
            chapterCount: 2,
          }),
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          summary: "一段故事",
          chapters: [
            { id: "chapter-1", title: "第一章", summary: "初遇" },
            { id: "chapter-2", title: "第二章", summary: "转折" },
          ],
        });
      },
    );
  });

  it("sends the story outline and previous chapter when generating chapter prose", async () => {
    await withServer(
      {
        apiKey: "private-token",
        baseUrl: "https://models.example/v1",
        model: "writer",
      },
      async (url, options) => {
        assert.equal(url, "https://models.example/v1/chat/completions");
        const request = JSON.parse(options.body);
        assert.equal(request.response_format, undefined);
        assert.match(request.messages[1].content, /雾中来信/);
        assert.match(request.messages[1].content, /上一章正文（用于保持连贯）/);
        return Response.json({
          choices: [{ message: { content: "天亮前，信终于有了回音。" } }],
        });
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/chapter`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "雾中来信",
            genre: "悬疑",
            premise: "一封信改变了一座小镇。",
            outline: "她找到寄信人。",
            outlineChapters: [
              { title: "第一章", summary: "发现信" },
              { title: "第二章", summary: "寻找寄信人" },
            ],
            chapter: { id: "chapter-2", title: "第二章", summary: "寻找寄信人" },
            previousChapter: "河边的旧邮筒里躺着一封信。",
          }),
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          content: "天亮前，信终于有了回音。",
        });
      },
    );
  });

  it("rejects invalid chapter counts without contacting the provider", async () => {
    let upstreamCalled = false;
    await withServer(
      { apiKey: "private-token", baseUrl: "https://models.example/v1", model: "writer" },
      async () => {
        upstreamCalled = true;
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/outline`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "雾中来信", chapterCount: 0 }),
        });
        assert.equal(response.status, 400);
        assert.equal(upstreamCalled, false);
      },
    );
  });

  it("does not return credentials echoed by an upstream provider", async () => {
    await withServer(
      { apiKey: "private-token", baseUrl: "https://models.example/v1", model: "writer" },
      async () =>
        Response.json(
          { error: { message: "Invalid key: Bearer private-token" } },
          { status: 401 },
        ),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/outline`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "雾中来信", chapterCount: 1 }),
        });
        const result = await response.text();
        assert.equal(response.status, 502);
        assert.equal(result.includes("private-token"), false);
        assert.match(result, /检查服务地址、模型名称和 API Key/);
      },
    );
  });
});
