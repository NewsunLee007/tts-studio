import type { TtsAudio, UnifiedTtsRequest } from "../types.js"
import { providerFetch } from "../providerErrors.js"

type MiniMaxResponse = {
  data?: { audio?: string; status?: number }
  trace_id?: string
  base_resp?: { status_code?: number; status_msg?: string }
  extra_info?: { audio_length?: number; usage_characters?: number }
}

function endpointFromBaseUrl(baseUrl?: string) {
  const base = (baseUrl || "https://api.minimax.cn/v1/t2a_v2").replace(/\/+$/, "")
  return base.endsWith("/v1/t2a_v2") ? base : `${base}/v1/t2a_v2`
}

function pitchToMiniMax(value = 1) {
  return Math.max(-12, Math.min(12, Math.round((value - 1) * 12)))
}

export async function minimaxTts(req: UnifiedTtsRequest): Promise<TtsAudio> {
  const apiKey = req.credentials.apiKey
  if (!apiKey) throw new Error("MiniMax API Key required")

  const payload = {
    model: req.model || "speech-2.8-turbo",
    text: req.text,
    stream: false,
    output_format: "hex",
    language_boost: /[\u3400-\u9fff]/.test(req.text) ? "Chinese" : "English",
    voice_setting: {
      voice_id: req.voice || "English_Graceful_Lady",
      speed: Math.max(0.5, Math.min(2, req.speed || 1)),
      vol: Math.max(0.1, Math.min(10, req.volume || 1)),
      pitch: pitchToMiniMax(req.pitch),
      emotion: "calm"
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: "mp3",
      channel: 1
    },
    subtitle_enable: false
  }

  const res = await providerFetch(endpointFromBaseUrl(req.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  })
  const responseText = await res.text()
  const json = (() => {
    try {
      return JSON.parse(responseText) as MiniMaxResponse
    } catch {
      return null
    }
  })()
  const statusCode = json?.base_resp?.status_code
  if (!res.ok || (typeof statusCode === "number" && statusCode !== 0)) {
    throw new Error(`MiniMax TTS error (${res.status}): ${json?.base_resp?.status_msg || responseText || res.statusText}`)
  }
  const audio = json?.data?.audio
  if (!audio) throw new Error("MiniMax TTS response missing audio")

  return {
    bytes: Buffer.from(audio, "hex"),
    format: "mp3",
    meta: {
      provider: "minimax",
      requestedModel: req.model,
      usedModel: payload.model,
      requestedVoice: req.voice,
      usedVoice: payload.voice_setting.voice_id,
      instructionMode: req.stylePrompt ? "suppressed" : "not-supported",
      languageType: payload.language_boost,
      warnings: req.stylePrompt ? ["MiniMax 当前通过音色、语速、音调和 calm 情绪控制考试风格，不发送自然语言导演提示。"] : [],
      requestSummary: [
        { label: "模型", value: payload.model },
        { label: "语言", value: payload.language_boost },
        { label: "语速", value: payload.voice_setting.speed.toFixed(2) },
        { label: "字符", value: String(json?.extra_info?.usage_characters || req.text.length) }
      ]
    }
  }
}
