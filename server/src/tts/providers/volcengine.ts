import { randomUUID } from "node:crypto"
import type { UnifiedTtsRequest, TtsAudio } from "../types.js"

export async function volcengineTts(req: UnifiedTtsRequest): Promise<TtsAudio> {
  const appId = req.credentials.appId
  const accessToken = req.credentials.accessToken
  const cluster = req.credentials.cluster || req.model || "volcano_tts"
  if (!appId || !accessToken) throw new Error("Volcengine App ID and Access Token required")

  const url = req.baseUrl || "https://openspeech.bytedance.com/api/v1/tts"
  const voice = req.voice || "BV700_streaming"
  const speed = Math.max(0.5, Math.min(2, req.speed || 1))
  const volume = Math.max(0.1, Math.min(3, req.volume || 1))
  const pitch = Math.max(0.5, Math.min(2, req.pitch || 1))
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
      voice_type: voice,
      encoding: "mp3",
      speed_ratio: speed,
      volume_ratio: volume,
      pitch_ratio: pitch
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
  return {
    bytes: Buffer.from(json.data, "base64"),
    format: "mp3",
    meta: {
      provider: "volcengine",
      requestedModel: req.model,
      usedModel: cluster,
      requestedVoice: req.voice,
      usedVoice: voice,
      instructionMode: req.stylePrompt ? "suppressed" : "not-supported",
      languageType: req.languageType,
      warnings: req.stylePrompt ? ["火山引擎当前路径不发送自然语言导演指令；使用 voice_type、speed_ratio、pitch_ratio、volume_ratio 控制。"] : [],
      requestSummary: [
        { label: "接口", value: "openspeech query" },
        { label: "速度", value: speed.toFixed(2) },
        { label: "音高", value: pitch.toFixed(2) },
        { label: "音量", value: volume.toFixed(2) }
      ]
    }
  }
}
