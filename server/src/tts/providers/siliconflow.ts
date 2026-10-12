import type { UnifiedTtsRequest, TtsAudio } from "../types.js"
import { providerFetch } from "../providerErrors.js"

export async function siliconflowTts(req: UnifiedTtsRequest): Promise<TtsAudio> {
  if (!req.credentials.apiKey) throw new Error("SiliconFlow API Key required")
  const model = req.model || "FunAudioLLM/CosyVoice2-0.5B"
  const voice = req.voice?.includes(":") ? req.voice : `${model}:${req.voice || "anna"}`
  const base = (req.baseUrl || "https://api.siliconflow.cn/v1").replace(/\/+$/, "")
  const res = await providerFetch(`${base}/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${req.credentials.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: req.text, voice, response_format: "mp3", sample_rate: 32000, speed: Math.max(0.5, Math.min(2, req.speed || 1)), stream: false })
  })
  if (!res.ok) throw new Error(`SiliconFlow (${res.status}): ${(await res.text()).slice(0, 1200)}`)
  if (res.headers.get("content-type")?.includes("json")) throw new Error(`SiliconFlow: ${(await res.text()).slice(0, 1200)}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (!bytes.length) throw new Error("SiliconFlow response missing audio")
  return { bytes, format: "mp3", meta: { provider: "siliconflow", usedModel: model, usedVoice: voice, instructionMode: "not-supported" } }
}
