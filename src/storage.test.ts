import { describe, expect, it } from "vitest";
import { createProjectStore, STORAGE_KEY, type StorageLike } from "./storage";
import type { NovelProject } from "./types";

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const project: NovelProject = {
  id: "project-1",
  title: "雾中来信",
  genre: "悬疑",
  premise: "一封迟到的信改变了一座小镇。",
  plannedChapterCount: 12,
  outline: "她沿着信件寻找寄信人。",
  outlineChapters: [],
  chapters: {},
  activeChapterId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("createProjectStore", () => {
  it("loads an empty collection when no projects have been saved", () => {
    expect(createProjectStore(new MemoryStorage()).load()).toEqual([]);
  });

  it("round-trips saved projects", () => {
    const storage = new MemoryStorage();
    const store = createProjectStore(storage);

    store.save([project]);

    expect(storage.getItem(STORAGE_KEY)).toContain("雾中来信");
    expect(store.load()).toEqual([project]);
  });

  it("reports invalid stored data instead of silently discarding it", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, '{"not":"a project list"}');

    expect(() => createProjectStore(storage).load()).toThrow("本地小说数据格式无效");
  });

  it("reports invalid project entries inside the stored collection", () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify([{ id: "incomplete" }]));

    expect(() => createProjectStore(storage).load()).toThrow("本地小说数据格式无效");
  });
});
