import { randomUUID } from "node:crypto"
import type { UnifiedTtsRequest, TtsAudio } from "../types.js"
import { providerFetch } from "../providerErrors.js"

export async function doubaoTts(req: UnifiedTtsRequest): Promise<TtsAudio> {
  if (!req.credentials.apiKey) throw new Error("Doubao API Key required")
  const voice = req.voice || "zh_female_vv_uranus_bigtts"
  const res = await providerFetch(req.baseUrl || "https://openspeech.bytedance.com/api/v3/tts/unidirectional", {
    method: "POST",
    headers: {
      "X-Api-Key": req.credentials.apiKey,
      "X-Api-Resource-Id": "seed-tts-2.0",
      "X-Api-Request-Id": randomUUID(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ req_params: {
      text: req.text, speaker: voice,
      audio_params: { format: "mp3", sample_rate: 24000, speech_rate: Math.round((Math.max(0.5, Math.min(2, req.speed || 1)) - 1) * 100) }
    } })
  })
  if (!res.ok) throw new Error(`Doubao (${res.status}): ${(await res.text()).slice(0, 1200)}`)
  if (!res.body) throw new Error("Doubao response missing audio")
  const chunks: Buffer[] = []
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let pending = ""
  let finished = false
  const parse = (line: string) => {
    if (!line.trim()) return
    const item = JSON.parse(line) as { code?: number; message?: string; data?: string }
    if (item.code !== undefined && item.code !== 0 && item.code !== 20000000) throw new Error(`Doubao (${item.code}): ${item.message || "生成失败"}`)
    if (item.data) chunks.push(Buffer.from(item.data, "base64"))
    if (item.code === 20000000) finished = true
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      const lines = pending.split("\n")
      pending = lines.pop() || ""
      for (const line of lines) parse(line)
      if (done) break
    }
    parse(pending)
  } finally { await reader.cancel().catch(() => {}) }
  if (!finished || !chunks.length) throw new Error("Doubao audio stream incomplete; please retry")
  return { bytes: Buffer.concat(chunks), format: "mp3", meta: { provider: "doubao", usedModel: "seed-tts-2.0", usedVoice: voice, instructionMode: "not-supported" } }
}
