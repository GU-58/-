import { useEffect, useMemo, useState } from "react";
import {
  createApiWriter,
  ModelNotConfiguredError,
  type ChapterRequest,
} from "./model";
import { createProjectStore } from "./storage";
import { createNovelProject, type NovelProject, type OutlineChapter } from "./types";

type WorkspaceView = "outline" | "chapters";
type ModelConnection = "checking" | "configured" | "unconfigured" | "unavailable";
type Generating = "outline" | "chapter" | null;

interface InitialState {
  projects: NovelProject[];
  storageReady: boolean;
  storageError: string | null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "发生了未知错误。";
}

function loadInitialState(): InitialState {
  if (typeof window === "undefined") {
    return { projects: [], storageReady: false, storageError: null };
  }

  try {
    const projects = createProjectStore(window.localStorage).load();
    return { projects, storageReady: true, storageError: null };
  } catch (error) {
    return {
      projects: [],
      storageReady: false,
      storageError: `本地小说数据读取失败，为保护原有内容，本次不会覆盖它：${errorText(error)}`,
    };
  }
}

function newOutlineChapter(index: number): OutlineChapter {
  return {
    id: crypto.randomUUID(),
    title: `第${index}章`,
    summary: "",
  };
}

export default function App() {
  const [initialState] = useState(loadInitialState);
  const [projects, setProjects] = useState(initialState.projects);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    initialState.projects[0]?.id ?? null,
  );
  const [activeView, setActiveView] = useState<WorkspaceView>("outline");
  const [storageReady, setStorageReady] = useState(initialState.storageReady);
  const [storageError, setStorageError] = useState(initialState.storageError);
  const [notice, setNotice] = useState<string | null>(null);
  const [modelConnection, setModelConnection] = useState<ModelConnection>("checking");
  const [generating, setGenerating] = useState<Generating>(null);
  const writer = useMemo(() => createApiWriter(), []);
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null;
  const activeChapter =
    activeProject?.outlineChapters.find(
      (chapter) => chapter.id === activeProject.activeChapterId,
    ) ??
    activeProject?.outlineChapters[0] ??
    null;

  useEffect(() => {
    if (!storageReady) return;

    try {
      createProjectStore(window.localStorage).save(projects);
      setStorageError(null);
    } catch (error) {
      setStorageError(`本地保存失败，请检查浏览器存储空间或权限：${errorText(error)}`);
      setStorageReady(false);
    }
  }, [projects, storageReady]);

  useEffect(() => {
    let active = true;
    writer
      .getStatus()
      .then(({ configured }) => {
        if (active) setModelConnection(configured ? "configured" : "unconfigured");
      })
      .catch(() => {
        if (active) setModelConnection("unavailable");
      });

    return () => {
      active = false;
    };
  }, [writer]);

  function updateActiveProject(
    update: (project: NovelProject) => NovelProject,
  ) {
    if (!activeProject) return;

    setProjects((current) =>
      current.map((project) =>
        project.id === activeProject.id
          ? { ...update(project), updatedAt: new Date().toISOString() }
          : project,
      ),
    );
  }

  function createProject() {
    const project = createNovelProject();
    setProjects((current) => [project, ...current]);
    setActiveProjectId(project.id);
    setActiveView("outline");
    setNotice(null);
  }

  function updateChapter(chapterId: string, patch: Partial<OutlineChapter>) {
    updateActiveProject((project) => ({
      ...project,
      outlineChapters: project.outlineChapters.map((chapter) =>
        chapter.id === chapterId ? { ...chapter, ...patch } : chapter,
      ),
    }));
  }

  function addChapter() {
    if (!activeProject) return;
    const chapter = newOutlineChapter(activeProject.outlineChapters.length + 1);
    updateActiveProject((project) => ({
      ...project,
      outlineChapters: [...project.outlineChapters, chapter],
      activeChapterId: chapter.id,
    }));
  }

  function removeChapter(chapterId: string) {
    updateActiveProject((project) => {
      const outlineChapters = project.outlineChapters.filter(
        (chapter) => chapter.id !== chapterId,
      );
      const chapters = { ...project.chapters };
      delete chapters[chapterId];

      return {
        ...project,
        outlineChapters,
        chapters,
        activeChapterId:
          project.activeChapterId === chapterId
            ? outlineChapters[0]?.id ?? null
            : project.activeChapterId,
      };
    });
  }

  async function generateOutline() {
    if (!activeProject || generating) return;
    if (
      activeProject.outlineChapters.length > 0 &&
      !window.confirm("重新生成会替换当前大纲；已有章节正文会保留在对应章节中。确定继续吗？")
    ) {
      return;
    }

    setGenerating("outline");
    try {
      const result = await writer.generateOutline({
        title: activeProject.title,
        genre: activeProject.genre,
        premise: activeProject.premise,
        chapterCount: activeProject.plannedChapterCount,
      });
      updateActiveProject((project) => ({
        ...project,
        outline: result.summary,
        outlineChapters: result.chapters.map((chapter, index) => ({
          ...chapter,
          id: project.outlineChapters[index]?.id ?? chapter.id,
        })),
        activeChapterId:
          result.chapters.length > 0
            ? project.outlineChapters[0]?.id ?? result.chapters[0].id
            : null,
      }));
      setNotice(null);
    } catch (error) {
      setNotice(
        error instanceof ModelNotConfiguredError
          ? error.message
          : `大纲生成失败：${errorText(error)}`,
      );
    } finally {
      setGenerating(null);
    }
  }

  async function generateChapter() {
    if (!activeProject || !activeChapter || generating) return;
    if (
      activeProject.chapters[activeChapter.id]?.trim() &&
      modelConnection === "configured" &&
      !window.confirm("重新生成会替换当前章节正文，确定继续吗？")
    ) {
      return;
    }

    const chapterIndex = activeProject.outlineChapters.findIndex(
      (chapter) => chapter.id === activeChapter.id,
    );
    const request: ChapterRequest = {
      title: activeProject.title,
      genre: activeProject.genre,
      premise: activeProject.premise,
      outline: activeProject.outline,
      outlineChapters: activeProject.outlineChapters,
      chapter: activeChapter,
      previousChapter:
        chapterIndex > 0
          ? activeProject.chapters[activeProject.outlineChapters[chapterIndex - 1].id] ?? ""
          : "",
    };

    setGenerating("chapter");
    try {
      const content = await writer.generateChapter(request);
      updateActiveProject((project) => ({
        ...project,
        chapters: { ...project.chapters, [activeChapter.id]: content },
      }));
      setNotice(null);
    } catch (error) {
      setNotice(
        error instanceof ModelNotConfiguredError
          ? error.message
          : `章节生成失败：${errorText(error)}`,
      );
    } finally {
      setGenerating(null);
    }
  }

  const modelStatusText =
    modelConnection === "configured"
      ? "AI 服务已连接"
      : modelConnection === "checking"
        ? "正在检查 AI 服务"
        : modelConnection === "unavailable"
          ? "AI 服务无法连接"
          : "AI 服务未配置";

  const completedChapters = activeProject
    ? activeProject.outlineChapters.filter(
        (chapter) => (activeProject.chapters[chapter.id] ?? "").trim().length > 0,
      ).length
    : 0;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand" aria-label="纸间小说创作工作台">
          <span className="brand-mark">纸</span>
          <span className="brand-name">纸间</span>
        </div>

        <div className="sidebar-label">创作空间</div>
        <button className="new-project-button" onClick={createProject}>
          <span className="plus-mark" aria-hidden="true">+</span>
          <span className="new-project-label">新建小说</span>
        </button>

        <div className="project-list" aria-label="小说项目列表">
          {projects.map((project) => (
            <button
              className={`project-link${project.id === activeProjectId ? " selected" : ""}`}
              key={project.id}
              onClick={() => {
                setActiveProjectId(project.id);
                setActiveView("outline");
                setNotice(null);
              }}
            >
              <span className="project-link-mark" aria-hidden="true">
                {project.title.slice(0, 1) || "书"}
              </span>
              <span className="project-link-copy">
                <span className="project-link-title">{project.title || "未命名小说"}</span>
                <span className="project-link-meta">
                  {project.outlineChapters.length > 0
                    ? `${project.outlineChapters.length} 章大纲`
                    : "新建项目"}
                </span>
              </span>
              {project.id === activeProjectId && <span className="selected-dot" />}
            </button>
          ))}
          {projects.length === 0 && (
            <p className="sidebar-empty">你的故事还在等一个开始。</p>
          )}
        </div>

        <div className="sidebar-bottom">
          <span className="sidebar-bottom-icon" aria-hidden="true">✦</span>
          <span>让故事慢慢长出来</span>
        </div>
      </aside>

      <main className="main-content">
        {activeProject ? (
          <>
            <header className="topbar">
              <div className="breadcrumb">
                <span>我的小说</span>
                <span className="breadcrumb-divider">/</span>
                <strong>{activeProject.title || "未命名小说"}</strong>
              </div>
              <div className="save-status">
                <span className={`status-dot${storageError ? " error" : ""}`} />
                {storageError ? "保存异常" : "保存在此浏览器"}
              </div>
            </header>

            <div className="workspace">
              <section className="workspace-heading">
                <div>
                  <div className="eyebrow">YOUR STORY, YOUR PACE</div>
                  <h1>{activeProject.title || "未命名小说"}</h1>
                  <p className="workspace-subtitle">
                    从一颗故事种子开始，先搭好骨架，再一章一章写下去。
                  </p>
                </div>
                <div className="chapter-progress">
                  <div className="progress-copy">
                    <span>写作进度</span>
                    <strong>
                      {completedChapters}
                      <span> / {activeProject.outlineChapters.length || "—"} 章</span>
                    </strong>
                  </div>
                  <div className="progress-track">
                    <span
                      style={{
                        width: `${
                          activeProject.outlineChapters.length
                            ? (completedChapters / activeProject.outlineChapters.length) * 100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              </section>

              <nav className="workflow-tabs" aria-label="创作步骤">
                <button
                  className={`workflow-tab${activeView === "outline" ? " active" : ""}`}
                  onClick={() => setActiveView("outline")}
                  aria-current={activeView === "outline" ? "step" : undefined}
                >
                  <span className="step-number">01</span>
                  <span>故事大纲</span>
                </button>
                <span className="workflow-connector" />
                <button
                  className={`workflow-tab${activeView === "chapters" ? " active" : ""}`}
                  onClick={() => setActiveView("chapters")}
                  aria-current={activeView === "chapters" ? "step" : undefined}
                >
                  <span className="step-number">02</span>
                  <span>逐章写作</span>
                  <span className="tab-count">{activeProject.outlineChapters.length}</span>
                </button>
              </nav>

              {storageError && (
                <div className="inline-alert storage-alert" role="alert">
                  <span className="alert-icon" aria-hidden="true">!</span>
                  <span>{storageError}</span>
                </div>
              )}
              {notice && (
                <div className="inline-alert" role="alert">
                  <span className="alert-icon" aria-hidden="true">!</span>
                  <span>{notice}</span>
                  <button
                    className="alert-dismiss"
                    onClick={() => setNotice(null)}
                    aria-label="关闭提示"
                  >
                    ×
                  </button>
                </div>
              )}

              {activeView === "outline" ? (
                <div className="outline-layout">
                  <section className="card story-card">
                    <div className="card-heading">
                      <div>
                        <div className="section-kicker">STEP ONE · 故事设定</div>
                        <h2>先认识你的故事</h2>
                        <p>不用一次想得很完整，一句话也可以是很好的开始。</p>
                      </div>
                      <span className="card-ornament" aria-hidden="true">✳</span>
                    </div>

                    <label className="field-label" htmlFor="novel-title">小说名称</label>
                    <input
                      id="novel-title"
                      className="text-input"
                      value={activeProject.title}
                      onChange={(event) =>
                        updateActiveProject((project) => ({
                          ...project,
                          title: event.target.value,
                        }))
                      }
                      placeholder="给故事起个名字"
                    />

                    <div className="field-row">
                      <label className="field-group">
                        <span className="field-label">题材 / 类型</span>
                        <input
                          className="text-input"
                          value={activeProject.genre}
                          onChange={(event) =>
                            updateActiveProject((project) => ({
                              ...project,
                              genre: event.target.value,
                            }))
                          }
                          placeholder="例如：奇幻、悬疑、都市"
                        />
                      </label>
                      <label className="field-group count-field">
                        <span className="field-label">计划章节</span>
                        <input
                          className="text-input"
                          type="number"
                          min={1}
                          max={500}
                          value={activeProject.plannedChapterCount}
                          onChange={(event) =>
                            updateActiveProject((project) => ({
                              ...project,
                              plannedChapterCount: Math.max(
                                1,
                                Math.min(500, Number(event.target.value) || 1),
                              ),
                            }))
                          }
                        />
                      </label>
                    </div>

                    <label className="field-label" htmlFor="novel-premise">故事灵感</label>
                    <textarea
                      id="novel-premise"
                      className="text-input premise-input"
                      value={activeProject.premise}
                      onChange={(event) =>
                        updateActiveProject((project) => ({
                          ...project,
                          premise: event.target.value,
                        }))
                      }
                      placeholder="主角是谁？故事发生在哪里？有什么事情即将改变一切？"
                      rows={4}
                    />

                    <button
                      className="button button-primary generate-button"
                      onClick={generateOutline}
                      disabled={generating !== null}
                    >
                      {generating === "outline" ? (
                        <span className="loading-spinner" aria-hidden="true" />
                      ) : (
                        <span aria-hidden="true">✦</span>
                      )}
                      {generating === "outline" ? "AI 正在构思大纲…" : "AI 生成故事大纲"}
                      {modelConnection !== "configured" && (
                        <span className="button-subtle">需要配置</span>
                      )}
                    </button>
                  </section>

                  <section className="card outline-card">
                    <div className="outline-card-heading">
                      <div>
                        <div className="section-kicker">STORY OUTLINE</div>
                        <h2>故事大纲</h2>
                      </div>
                      <button className="button button-secondary" onClick={addChapter}>
                        <span className="plus-mark" aria-hidden="true">+</span>
                        添加章节
                      </button>
                    </div>

                    <label className="field-label" htmlFor="outline-summary">故事梗概</label>
                    <textarea
                      id="outline-summary"
                      className="text-input outline-summary"
                      value={activeProject.outline}
                      onChange={(event) =>
                        updateActiveProject((project) => ({
                          ...project,
                          outline: event.target.value,
                        }))
                      }
                      placeholder="大纲生成后，故事梗概会显示在这里。你也可以先手动写下故事走向。"
                      rows={3}
                    />

                    <div className="outline-list-heading">
                      <span>章节规划</span>
                      <span className="outline-total">
                        {activeProject.outlineChapters.length} 章
                      </span>
                    </div>
                    {activeProject.outlineChapters.length > 0 ? (
                      <div className="outline-list">
                        {activeProject.outlineChapters.map((chapter, index) => (
                          <article className="outline-row" key={chapter.id}>
                            <span className="outline-index">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <div className="outline-row-fields">
                              <input
                                className="outline-title-input"
                                value={chapter.title}
                                onChange={(event) =>
                                  updateChapter(chapter.id, { title: event.target.value })
                                }
                                aria-label={`第 ${index + 1} 章标题`}
                              />
                              <textarea
                                className="outline-summary-input"
                                value={chapter.summary}
                                onChange={(event) =>
                                  updateChapter(chapter.id, { summary: event.target.value })
                                }
                                placeholder="这一章会发生什么？"
                                rows={2}
                                aria-label={`第 ${index + 1} 章内容概要`}
                              />
                            </div>
                            <button
                              className="icon-button remove-button"
                              onClick={() => removeChapter(chapter.id)}
                              aria-label={`删除第 ${index + 1} 章`}
                              title="删除章节"
                            >
                              ×
                            </button>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="outline-empty">
                        <span className="outline-empty-mark" aria-hidden="true">✳</span>
                        <strong>这里会成为故事的路线图</strong>
                        <span>可以先手动规划章节，也可以配置 AI 服务后生成故事大纲。</span>
                        <button className="text-button" onClick={addChapter}>
                          + 添加第一章
                        </button>
                      </div>
                    )}
                  </section>
                </div>
              ) : (
                <section className="card writing-card">
                  <div className="writing-sidebar">
                    <div className="writing-sidebar-heading">
                      <div>
                        <div className="section-kicker">YOUR CHAPTERS</div>
                        <h2>章节</h2>
                      </div>
                      <span className="outline-total">{activeProject.outlineChapters.length}</span>
                    </div>
                    {activeProject.outlineChapters.length > 0 ? (
                      <div className="chapter-list">
                        {activeProject.outlineChapters.map((chapter, index) => {
                          const hasContent = Boolean(
                            activeProject.chapters[chapter.id]?.trim(),
                          );
                          return (
                            <button
                              className={`chapter-link${
                                activeChapter?.id === chapter.id ? " selected" : ""
                              }`}
                              key={chapter.id}
                              onClick={() =>
                                updateActiveProject((project) => ({
                                  ...project,
                                  activeChapterId: chapter.id,
                                }))
                              }
                            >
                              <span className="chapter-link-number">
                                {String(index + 1).padStart(2, "0")}
                              </span>
                              <span className="chapter-link-title">
                                {chapter.title || `第${index + 1}章`}
                              </span>
                              <span
                                className={`chapter-state${hasContent ? " written" : ""}`}
                                aria-label={hasContent ? "已有正文" : "尚未写作"}
                              />
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="chapter-list-empty">
                        先在「故事大纲」中添加章节，再开始逐章写作。
                        <button className="text-button" onClick={() => setActiveView("outline")}>
                          返回故事大纲
                        </button>
                      </div>
                    )}
                    <button className="add-chapter-link" onClick={addChapter}>
                      <span aria-hidden="true">+</span> 添加章节
                    </button>
                  </div>

                  <div className="chapter-editor">
                    {activeChapter ? (
                      <>
                        <div className="editor-topline">
                          <span>
                            第{" "}
                            {activeProject.outlineChapters.findIndex(
                              (chapter) => chapter.id === activeChapter.id,
                            ) + 1}{" "}
                            章
                          </span>
                          <span className="editor-saved">
                            <span className="status-dot" /> 自动保存在本地
                          </span>
                        </div>
                        <input
                          className="chapter-title-input"
                          value={activeChapter.title}
                          onChange={(event) =>
                            updateChapter(activeChapter.id, { title: event.target.value })
                          }
                          aria-label="章节标题"
                        />
                        {activeChapter.summary && (
                          <div className="chapter-prompt">
                            <span>本章概要</span>
                            <p>{activeChapter.summary}</p>
                          </div>
                        )}
                        <textarea
                          className="chapter-writing-area"
                          value={activeProject.chapters[activeChapter.id] ?? ""}
                          onChange={(event) =>
                            updateActiveProject((project) => ({
                              ...project,
                              chapters: {
                                ...project.chapters,
                                [activeChapter.id]: event.target.value,
                              },
                            }))
                          }
                          placeholder="从这里开始写下这一章……&#10;&#10;不用急着写得完美，让故事先流动起来。"
                          aria-label="章节正文"
                        />
                        <div className="editor-footer">
                          <span>
                            {
                              Array.from(
                                (activeProject.chapters[activeChapter.id] ?? "").replace(
                                  /\s/g,
                                  "",
                                ),
                              ).length
                            }{" "}
                            字
                          </span>
                          <button
                            className="button button-primary"
                            onClick={generateChapter}
                            disabled={generating !== null}
                            title={
                              activeProject.chapters[activeChapter.id]?.trim()
                                ? "重新生成会替换现有正文"
                                : "根据小说设定和章节大纲生成正文"
                            }
                          >
                            {generating === "chapter" ? (
                              <span className="loading-spinner" aria-hidden="true" />
                            ) : (
                              <span aria-hidden="true">✦</span>
                            )}
                            {generating === "chapter"
                              ? "AI 正在撰写本章…"
                              : activeProject.chapters[activeChapter.id]?.trim()
                                ? "AI 重新生成本章"
                                : "AI 生成本章"}
                            {modelConnection !== "configured" && generating !== "chapter" && (
                              <span className="button-subtle">需要配置</span>
                            )}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="editor-empty">
                        <span className="editor-empty-mark" aria-hidden="true">写</span>
                        <h3>每一章，都是故事向前的一步</h3>
                        <p>先在大纲里添加章节，再回来写下你的故事。</p>
                        <button
                          className="button button-secondary"
                          onClick={() => setActiveView("outline")}
                        >
                          前往故事大纲
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              )}

              <div className="model-note">
                <span className="model-note-icon" aria-hidden="true">✦</span>
                <div>
                  <strong>{modelStatusText}</strong>
                  <span>
                    {modelConnection === "configured"
                      ? "生成时会将故事设定和大纲发送至你配置的模型服务。"
                      : modelConnection === "unavailable"
                        ? "请确认服务端正在运行，并检查 .env.local 配置。"
                        : "填写 .env.local 中的模型地址、名称和 API Key，然后重启应用。"}
                  </span>
                </div>
                <span className="model-note-tag">
                  {modelConnection === "configured" ? "已连接" : "配置指南见 README"}
                </span>
              </div>
            </div>
          </>
        ) : (
          <>
            <header className="topbar">
              <div className="breadcrumb">
                <span>我的小说</span>
                <span className="breadcrumb-divider">/</span>
                <strong>创作空间</strong>
              </div>
            </header>
            <section className="welcome-state">
              <div className="welcome-art" aria-hidden="true">
                <span className="welcome-sun" />
                <span className="welcome-page welcome-page-back" />
                <span className="welcome-page welcome-page-front">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="welcome-star">✳</span>
              </div>
              <div className="eyebrow">A QUIET PLACE TO WRITE</div>
              <h1>每个故事，都从一个念头开始。</h1>
              <p>
                建立你的小说项目，先整理故事大纲，再一章一章写下去。
                <br />
                你的创作会保存在当前浏览器中。
              </p>
              {storageError && (
                <div className="inline-alert storage-alert welcome-alert" role="alert">
                  <span className="alert-icon" aria-hidden="true">!</span>
                  <span>{storageError}</span>
                </div>
              )}
              <button className="button button-primary welcome-button" onClick={createProject}>
                <span className="plus-mark" aria-hidden="true">+</span>
                开始写一本小说
              </button>
              <div className="welcome-footnote">
                <span className="status-dot" /> 仅保存在你的设备上
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
