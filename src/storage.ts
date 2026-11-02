import type { NovelProject } from "./types";

export const STORAGE_KEY = "paper-between-pages.projects.v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ProjectStore {
  load(): NovelProject[];
  save(projects: NovelProject[]): void;
}

function isOutlineChapter(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const chapter = value as Record<string, unknown>;
  return (
    typeof chapter.id === "string" &&
    typeof chapter.title === "string" &&
    typeof chapter.summary === "string"
  );
}

function isNovelProject(value: unknown): value is NovelProject {
  if (typeof value !== "object" || value === null) return false;
  const project = value as Record<string, unknown>;
  const chapters = project.chapters;

  return (
    typeof project.id === "string" &&
    typeof project.title === "string" &&
    typeof project.genre === "string" &&
    typeof project.premise === "string" &&
    typeof project.plannedChapterCount === "number" &&
    Number.isInteger(project.plannedChapterCount) &&
    project.plannedChapterCount > 0 &&
    typeof project.outline === "string" &&
    Array.isArray(project.outlineChapters) &&
    project.outlineChapters.every(isOutlineChapter) &&
    (typeof project.activeChapterId === "string" || project.activeChapterId === null) &&
    typeof chapters === "object" &&
    chapters !== null &&
    !Array.isArray(chapters) &&
    Object.values(chapters).every((content) => typeof content === "string") &&
    typeof project.createdAt === "string" &&
    typeof project.updatedAt === "string"
  );
}

export function createProjectStore(storage: StorageLike): ProjectStore {
  return {
    load() {
      const saved = storage.getItem(STORAGE_KEY);
      if (saved === null) return [];

      const projects: unknown = JSON.parse(saved);
      if (!Array.isArray(projects) || !projects.every(isNovelProject)) {
        throw new Error("本地小说数据格式无效，无法读取。");
      }

      return projects;
    },
    save(projects) {
      storage.setItem(STORAGE_KEY, JSON.stringify(projects));
    },
  };
}
