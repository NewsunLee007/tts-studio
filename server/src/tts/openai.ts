import { stylePresets, type StylePresetId } from "../presets.js"
import type { TtsAudio } from "./types.js"

export type OpenAiTtsRequest = {
  apiKey: string
  text: string
  voice: string
  model?: string
  stylePresetId?: StylePresetId | ""
  stylePrompt?: string
  speed?: number
  baseUrl?: string
}

export async function openAiTts(req: OpenAiTtsRequest): Promise<TtsAudio> {
  const baseUrl = (req.baseUrl || "https://api.openai.com").replace(/\/+$/, "")
  const url = `${baseUrl}/v1/audio/speech`

  const preset = req.stylePresetId
    ? stylePresets.find((p) => p.id === req.stylePresetId)
    : undefined
  const instructions = [preset?.prompt, req.stylePrompt].filter(Boolean).join("\n")

  const body: Record<string, unknown> = {
    model: req.model || "gpt-4o-mini-tts",
    voice: req.voice,
    input: req.text,
    response_format: "mp3"
  }

  if (instructions) body.instructions = instructions
  if (typeof req.speed === "number") body.speed = req.speed

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
    throw new Error(`TTS provider error (${res.status}): ${text || res.statusText}`)
  }

  const arrayBuffer = await res.arrayBuffer()
  return { bytes: Buffer.from(arrayBuffer), format: "mp3" }
}
