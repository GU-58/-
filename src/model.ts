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
  generateOutline(request: OutlineRequest): Promise<OutlineResult>;
  generateChapter(request: ChapterRequest): Promise<string>;
}

export class ModelNotConfiguredError extends Error {
  constructor() {
    super("模型服务尚未接入。配置模型适配器后即可生成大纲和章节。");
    this.name = "ModelNotConfiguredError";
  }
}

export function createUnconfiguredWriter(): NovelWriter {
  return {
    async generateOutline() {
      throw new ModelNotConfiguredError();
    },
    async generateChapter() {
      throw new ModelNotConfiguredError();
    },
  };
}
