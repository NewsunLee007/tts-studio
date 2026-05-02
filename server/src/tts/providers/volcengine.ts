import { randomUUID } from "node:crypto"
import type { UnifiedTtsRequest, TtsAudio } from "../types.js"

export async function volcengineTts(req: UnifiedTtsRequest): Promise<TtsAudio> {
  const appId = req.credentials.appId
  const accessToken = req.credentials.accessToken
  const cluster = req.credentials.cluster || req.model || "volcano_tts"
  if (!appId || !accessToken) throw new Error("Volcengine App ID and Access Token required")

  const url = req.baseUrl || "https://openspeech.bytedance.com/api/v1/tts"
  const body = {
    app: {
      appid: appId,
      token: accessToken,
      cluster
    },
    user: {
      uid: "tts-studio"
    },
    audio: {
      voice_type: req.voice || "BV700_streaming",
      encoding: "mp3",
      speed_ratio: req.speed || 1,
      volume_ratio: req.volume || 1,
      pitch_ratio: req.pitch || 1
    },
    request: {
      reqid: randomUUID(),
      text: req.text,
      text_type: "plain",
      operation: "query",
      with_frontend: 1,
      frontend_type: "unitTson"
    }
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer;${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Volcengine TTS error (${res.status}): ${text || res.statusText}`)
  }

  const json = (await res.json()) as { data?: string; message?: string; code?: number }
  if (!json.data) throw new Error(`Volcengine TTS response missing audio: ${json.message || json.code || "unknown"}`)
  return { bytes: Buffer.from(json.data, "base64"), format: "mp3" }
}
