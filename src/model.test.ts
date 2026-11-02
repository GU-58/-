import { describe, expect, it } from "vitest";
import { createUnconfiguredWriter, ModelNotConfiguredError } from "./model";

describe("createUnconfiguredWriter", () => {
  it("makes outline generation fail explicitly until a provider is configured", async () => {
    await expect(
      createUnconfiguredWriter().generateOutline({
        title: "雾中来信",
        genre: "悬疑",
        premise: "一封信改变了一座小镇。",
        chapterCount: 12,
      }),
    ).rejects.toBeInstanceOf(ModelNotConfiguredError);
  });

  it("makes chapter generation fail explicitly until a provider is configured", async () => {
    await expect(
      createUnconfiguredWriter().generateChapter({
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
});
