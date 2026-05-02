# Gemini TTS 接入与导出格式选择（设计稿）

日期：2026-05-01

## 背景

当前系统已支持多家传统 TTS（DashScope / Cloud Text-to-Speech / OpenAI 等），但“Google Cloud TTS”的 voice 列表并非 Gemini。需求是新增 **Google AI Studio / Gemini API 的 TTS** 能力，使用 `generateContent` 并设置 `responseModalities: ["AUDIO"]` 生成语音，同时继续支持现有分段生成、预览与合成导出流程，并扩展导出为 MP3/WAV 可选。

参考文档（Gemini API TTS）：https://ai.google.dev/gemini-api/docs/speech-generation

## 目标

- 新增 Provider：Google Gemini TTS（AI Studio / Gemini API），支持：
  - 单人逐段生成：每个片段独立生成音频（最贴合现有段落系统）
  - 多人对话一次生成整段：把多说话人对话一次生成一个音频段，插入到段落列表
- 支持代理：复用当前 `proxyUrl`（HTTP 代理）以适配本地网络环境
- 导出格式可选：合成导出支持 MP3/WAV 两种格式，用户可在 UI 选择
- 错误信息清晰可读：网络、鉴权、限制、响应格式错误需在 UI 直观呈现

## 非目标

- 不实现服务端的 Gemini 语音“流式实时播放”（Live API）
- 不实现长文本自动分段策略的全新重构（沿用现有拆分与队列）
- 不实现账户管理/多用户（仍为本地单用户工具）

## 总体方案

系统新增 `google_gemini` Provider（与现有 `google` 区分）：

- `google`：Cloud Text-to-Speech（voices 列表、`texttospeech.googleapis.com`）
- `google_gemini`：Gemini API TTS（`generativelanguage.googleapis.com`，`generateContent` + AUDIO）

音频存储策略：

- 段落生成：服务端接收 Gemini 返回的 `inlineData.data`（base64），封装为 WAV/PCM，然后复用现有的写入与转码能力将音频存入 segment 目录；段落播放和默认合成仍使用 MP3（浏览器兼容与体积更优）
- 导出合成：新增导出格式选择（MP3/WAV），在合成端最后一步由 ffmpeg 输出目标格式

## Provider 设计

### Provider 配置（/api/providers）

新增 provider 配置项：

- id: `google_gemini`
- label: `Google Gemini TTS (AI Studio)`
- status: `ready`
- credentialFields:
  - `apiKey`（必填，Gemini API Key）
  - `proxyUrl`（可选，HTTP 代理，例 `http://127.0.0.1:1940`）
- defaultBaseUrl:
  - `https://generativelanguage.googleapis.com/v1beta`
- models（预置）：
  - `gemini-3.1-flash-tts-preview`（默认）
  - 允许后续扩展更多 TTS preview 模型（以文档为准）
- voices（预置，Gemini TTS voices）：
  - `Kore`, `Puck` 等（按文档 voiceName 列表配置）

### 单人逐段生成接口

复用现有 `/api/tts`：

- provider=`google_gemini`
- model：`gemini-3.1-flash-tts-preview`
- voice：映射为 `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`
- text：传入 `contents[].parts[].text`
- stylePrompt/directorNote：可拼入文本 prompt 前缀，用于控制说话风格（Gemini TTS 支持可控式 prompt）

服务端请求：

- POST `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- Header: `x-goog-api-key: <apiKey>`
- Body:
  - `contents`: `[{ parts: [{ text: ... }] }]`
  - `generationConfig.responseModalities`: `["AUDIO"]`
  - `generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`

响应处理：

- 从 `candidates[0].content.parts[0].inlineData.data` 取 base64
- mimeType 可能为 `audio/wav` 或 `audio/pcm`（以返回为准）
- 若是 PCM：服务端补 WAV header（sampleRate 24000, 16-bit, mono，按文档/返回 meta 设定，若文档说明不同则以文档为准）
- 输出作为 `TtsAudio` 交给现有 `writeAudioToMp3` 逻辑（最终存 MP3，保持播放器兼容）

### 多人对话一次生成整段

新增接口（建议）：

- POST `/api/gemini/tts/dialogue`
- Body:
  - credentials/baseUrl/proxyUrl/model
  - transcript（按照文档 multi-speaker 结构组织）
  - 选择的多说话人 voiceName 映射（speakerVoiceConfigs）

返回：

- `{ id, url, format }`（与 /api/tts 类似）

前端行为：

- 新增按钮“Gemini 多人对话生成”
- 将当前选中的若干段（或全部对话段）组合为 transcript 请求
- 返回后在 segments 列表插入一个新段落：
  - type=`tts`
  - text/label 标注为“Gemini 对话合成”
  - audioId/audioUrl 直接挂载

## 导出格式选择（MP3/WAV）

### 后端

扩展 `/api/compose` body：

- 新增字段：`format?: "mp3" | "wav"`，默认 mp3

实现：

- 复用当前合成 wav 拼接流程
- 最后一步 ffmpeg 输出：
  - mp3：现有参数 `libmp3lame -q:a 2`
  - wav：输出 `pcm_s16le` wav

返回：

- `{ id, url }`，url 扩展名与 format 对应

### 前端

- “合成”区域增加导出格式选择（MP3/WAV）
- 点击“合成”时将 `format` 传给 `/api/compose`

## 刷新模型/音色（catalog）

当前 `刷新模型/角色` 使用 `/api/providers/:provider/catalog`：

- 对于 `google_gemini`：优先使用内置模型与 voiceName（Gemini API 暂不提供稳定的“列出 voiceName”接口时）
- 对于 `google`：继续拉取 `/voices`，并支持 `proxyUrl` 代理

## 错误处理与用户提示

- 网络错误（超时/DNS/代理错误）：返回明确提示，并建议检查 Proxy URL
- 403 blocked：提示检查 API Key 的 API restrictions / 应用限制 / 项目启用状态
- 非 JSON 响应：明确提示“代理响应异常/HTML 错误页/Proxy error”

## 测试与验证

- 构建通过：`npm -w server run build`、`npm -w web run build`
- 本地代理环境下：
  - Gemini 单段生成成功，能预览音频
  - 多人对话一次生成成功，能插入段落并预览
  - 合成导出 MP3/WAV 均成功下载
- 错误场景：
  - apiKey 无效返回可读错误
  - proxyUrl 不可用返回可读错误

## 迁移与兼容

- 保持旧 provider 不变
- 新增 provider 不影响旧数据
- 旧的 segments 若保存了未知 modelId，将在生成时自动回退到当前 provider 可用的模型

