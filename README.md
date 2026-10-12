# TTS Studio

教师听力音频工作台：准备文稿 → 录音生成 → 试听导出。填写考试名称后自动生成可审阅的开场播报，拆分与生成分开操作。选中任意片段可在其后添加朗读、停顿或音乐。React / Vite 前端，Express / FFmpeg 音频处理，Cloudflare Workers + Containers + R2 部署。

制作设置中的“智能识别”默认使用 DeepSeek V4.1 Flash（`deepseek-flash`），支持刷新官方模型列表；服务器保管密钥，浏览器只保存所选模型。百炼连接页提供北京工作空间 ID 入口；Qwen3 模型返回 400/404 且确认不存在时才尝试兼容模型，并报告实际使用的模型。

线上入口保持 [tts.newsunenglish.com](https://tts.newsunenglish.com/)。

## Cloudflare 部署

需要 Workers Paid、启用 R2、Docker 与 Node.js 22。`wrangler.jsonc` 配置账户、R2 桶和容器，`cloudflare/worker.ts` 中的存储回调地址须对应自己的 workers.dev 地址。

```sh
npx wrangler login
npx wrangler r2 bucket create tts-studio-audio --location apac
npx wrangler secret put AUDIO_STORAGE_TOKEN
# 按需设置服务器密钥；也可在网页填写本次会话密钥
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put DASHSCOPE_API_KEY
npm run deploy:cloudflare
```

`AUDIO_STORAGE_TOKEN` 使用随机的 32 字节以上密钥。Worker 将该密钥与私有回调地址注入容器，容器通过鉴权接口向 R2 写入音频并校验 SHA-256。大于 64 MiB 的长音频按 32 MiB 分块上传，避免长 WAV 超过请求体上限。`/audio/:id.mp3` 与 `/exports/:id.mp3|wav` 直接由 R2 供给，支持 HEAD、Range 和缓存校验，保持旧链接格式。服务目录由 Worker 直接响应，打开网页无需等待音频容器启动。存储桶不开放写入和列表权限。镜像仅含服务器代码与依赖。

首次部署先验证 workers.dev 地址，再在 Wrangler 的 `routes` 中配置原域名的全路径路由。当前 `tts.newsunenglish.com/*` 使用 Cloudflare 已代理的 A 记录 `192.0.2.1` 作为无源站占位，所有路径由 Worker、静态资源绑定、Containers 和 R2 响应，不向该地址或 Vercel 转发。不要删除 Worker 路由，否则占位地址无法提供网站。域名切换与旧数据清理记录在 `docs/cloudflare-migration.md`。

## 国内声音服务

默认使用阿里云百炼。网页“声音服务”提供注册、获取密钥、官方价格及真实短句试听；密钥只存当前浏览器会话。Qwen-Audio 3.1 还需填写百炼工作空间 ID，并使用对应的 3.1 音色。Qwen3 与旧 Qwen 音色分别过滤，避免跨模型误用。

| 服务 | 已接入模型 | 使用提示 |
| --- | --- | --- |
| [阿里云百炼](https://help.aliyun.com/zh/model-studio/tts-model) | Qwen3 / Qwen-Audio 3.1 | 新模型、地域和音色有不同开通要求；以控制台额度为准 |
| [MiniMax](https://platform.minimax.cn/docs/api-reference/speech-t2a-http) | Speech 2.8 Turbo / HD | Turbo 试听、HD 成品；按字符计费 |
| [硅基流动](https://docs.siliconflow.cn/docs/api/audio-speech-post) | CosyVoice2 / MOSS-TTSD | 托管 API 按量计费，试用额度不等于永久免费 |
| [豆包语音](https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http?lang=zh) | Seed TTS 2.0 | 新版 API Key 与对应音色；保留旧火山引擎接入 |
| 讯飞 / 腾讯云 | 现有兼容服务 | 按各平台开通与计费规则使用 |

免费方式包括浏览器系统语音试听（无法导出制作成品）和自行部署公开模型（需自行承担算力）。[本地语音模型子页面](https://tts.newsunenglish.com/local-tts) 汇总 8 个方案，支持按 Apple Silicon / NVIDIA 筛选，并提供部署、权重、硬件和许可说明；MLX Audio 与 Qwen3-TTS 有可复制的启动示例。本页是部署指南，尚未连接用户本地服务。目录核对日期：2026-10-12，实时价格和许可请查看官方链接。

全篇试听使用 Web Audio 音频时钟调度，提前下载、解码后续 3 个音频，最多提前调度 20 秒；已解码缓存最多保留 8 个片段。语音采用实际解码时长，设定停顿按时钟保留。停止、跳转和编辑音频序列会取消旧播放，失败会明确提示，不会跳过片段。网络不足时显示缓冲状态；文件本身的静音不会被自动裁剪。

## Local development

```sh
npm install
npm run dev
```

The frontend runs through Vite and proxies `/api`, `/audio`, and `/exports` to the local Express server.

## Production build

```sh
npm run build
```

The root build checks the server TypeScript project first, then builds the frontend into `web/dist`.

## 旧 Vercel / Neon 兼容部署

This repository is ready for GitHub -> Vercel deployment:

- GitHub remote: `https://github.com/NewsunLee007/tts-studio.git`
- Vercel build command: `npm run build`
- Vercel output directory: `web/dist`
- Serverless API entry: `api/index.ts`
- Node runtime: `22.x`

Required Vercel environment variable:

```txt
DATABASE_URL=postgresql://...
```

Set `DATABASE_URL` to the Neon pooled connection string. When it is present, generated audio is stored in Neon in the `audio_blobs` table. Without it, local development uses the workspace `data/` directory.

Provider keys can be configured as Worker secrets or Vercel environment variables. The browser receives only a `serverConfigured` status flag, never the secret value.

```txt
DASHSCOPE_API_KEY=
DASHSCOPE_WORKSPACE_ID=
MINIMAX_API_KEY=
SILICONFLOW_API_KEY=
DOUBAO_API_KEY=
DEEPSEEK_API_KEY=
GOOGLE_TTS_API_KEY=
GEMINI_API_KEY=
VOLCENGINE_APP_ID=
VOLCENGINE_ACCESS_TOKEN=
VOLCENGINE_CLUSTER=
XFYUN_APP_ID=
XFYUN_API_KEY=
XFYUN_API_SECRET=
TENCENT_SECRET_ID=
TENCENT_SECRET_KEY=
TENCENT_REGION=
OPENAI_API_KEY=
```

If a server key is unavailable, a teacher can enter a temporary key in the app. Temporary keys use browser session storage and are cleared when the tab is closed. On first load, the app also migrates and removes provider secrets left in local storage by older versions.

## Verification

```sh
npm test
npm run lint
npm run build
```

Tests cover source-faithful script parsing, credential resolution, domestic-provider request/stream contracts, and R2 persistence/range behavior. Provider tests mock remote APIs; a passing test does not establish a paid account or live voice quality.

## Data flow

运行时音频存于 R2，不提交 GitHub。本地未配置持久存储时使用 `data/`；旧部署仅在设置 `DATABASE_URL` 且没有 R2 回调时继续使用 Neon。Cloudflare 容器启用 `REQUIRE_DURABLE_STORAGE=true`，防止误用容器临时磁盘保存成品。文稿与编辑状态保留在浏览器本地，未宣称跨设备同步。
