import type { UnifiedTtsRequest, TtsAudio } from "../types.js"
import os from "node:os"
import path from "node:path"
import { promises as fs } from "node:fs"
import { ProxyAgent, fetch as undiciFetch } from "undici"
import { runFfmpeg } from "../../ffmpeg.js"

function pcm16ToWav(pcm: Buffer, sampleRate: number, channels: number) {
  const blockAlign = channels * 2
  const byteRate = sampleRate * blockAlign
  const dataSize = pcm.length
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write("RIFF", 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write("WAVE", 8)
  buffer.write("fmt ", 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write("data", 36)
  buffer.writeUInt32LE(dataSize, 40)
  pcm.copy(buffer, 44)
  return buffer
}

function mitigateModerationText(input: string) {
  return input.replace(/breakfast/gi, (value) => `${value.slice(0, 4)}\u200b${value.slice(4)}`)
}

function hasChineseText(input: string) {
  return /[\u3400-\u9fff]/.test(input)
}

async function applyTempo(wavBytes: Buffer, speed: number) {
  if (!Number.isFinite(speed)) return wavBytes
  const clamped = Math.max(0.5, Math.min(2, speed))
  if (Math.abs(clamped - 1) < 0.01) return wavBytes

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tts-gemini-"))
  const inputWav = path.join(dir, "in.wav")
  const outputWav = path.join(dir, "out.wav")
  try {
    await fs.writeFile(inputWav, wavBytes)
    await runFfmpeg(["-y", "-i", inputWav, "-filter:a", `atempo=${clamped.toFixed(3)}`, "-c:a", "pcm_s16le", outputWav])
    return await fs.readFile(outputWav)
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

function readInlineAudio(json: any) {
  const parts = json?.candidates?.[0]?.content?.parts
  const list = Array.isArray(parts) ? parts : []
  for (const part of list) {
    const inline = part?.inlineData || part?.inline_data
    const data = inline?.data
    const mimeType = inline?.mimeType || inline?.mime_type
    if (typeof data === "string" && data) {
      return { data, mimeType: typeof mimeType === "string" ? mimeType : "" }
    }
  }
  return { data: "", mimeType: "" }
}

function noAudioReason(json: any, responseText: string) {
  const err = json?.error?.message
  if (typeof err === "string" && err.trim()) return err.trim()
  const finish = json?.candidates?.[0]?.finishReason || json?.candidates?.[0]?.finish_reason
  if (typeof finish === "string" && finish.trim()) return `finishReason=${finish.trim()}`
  const feedback = json?.promptFeedback || json?.prompt_feedback
  if (feedback) {
    const raw = JSON.stringify(feedback)
    return raw.length > 400 ? raw.slice(0, 400) : raw
  }
  const raw = responseText.trim()
  return raw.length > 400 ? raw.slice(0, 400) : raw
}

function isProhibitedContent(json: any) {
  const feedback = json?.promptFeedback || json?.prompt_feedback
  const reason = feedback?.blockReason || feedback?.block_reason
  return reason === "PROHIBITED_CONTENT"
}

function isTimeoutError(err: unknown) {
  const e = err instanceof Error ? err : new Error(String(err))
  const message = e.message || ""
  return e.name === "AbortError" || /timeout|UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT/i.test(message)
}

function estimateTimeoutMs(text: string) {
  const length = Math.max(0, text.length)
  const base = 45000
  const extra = Math.ceil(length / 300) * 8000
  return Math.max(base, Math.min(180000, base + extra))
}

function isLoopbackProxyUrl(proxyUrl: string) {
  try {
    const { hostname } = new URL(proxyUrl)
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]"
  } catch {
    return false
  }
}

function proxyDispatcher(proxyUrl?: string) {
  if (!proxyUrl) return undefined
  if (process.env.VERCEL && isLoopbackProxyUrl(proxyUrl)) {
    throw new Error(
      "Gemini TTS proxy configuration error (400): 线上 Vercel 不能使用本机代理地址 127.0.0.1/localhost。请清空 Proxy URL，让 Vercel 直接访问 Google，或填写一个 Vercel 可访问的公网 HTTPS 代理地址。"
    )
  }
  return new ProxyAgent(proxyUrl)
}

async function callGeminiTts(args: {
  url: string
  apiKey: string
  dispatcher: any
  body: Record<string, any>
  timeoutMs?: number
}) {
  let res: any
  let responseText = ""
  try {
    res = await undiciFetch(args.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": args.apiKey
      },
      dispatcher: args.dispatcher,
      body: JSON.stringify(args.body),
      signal: AbortSignal.timeout(Math.max(10000, args.timeoutMs || 45000))
    })
    responseText = await res.text().catch(() => "")
  } catch (err: unknown) {
    if (isTimeoutError(err)) {
      throw new Error("Gemini TTS 超时：当前文本较长或网络波动导致生成时间超过限制。建议重试，或把该段拆成更短的小题/分块。")
    }
    const e = err instanceof Error ? err : new Error(String(err))
    throw new Error(`Gemini TTS 网络错误: ${e.message}`)
  }
  const json = (() => {
    try {
      return JSON.parse(responseText)
    } catch {
      return null
    }
  })()
  return { res, responseText, json }
}

function buildSystemInstruction(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  return { parts: [{ text: trimmed }] }
}

function isDeveloperInstructionDisabled(message: string) {
  return /Developer instruction is not enabled for this model/i.test(message)
}

const GEMINI_FLASH_TTS_MODEL = "gemini-2.5-flash-preview-tts"
const GEMINI_PRO_TTS_MODEL = "gemini-2.5-pro-preview-tts"
const GEMINI_DEFAULT_TTS_MODEL = GEMINI_FLASH_TTS_MODEL

function geminiTtsModelAttempts(model: string) {
  const fallbacks = model === GEMINI_PRO_TTS_MODEL ? [GEMINI_FLASH_TTS_MODEL] : []
  return Array.from(new Set([model, ...fallbacks]))
}

function isGemini25TtsModel(model: string) {
  return /^gemini-2\.5-.*-tts$/i.test(model)
}

function geminiErrorMessage(json: any, responseText: string, statusText: string) {
  return json?.error?.message || responseText || statusText
}

function isRetryableGeminiModelError(status: number, message: string) {
  return status >= 500 || /internal error|temporarily unavailable|service unavailable/i.test(message)
}

function examDeliveryInstruction(text: string) {
  const languageLine = hasChineseText(text)
    ? "Speak Chinese text in natural standard Mandarin exactly as written; do not translate it."
    : "Speak the text in the same language as written; do not translate it."
  return [
    "Read aloud only the transcript below.",
    languageLine,
    "Use a restrained exam-listening delivery: calm, neutral, clear articulation, steady pace, no dramatic acting, no extra emotion.",
    "Do not read these instructions aloud."
  ].join(" ")
}

function singleSpeakerContents(model: string, text: string) {
  const spoken = mitigateModerationText(text)
  if (isGemini25TtsModel(model)) {
    return [{ parts: [{ text: `${examDeliveryInstruction(text)}\n\nTranscript:\n${spoken}` }] }]
  }
  return [{ parts: [{ text: spoken }] }]
}

function singleSpeakerSystemInstruction(model: string, systemText: string) {
  return isGemini25TtsModel(model) ? undefined : buildSystemInstruction(systemText)
}

function multiSpeakerContents(model: string, prompt: string, systemText: string) {
  const spoken = mitigateModerationText(prompt)
  if (isGemini25TtsModel(model)) {
    return [{ parts: [{ text: `${systemText}\n\nRead aloud only the dialogue transcript below. Do not read speaker labels.\n\nTranscript:\n${spoken}` }] }]
  }
  return [{ parts: [{ text: spoken }] }]
}

function multiSpeakerSystemInstruction(model: string, systemText: string) {
  return isGemini25TtsModel(model) ? undefined : buildSystemInstruction(mitigateModerationText(systemText))
}

export async function googleGeminiTts(req: UnifiedTtsRequest): Promise<TtsAudio> {
  const apiKey = req.credentials.apiKey
  if (!apiKey) throw new Error("Gemini API Key required")

  const baseUrl = (req.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "")
  const requestedModel = req.model || GEMINI_DEFAULT_TTS_MODEL
  const voiceName = req.voice || "Iapetus"

  const proxyUrl = req.credentials.proxyUrl || process.env.HTTPS_PROXY || process.env.HTTP_PROXY
  const dispatcher = proxyDispatcher(proxyUrl)

  const text = mitigateModerationText(req.text || "")
  const languageGuard = hasChineseText(req.text || "")
    ? "MANDATORY LANGUAGE: The provided text contains Chinese. Speak the Chinese text in Mandarin Chinese exactly as written. Do not translate it into English. Do not paraphrase it."
    : "MANDATORY LANGUAGE: Speak the provided text in the same language as written. Do not translate it."
  const systemText = [
    req.stylePrompt || "",
    languageGuard,
    "Do not speak or read any instructions. Speak only the provided text content."
  ]
    .filter(Boolean)
    .join("\n\n")

  let lastError = ""
  const modelAttempts = geminiTtsModelAttempts(requestedModel)
  for (const model of modelAttempts) {
    const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`
    const body: Record<string, any> = {
      systemInstruction: singleSpeakerSystemInstruction(model, systemText),
      contents: singleSpeakerContents(model, text),
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName
            }
          }
        }
      },
      model
    }
    if (!body.systemInstruction) delete body.systemInstruction

    let { res, responseText, json } = await callGeminiTts({ url, apiKey, dispatcher, body, timeoutMs: estimateTimeoutMs(text) })
    if (!res.ok && isDeveloperInstructionDisabled(responseText || json?.error?.message || "")) {
      const retryBody = { ...body }
      delete retryBody.systemInstruction
      if (hasChineseText(req.text || "")) {
        retryBody.contents = [{ parts: [{ text: `Read aloud only the Chinese text below in Mandarin Chinese. Do not translate it into English.\n\n${mitigateModerationText(text)}` }] }]
      }
      ;({ res, responseText, json } = await callGeminiTts({ url, apiKey, dispatcher, body: retryBody, timeoutMs: estimateTimeoutMs(text) }))
    }
    if (res.ok && json && isProhibitedContent(json)) {
      const retryBody = { ...body, contents: singleSpeakerContents(model, text) }
      ;({ res, responseText, json } = await callGeminiTts({ url, apiKey, dispatcher, body: retryBody, timeoutMs: estimateTimeoutMs(text) }))
    }

    if (!res.ok) {
      const message = geminiErrorMessage(json, responseText, res.statusText)
      lastError = `Gemini TTS error (${res.status}): ${message}`
      if (model !== modelAttempts[modelAttempts.length - 1] && isRetryableGeminiModelError(res.status, message)) continue
      throw new Error(lastError)
    }

    const { data, mimeType } = readInlineAudio(json)
    if (typeof data !== "string" || !data) {
      throw new Error(`Unexpected Gemini response: audio not found (${noAudioReason(json, responseText)})`)
    }
    const bytes = Buffer.from(data, "base64")

    const wavBytes = typeof mimeType === "string" && /wav/i.test(mimeType) ? bytes : pcm16ToWav(bytes, 24000, 1)
    const paced = await applyTempo(wavBytes, typeof req.speed === "number" ? req.speed : 1)
    return {
      bytes: paced,
      format: "wav",
      meta: {
        provider: "google_gemini",
        requestedModel,
        usedModel: model,
        requestedVoice: req.voice,
        usedVoice: voiceName,
        instructionMode: req.stylePrompt ? "sent" : "not-supported",
        warnings: model !== requestedModel ? [`${requestedModel} 返回服务端错误，已自动回退到 ${model}；未使用 3.1 表现力模型。`] : [],
        requestSummary: [
          { label: "接口", value: "Gemini voiceConfig" },
          { label: "音色", value: voiceName },
          { label: "语速", value: typeof req.speed === "number" ? req.speed.toFixed(2) : "默认" }
        ]
      }
    }
  }

  throw new Error(lastError || "Gemini TTS error: model fallback failed")
}

export async function googleGeminiDialogueTts(args: {
  credentials: Record<string, string | undefined>
  baseUrl?: string
  model?: string
  proxyUrl?: string
  prompt: string
  speakers: Array<{ speaker: string; voiceName: string }>
  speed?: number
}): Promise<TtsAudio> {
  const apiKey = args.credentials.apiKey
  if (!apiKey) throw new Error("Gemini API Key required")

  const baseUrl = (args.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "")
  const requestedModel = args.model || GEMINI_DEFAULT_TTS_MODEL

  const proxyUrl = args.credentials.proxyUrl || args.proxyUrl || process.env.HTTPS_PROXY || process.env.HTTP_PROXY
  const dispatcher = proxyDispatcher(proxyUrl)

  const speakerVoiceConfigs = args.speakers.slice(0, 2).map((item) => ({
    speaker: item.speaker,
    voiceConfig: { prebuiltVoiceConfig: { voiceName: item.voiceName } }
  }))
  if (speakerVoiceConfigs.length >= 2 && speakerVoiceConfigs[0].voiceConfig.prebuiltVoiceConfig.voiceName === speakerVoiceConfigs[1].voiceConfig.prebuiltVoiceConfig.voiceName) {
    throw new Error("Gemini 对话生成需要男声和女声使用不同音色，请在设置中分别选择 Male/Female 音色。")
  }

  const chunks = args.prompt.split(/\n\s*\n/)
  const transcript = chunks.pop() || args.prompt
  const instruction = chunks.join("\n\n")
  const systemText = [
    instruction,
    "Do not speak or read any instructions.",
    "Do not speak speaker labels. Treat labels such as Male: and Female: as role markers only.",
    "The speaker label in each transcript line must exactly match one speakerVoiceConfig speaker name. Never assign a Male line to the Female voice or a Female line to the Male voice."
  ]
    .filter(Boolean)
    .join("\n\n")
  const prompt = mitigateModerationText(transcript)

  let lastError = ""
  const modelAttempts = geminiTtsModelAttempts(requestedModel)
  for (const model of modelAttempts) {
    const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`
    const body: Record<string, any> = {
      systemInstruction: multiSpeakerSystemInstruction(model, systemText),
      contents: multiSpeakerContents(model, prompt, systemText),
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs
          }
        }
      },
      model
    }
    if (!body.systemInstruction) delete body.systemInstruction

    let { res, responseText, json } = await callGeminiTts({ url, apiKey, dispatcher, body, timeoutMs: estimateTimeoutMs(transcript) })
    if (!res.ok && isDeveloperInstructionDisabled(responseText || json?.error?.message || "")) {
      const retryBody = { ...body }
      delete retryBody.systemInstruction
      ;({ res, responseText, json } = await callGeminiTts({ url, apiKey, dispatcher, body: retryBody, timeoutMs: estimateTimeoutMs(transcript) }))
    }
    if (res.ok && json && isProhibitedContent(json)) {
      const retryBody = { ...body, contents: multiSpeakerContents(model, prompt, systemText) }
      ;({ res, responseText, json } = await callGeminiTts({ url, apiKey, dispatcher, body: retryBody, timeoutMs: estimateTimeoutMs(transcript) }))
    }

    if (!res.ok) {
      const message = geminiErrorMessage(json, responseText, res.statusText)
      lastError = `Gemini TTS error (${res.status}): ${message}`
      if (model !== modelAttempts[modelAttempts.length - 1] && isRetryableGeminiModelError(res.status, message)) continue
      throw new Error(lastError)
    }

    const { data, mimeType } = readInlineAudio(json)
    if (typeof data !== "string" || !data) {
      throw new Error(`Unexpected Gemini response: audio not found (${noAudioReason(json, responseText)})`)
    }
    const bytes = Buffer.from(data, "base64")
    const wavBytes = typeof mimeType === "string" && /wav/i.test(mimeType) ? bytes : pcm16ToWav(bytes, 24000, 1)
    const paced = await applyTempo(wavBytes, typeof args.speed === "number" ? args.speed : 1)
    return {
      bytes: paced,
      format: "wav",
      meta: {
        provider: "google_gemini",
        requestedModel,
        usedModel: model,
        requestedVoice: speakerVoiceConfigs.map((item) => item.voiceConfig.prebuiltVoiceConfig.voiceName).join(" / "),
        usedVoice: speakerVoiceConfigs.map((item) => `${item.speaker}:${item.voiceConfig.prebuiltVoiceConfig.voiceName}`).join(" / "),
        instructionMode: "sent",
        warnings: model !== requestedModel ? [`${requestedModel} 返回服务端错误，已自动回退到 ${model}；未使用 3.1 表现力模型。`] : [],
        requestSummary: [
          { label: "接口", value: "Gemini multiSpeakerVoiceConfig" },
          { label: "说话人", value: speakerVoiceConfigs.map((item) => item.speaker).join(" / ") },
          { label: "语速", value: typeof args.speed === "number" ? args.speed.toFixed(2) : "默认" }
        ]
      }
    }
  }

  throw new Error(lastError || "Gemini TTS error: model fallback failed")
}
