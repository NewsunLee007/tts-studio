import type { UnifiedTtsRequest, TtsAudio } from "../types.js"

export async function openAiTts(req: UnifiedTtsRequest): Promise<TtsAudio> {
  const apiKey = req.credentials.apiKey
  if (!apiKey) throw new Error("OpenAI API Key required")

  const baseUrl = (req.baseUrl || "https://api.openai.com").replace(/\/+$/, "")
  const url = `${baseUrl}/v1/audio/speech`

  const body: Record<string, unknown> = {
    model: req.model || "gpt-4o-mini-tts",
    voice: req.voice || "coral",
    input: req.text,
    response_format: "mp3"
  }

  if (req.stylePrompt) body.instructions = req.stylePrompt
  if (typeof req.speed === "number") body.speed = req.speed

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`OpenAI TTS error (${res.status}): ${text || res.statusText}`)
  }

  const arrayBuffer = await res.arrayBuffer()
  return { bytes: Buffer.from(arrayBuffer), format: "mp3" }
}
