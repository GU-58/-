export interface OutlineChapter {
  id: string;
  title: string;
  summary: string;
}

export interface NovelProject {
  id: string;
  title: string;
  genre: string;
  premise: string;
  plannedChapterCount: number;
  outline: string;
  outlineChapters: OutlineChapter[];
  chapters: Record<string, string>;
  activeChapterId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function createNovelProject(): NovelProject {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "未命名小说",
    genre: "",
    premise: "",
    plannedChapterCount: 12,
    outline: "",
    outlineChapters: [],
    chapters: {},
    activeChapterId: null,
    createdAt: now,
    updatedAt: now,
  };
}
