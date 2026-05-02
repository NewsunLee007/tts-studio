import { stylePresets, type StylePresetId } from "../presets.js"
import type { TtsAudio } from "./types.js"

export type DashscopeTtsRequest = {
  apiKey: string
  text: string
  model: string
  voice?: string
  languageType?: string
  stylePresetId?: StylePresetId | ""
  stylePrompt?: string
  optimizeInstructions?: boolean
  baseUrl?: string
}

function asErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message
  return String(err)
}

export async function dashscopeTts(req: DashscopeTtsRequest): Promise<TtsAudio> {
  const rawBase = (req.baseUrl || "https://dashscope.aliyuncs.com/api/v1").replace(/\/+$/, "")
  const base = rawBase.endsWith("/api/v1") ? rawBase : `${rawBase}/api/v1`

  const preset = req.stylePresetId
    ? stylePresets.find((p) => p.id === req.stylePresetId)
    : undefined
  const instructions = [preset?.prompt, req.stylePrompt].filter(Boolean).join("\n")

  const url = `${base}/services/aigc/multimodal-generation/generation`

  const input: Record<string, unknown> = {
    text: req.text,
    voice: req.voice
  }
  if (req.languageType) input.language_type = req.languageType
  if (instructions) input.instructions = instructions
  if (instructions && typeof req.optimizeInstructions === "boolean") {
    input.optimize_instructions = req.optimizeInstructions
  }

  const body: Record<string, unknown> = {
    model: req.model,
    input
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${req.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`TTS provider error (${res.status}) @ ${url}: ${text || res.statusText}`)
  }

  const json = (await res.json().catch(() => null)) as any
  const audioUrl =
    json?.output?.audio?.url ||
    json?.output?.audio_url ||
    json?.output?.audioUrl ||
    json?.output?.audios?.[0]?.url ||
    json?.output?.result?.audio_url

  const audioBase64 =
    json?.output?.audio?.data ||
    json?.output?.audio ||
    json?.output?.audio_base64 ||
    json?.output?.audioBase64

  if (typeof audioBase64 === "string" && audioBase64) {
    return { bytes: Buffer.from(audioBase64, "base64"), format: "wav" }
  }

  if (typeof audioUrl === "string" && audioUrl) {
    const audioRes = await fetch(audioUrl)
    if (!audioRes.ok) {
      const text = await audioRes.text().catch(() => "")
      throw new Error(`TTS audio fetch error (${audioRes.status}) @ ${audioUrl}: ${text || audioRes.statusText}`)
    }
    const audioCt = audioRes.headers.get("content-type") || ""
    const arrayBuffer = await audioRes.arrayBuffer()
    const format = audioCt.includes("wav") || audioUrl.toLowerCase().includes(".wav") ? "wav" : "mp3"
    return { bytes: Buffer.from(arrayBuffer), format }
  }

  throw new Error(`Unexpected DashScope response: ${asErrorMessage(json)}`)
}
