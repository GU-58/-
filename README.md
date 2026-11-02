# 纸间 · 小说创作工作台

一个 AI 辅助的中文小说创作网页：先由模型构思完整大纲，再逐章生成正文，方便边生成边修改；项目保存在当前浏览器中。

## 开始使用

需要安装 Node.js 22.12 或更高版本。项目已预设 DeepSeek 的兼容接口地址和模型名。先把 `.env.example` 复制为 `.env.local`，再填入你自己的 API Key：

```env
AI_BASE_URL=https://api.deepseek.com
AI_API_KEY=你的 DeepSeek API Key
AI_MODEL=deepseek-flash
```

Windows PowerShell 复制配置：

```powershell
Copy-Item .env.example .env.local
```

从 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys)创建 API Key 并填入 `.env.local`。密钥只保存在本机，不要发到聊天、网页，也不要提交到 Git。

```sh
npm install
npm run dev
```

打开终端中显示的本地地址，在“故事大纲”填写小说设定，点击 **AI 生成故事大纲**；检查并修改大纲后，到“逐章写作”选择章节，点击 **AI 生成本章**。生成会沿用大纲、故事设定和上一章正文；重新生成已有章节前会提示确认。

更改 `.env.local` 配置后重启 `npm run dev`。网页顶部会显示 AI 服务连接状态。若没有填入模型凭据，应用会明确提示需要配置，不会伪装成真实 AI 生成。

## 运行检查

```sh
npm test
npm run test:server
npm run build
```

## 当前能力

- 创建多个小说项目，编辑标题、题材、故事灵感和章节规划。
- 通过本地服务端代理调用 OpenAI 兼容 Chat Completions API，生成故事大纲和逐章正文。
- 手动维护梗概和章节大纲，逐章编辑正文。
- 自动将项目和正文保存在浏览器 `localStorage` 中。
- API Key 只由服务端读取，不会发送给浏览器。

## 接入模型

服务端支持兼容 OpenAI Chat Completions 协议的模型提供商，当前默认预设 DeepSeek。若改用其他服务，请修改 `.env.local` 中的基础 URL、API Key 和模型名称。`server/app.mjs` 中的提示词可以按写作风格调整；不要在前端代码中保存或传输服务端 API Key。
