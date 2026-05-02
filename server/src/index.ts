import express from "express"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import { promises as fs } from "node:fs"

import {
  ensureStorage,
  exportPathWithExt,
  exportsDir,
  isDatabaseStorageEnabled,
  jobDir,
  materializeSegment,
  readAudioBlob,
  saveAudioBlob,
  segmentPath,
  segmentsDir
} from "./storage.js"
import {
  providerConfigs,
  stylePresets,
  pacePresets,
  type ProviderConfig,
  type ProviderId,
  type StylePresetId,
  type TtsModelPreset,
  type VoicePreset
} from "./presets.js"
import { analyzeExamScript, type ExamTemplate } from "./scriptAnalyzer.js"
import { dashscopeTts } from "./tts/providers/dashscope.js"
import { googleTts } from "./tts/providers/google.js"
import { googleGeminiDialogueTts, googleGeminiTts } from "./tts/providers/googleGemini.js"
import { openAiTts } from "./tts/providers/openai.js"
import { tencentTts } from "./tts/providers/tencent.js"
import { volcengineTts } from "./tts/providers/volcengine.js"
import { xfyunTts } from "./tts/providers/xfyun.js"
import { preparePhonicsRequest } from "./tts/phonics.js"
import { runFfmpeg } from "./ffmpeg.js"
import type { TtsAudio, TtsCredentials, UnifiedTtsRequest } from "./tts/types.js"
import { ProxyAgent, fetch as undiciFetch } from "undici"

type TtsRequestBody = {
  provider?: ProviderId
  credentials?: TtsCredentials
  apiKey?: string
  text: string
  voice?: string
  languageType?: string
  stylePresetId?: StylePresetId | ""
  stylePrompt?: string
  directorNote?: string
  speed?: number
  pitch?: number
  volume?: number
  model?: string
  baseUrl?: string
}

type ComposeBody = {
  segments: Array<
    | { type: "tts"; id: string }
    | { type: "silence"; durationMs: number }
    | { type: "music"; presetId?: "warmup" | "bell" | "soft"; durationMs?: number }
  >
  format?: "mp3" | "wav"
}

type AnalyzeBody = {
  text?: string
  template?: ExamTemplate
}

type GeminiDialogueBody = {
  credentials?: TtsCredentials
  baseUrl?: string
  model?: string
  prompt?: string
  speakers?: Array<{ speaker: string; voiceName: string }>
  speed?: number
}

type CatalogBody = {
  credentials?: TtsCredentials
  baseUrl?: string
}

function providerStatus(provider: ProviderId) {
  return providerConfigs.find((p) => p.id === provider)?.status || "configured-only"
}

function providerConfig(provider: ProviderId) {
  return providerConfigs.find((p) => p.id === provider)
}

function uniqueById<T extends { id: string }>(items: T[]) {
  return Array.from(new Map(items.map((item) => [item.id, item])).values())
}

function inferGoogleGender(name: string): "male" | "female" | "neutral" {
  const upper = name.toUpperCase()
  if (/-[A-Z]$/.test(upper)) {
    const suffix = upper.slice(-1)
    if (["A", "C", "E", "F", "G", "H"].includes(suffix)) return "female"
    if (["B", "D", "I", "J"].includes(suffix)) return "male"
  }
  return "neutral"
}

async function fetchOpenAiCatalog(config: ProviderConfig, body: CatalogBody) {
  const apiKey = body.credentials?.apiKey
  if (!apiKey) throw new Error("OpenAI API Key required")
  const base = (body.baseUrl || config.defaultBaseUrl || "https://api.openai.com").replace(/\/+$/, "")
  const res = await fetch(`${base}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  })
  const json = (await res.json().catch(() => null)) as { data?: Array<{ id?: string }>; error?: { message?: string } } | null
  if (!res.ok) throw new Error(json?.error?.message || `OpenAI models error (${res.status})`)
  const remoteModels: TtsModelPreset[] = (json?.data || [])
    .map((item) => item.id || "")
    .filter((id) => /tts|audio|gpt-4o.*transcribe|gpt-4o.*mini/i.test(id))
    .map((id) => ({
      id,
      label: id,
      description: "OpenAI 远端模型列表返回；请确认该模型支持语音合成后使用",
      supportsInstructions: /gpt-4o/i.test(id),
      speedRange: [0.25, 4] as [number, number]
    }))
  return {
    models: uniqueById([...remoteModels, ...config.models]),
    voices: config.voices,
    source: "remote",
    message: `已从 OpenAI 拉取 ${remoteModels.length} 个候选模型；音色使用官方固定 voice 列表。`
  }
}

async function fetchGoogleCatalog(config: ProviderConfig, body: CatalogBody) {
  const apiKey = body.credentials?.apiKey
  if (!apiKey) throw new Error("Google API Key required")
  const endpoint = (body.baseUrl || config.defaultBaseUrl || "https://texttospeech.googleapis.com/v1/text:synthesize").replace(/\/text:synthesize\/?$/, "/voices")
  const url = endpoint.includes("?") ? `${endpoint}&key=${encodeURIComponent(apiKey)}` : `${endpoint}?key=${encodeURIComponent(apiKey)}`
  const proxyUrl = body.credentials?.proxyUrl || process.env.HTTPS_PROXY || process.env.HTTP_PROXY
  const dispatcher = proxyUrl ? new ProxyAgent(String(proxyUrl)) : undefined
  const res = await undiciFetch(url, dispatcher ? { dispatcher } : undefined)
  const responseText = await res.text().catch(() => "")
  const json = (() => {
    try {
      return JSON.parse(responseText) as { voices?: Array<{ name?: string; languageCodes?: string[]; ssmlGender?: string }>; error?: { message?: string } } | null
    } catch {
      return null
    }
  })()
  if (!res.ok) {
    const message = json?.error?.message || responseText || `Google voices error (${res.status})`
    if (/are blocked/i.test(message)) {
      throw new Error(
        `访问被拒绝: ${message}\n\n请检查 Google API Key 限制：API restrictions 需要允许 Cloud Text-to-Speech API；Application restrictions 建议先设为 None（本机调试）。`
      )
    }
    throw new Error(message)
  }
  const remoteVoices: VoicePreset[] = (json?.voices || [])
    .filter((voice) => voice.name && voice.languageCodes?.some((code) => code.startsWith("en-")))
    .map((voice) => {
      const id = voice.name || ""
      const gender = voice.ssmlGender === "MALE" ? "male" : voice.ssmlGender === "FEMALE" ? "female" : inferGoogleGender(id)
      return {
        id,
        label: `${id}${voice.languageCodes?.[0] ? ` · ${voice.languageCodes[0]}` : ""}`,
        gender,
        locale: voice.languageCodes?.[0] || "en",
        role: gender === "male" ? "dialogue" : "narrator"
      }
    })
  return {
    models: config.models,
    voices: uniqueById([...remoteVoices, ...config.voices]),
    source: "remote",
    message: `已从 Google 拉取 ${remoteVoices.length} 个英文候选音色；Google TTS 模型入口固定为 text:synthesize。`
  }
}

async function fetchProviderCatalog(provider: ProviderId, body: CatalogBody) {
  const config = providerConfig(provider)
  if (!config) throw new Error(`Unknown provider: ${provider}`)
  if (provider === "openai") return fetchOpenAiCatalog(config, body)
  if (provider === "google") return fetchGoogleCatalog(config, body)
  if (provider === "google_gemini") return { models: config.models, voices: config.voices, source: "builtin", message: "Gemini TTS 使用内置模型与音色列表。" }
  return {
    models: config.models,
    voices: config.voices,
    source: "builtin",
    message: `${config.label} 暂未提供稳定的公开模型/音色枚举接口，当前使用内置精选列表。`
  }
}

function legacyPresetsResponse() {
  const openai = providerConfigs.find((p) => p.id === "openai")
  const dashscope = providerConfigs.find((p) => p.id === "dashscope")
  return {
    providers: ["openai", "dashscope"],
    openai: {
      voices: openai?.voices || [],
      defaultModel: openai?.defaultModelId || "gpt-4o-mini-tts",
      defaultBaseUrl: openai?.defaultBaseUrl || "https://api.openai.com"
    },
    dashscope: {
      voices: dashscope?.voices || [],
      defaultModel: dashscope?.defaultModelId || "qwen3-tts-flash",
      defaultBaseUrl: dashscope?.defaultBaseUrl || "https://dashscope.aliyuncs.com/api/v1"
    },
    styles: stylePresets.map((p) => ({ id: p.id, label: p.label }))
  }
}

function stableStyleContract(body: Partial<TtsRequestBody>, presetPrompt?: string) {
  const text = body.text || ""
  const isChinese = hasChineseText(text)
  return [
    "STYLE LOCK: Keep the same voice identity, accent, speaking rate, energy, emotion level, pitch contour, articulation, and microphone distance across all generated segments in this project.",
    "Do not improvise a different character, accent, rhythm, or emotional intensity between requests.",
    "NO TRANSLATION: Do not translate. Speak in the original language of the input text. Keep Chinese in Chinese and English in English.",
    isChinese
      ? "LANGUAGE OVERRIDE: This segment is Chinese. Speak in natural Mandarin Putonghua with correct Chinese pronunciation. Do not pronounce Chinese as English."
      : "LANGUAGE OVERRIDE: This segment is English. Speak in natural English. Do not read English with Chinese pronunciation.",
    "Use a restrained exam-listening delivery: clear consonants, stable volume, controlled pauses, no dramatic acting, no exaggerated emotion.",
    isChinese
      ? "CHINESE DEFAULT: You are a professional native Mandarin broadcaster in CCTV News anchor style recording educational materials for middle school students. Accent: Standard Putonghua, Level 1-A quality, no foreign accent and no regional dialect. Articulation: zi zheng qiang yuan, full clear tones, natural audible neutral tones, clear zh/ch/sh/r without excessive erhua. Speed: measured and steady, approximately 200-220 Chinese characters per minute. Rhythm: logical phrase-group pauses, authoritative yet warm."
      : "ENGLISH DEFAULT: You are a professional voice actor recording English listening test materials for 9th-grade ESL students in China. Tone: professional, warm, authoritative but approachable. Accent: Standard British RP. Speed: measured educational pace, approximately 110-125 words per minute. Prioritize clear enunciation, strict word endings (ed, s, t, d), and distinct punctuation pauses.",
    !isChinese && presetPrompt ? `Preset: ${presetPrompt}` : "",
    body.directorNote ? `Segment role note: ${body.directorNote}` : "",
    body.stylePrompt ? `Project note: ${body.stylePrompt}` : ""
  ]
    .filter(Boolean)
    .join("\n")
}

function hasChineseText(text: string) {
  return /[\u3400-\u9fff]/.test(text)
}

function defaultTargetSpeed(text: string) {
  return hasChineseText(text) ? 210 / 250 : 118 / 150
}

async function synthesize(body: Partial<TtsRequestBody>): Promise<TtsAudio> {
  const provider = body.provider || "openai"
  const credentials = body.credentials || (body.apiKey ? { apiKey: body.apiKey } : {})
  const phonics = preparePhonicsRequest(body.text || "", body.stylePresetId)
  const preset = body.stylePresetId ? stylePresets.find((p) => p.id === body.stylePresetId) : undefined
  const stylePrompt = stableStyleContract(
    {
      ...body,
      text: phonics.text,
      directorNote: [body.directorNote, phonics.instruction].filter(Boolean).join("\n")
    },
    preset?.prompt
  )
  const req: UnifiedTtsRequest = {
    credentials,
    text: phonics.text,
    voice: body.voice,
    languageType: body.languageType,
    stylePrompt,
    speed: body.speed || defaultTargetSpeed(phonics.text),
    pitch: body.pitch,
    volume: body.volume,
    model: body.model,
    baseUrl: body.baseUrl
  }

  if (providerStatus(provider) !== "ready") {
    throw new Error(`${provider} is configured as a future adapter. It is not available in this build.`)
  }

  if (provider === "openai") return openAiTts(req)
  if (provider === "dashscope") return dashscopeTts(req)
  if (provider === "google") return googleTts(req)
  if (provider === "google_gemini") return googleGeminiTts(req)
  if (provider === "volcengine") return volcengineTts(req)
  if (provider === "xfyun") return xfyunTts(req)
  if (provider === "tencent") return tencentTts(req)
  throw new Error(`Unsupported provider: ${provider}`)
}

async function writeAudioToMp3(id: string, audio: TtsAudio) {
  const filePath = segmentPath(id)
  if (audio.format === "mp3") {
    await fs.writeFile(filePath, audio.bytes)
    await saveAudioBlob("segment", id, audio.bytes, "audio/mpeg")
    return
  }

  const dir = jobDir(id)
  await fs.mkdir(dir, { recursive: true })
  const inputWav = path.join(dir, "input.wav")
  await fs.writeFile(inputWav, audio.bytes)
  await runFfmpeg(["-y", "-i", inputWav, "-c:a", "libmp3lame", "-q:a", "2", filePath])
  await saveAudioBlob("segment", id, await fs.readFile(filePath), "audio/mpeg")
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
}

async function makeMusicSegment(dir: string, index: number, presetId: string, durationMs: number) {
  const dst = path.join(dir, `${String(index).padStart(4, "0")}.wav`)
  const durationSec = Math.min(Math.max(durationMs / 1000, 0.5), 30)
  const freq = presetId === "bell" ? "880" : presetId === "soft" ? "392" : "523"
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${freq}:sample_rate=44100`,
    "-t",
    String(durationSec),
    "-af",
    "afade=t=in:st=0:d=0.25,afade=t=out:st=2.8:d=0.5,volume=0.18",
    "-ac",
    "2",
    "-c:a",
    "pcm_s16le",
    dst
  ])
  return dst
}

function statusFromProviderError(message: string) {
  const m = message.match(/\((\d{3})\):/)
  if (!m) return null
  const code = Number(m[1])
  if (code >= 400 && code < 500) return code
  return null
}

async function sendStoredAudio(req: express.Request, res: express.Response, kind: "segment" | "export") {
  const rawFile = req.params.file
  const file = Array.isArray(rawFile) ? rawFile[0] || "" : rawFile || ""
  const match = file.match(/^([0-9a-f-]{36})\.(mp3|wav)$/i)
  if (!match) {
    res.status(404).json({ error: "audio not found" })
    return
  }
  const [, id, ext] = match
  const record = await readAudioBlob(kind, id)
  if (!record) {
    res.status(404).json({ error: "audio not found" })
    return
  }
  res.setHeader("Content-Type", record.contentType || (ext === "wav" ? "audio/wav" : "audio/mpeg"))
  res.setHeader("Cache-Control", "private, max-age=3600")
  res.send(record.bytes)
}

export async function createApp() {
  await ensureStorage()
  const app = express()
  app.disable("x-powered-by")
  app.use(express.json({ limit: "2mb" }))

  if (isDatabaseStorageEnabled()) {
    app.get("/audio/:file", (req, res) => {
      void sendStoredAudio(req, res, "segment")
    })
    app.get("/exports/:file", (req, res) => {
      void sendStoredAudio(req, res, "export")
    })
    app.get("/api/audio/:file", (req, res) => {
      void sendStoredAudio(req, res, "segment")
    })
    app.get("/api/exports/:file", (req, res) => {
      void sendStoredAudio(req, res, "export")
    })
  } else {
    app.use("/audio", express.static(segmentsDir, { immutable: false, maxAge: "0" }))
    app.use("/exports", express.static(exportsDir, { immutable: false, maxAge: "0" }))
  }

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      storage: isDatabaseStorageEnabled() ? "neon" : "local"
    })
  })

  app.get("/api/providers", (_req, res) => {
    res.json({
      providers: providerConfigs,
      styles: stylePresets.map((p) => ({ id: p.id, label: p.label })),
      paces: pacePresets
    })
  })

  app.post("/api/providers/:provider/catalog", async (req, res) => {
    const provider = req.params.provider as ProviderId
    try {
      const catalog = await fetchProviderCatalog(provider, req.body as CatalogBody)
      res.json(catalog)
    } catch (err) {
      const fallback = providerConfig(provider)
      const message = err instanceof Error ? err.message : "刷新远端模型失败"
      if (!fallback) {
        res.status(404).json({ error: message })
        return
      }
      res.status(502).json({
        error: message,
        models: fallback.models,
        voices: fallback.voices,
        source: "builtin"
      })
    }
  })

  app.get("/api/presets", (_req, res) => {
    res.json(legacyPresetsResponse())
  })

  app.post("/api/script/analyze", (req, res) => {
    const body = req.body as AnalyzeBody
    const text = typeof body.text === "string" ? body.text : ""
    if (!text.trim()) {
      res.status(400).json({ error: "text required" })
      return
    }
    res.json({ segments: analyzeExamScript(text, body.template || {}) })
  })

  app.post("/api/gemini/tts/dialogue", async (req, res) => {
    const body = req.body as GeminiDialogueBody
    const prompt = typeof body.prompt === "string" ? body.prompt : ""
    const speakers = Array.isArray(body.speakers) ? body.speakers.filter((item) => item && typeof item.speaker === "string" && typeof item.voiceName === "string") : []
    const credentials = body.credentials || {}
    const speed = typeof body.speed === "number" && Number.isFinite(body.speed) ? body.speed : undefined

    if (!prompt.trim()) {
      res.status(400).json({ error: "prompt required" })
      return
    }
    if (speakers.length < 2) {
      res.status(400).json({ error: "two speakers required" })
      return
    }

    try {
      const id = randomUUID()
      const audio = await googleGeminiDialogueTts({
        credentials,
        baseUrl: body.baseUrl,
        model: body.model,
        prompt,
        speakers,
        speed
      })
      await writeAudioToMp3(id, audio)
      res.json({ id, url: `/audio/${id}.mp3` })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      const status = typeof message === "string" ? statusFromProviderError(message) : null
      res.status(status || 500).json({ error: message })
    }
  })

  app.post("/api/tts", async (req, res) => {
    const body = req.body as Partial<TtsRequestBody>

    if (!body.text || typeof body.text !== "string" || !body.text.trim()) {
      res.status(400).json({ error: "text required" })
      return
    }

    try {
      const id = randomUUID()
      const audio = await synthesize(body)
      await writeAudioToMp3(id, audio)
      res.json({ id, url: `/audio/${id}.mp3` })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      const status = typeof message === "string" ? statusFromProviderError(message) : null
      res.status(status || 500).json({ error: message })
    }
  })

  app.post("/api/compose", async (req, res) => {
    const body = req.body as Partial<ComposeBody>

    if (!body.segments || !Array.isArray(body.segments) || body.segments.length === 0) {
      res.status(400).json({ error: "segments required" })
      return
    }

    const id = randomUUID()
    const dir = jobDir(id)
    const wavPaths: string[] = []

    try {
      await fs.mkdir(dir, { recursive: true })

      let i = 0
      for (const seg of body.segments) {
        if (!seg || typeof seg !== "object") continue

        if (seg.type === "tts") {
          if (typeof seg.id !== "string" || !seg.id) continue
          const src = await materializeSegment(seg.id, dir)
          const dst = path.join(dir, `${String(i).padStart(4, "0")}.wav`)
          await runFfmpeg(["-y", "-i", src, "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", dst])
          wavPaths.push(dst)
          i++
          continue
        }

        if (seg.type === "music") {
          const dst = await makeMusicSegment(dir, i, seg.presetId || "warmup", seg.durationMs || 3500)
          wavPaths.push(dst)
          i++
          continue
        }

        if (seg.type === "silence") {
          const durationMs = seg.durationMs
          if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) continue
          const durationSec = Math.min(durationMs / 1000, 60 * 10)
          const dst = path.join(dir, `${String(i).padStart(4, "0")}.wav`)
          await runFfmpeg([
            "-y",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-t",
            String(durationSec),
            "-c:a",
            "pcm_s16le",
            dst
          ])
          wavPaths.push(dst)
          i++
        }
      }

      if (wavPaths.length === 0) {
        res.status(400).json({ error: "No valid segments" })
        return
      }

      const listFile = path.join(dir, "concat.txt")
      const listContent = wavPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n")
      await fs.writeFile(listFile, listContent, "utf8")

      const joinedWav = path.join(dir, "joined.wav")
      await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", joinedWav])

      const format = body.format === "wav" ? "wav" : "mp3"
      const finalFile = exportPathWithExt(id, format)
      if (format === "wav") {
        await runFfmpeg(["-y", "-i", joinedWav, "-c:a", "pcm_s16le", finalFile])
      } else {
        await runFfmpeg(["-y", "-i", joinedWav, "-c:a", "libmp3lame", "-q:a", "2", finalFile])
      }
      await saveAudioBlob("export", id, await fs.readFile(finalFile), format === "wav" ? "audio/wav" : "audio/mpeg")

      res.json({ id, url: `/exports/${id}.${format}` })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      res.status(500).json({ error: message })
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })

  return app
}

async function main() {
  const app = await createApp()
  const port = Number(process.env.PORT || 8090)
  app.listen(port, () => {
    process.stdout.write(`server listening on http://localhost:${port}\n`)
  })
}

const entrypoint = process.argv[1] ? fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) : false
if (entrypoint) {
  main().catch((err) => {
    process.stderr.write((err instanceof Error ? err.stack : String(err)) + "\n")
    process.exit(1)
  })
}
