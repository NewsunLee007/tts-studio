import { createHash, createHmac } from "node:crypto"
import type { UnifiedTtsRequest, TtsAudio } from "../types.js"

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest()
}

function speedToTencent(speed = 1) {
  return Math.max(-2, Math.min(2, Math.round((speed - 1) * 4)))
}

function volumeToTencent(volume = 1) {
  return Math.max(0, Math.min(10, Math.round(volume * 5)))
}

export async function tencentTts(req: UnifiedTtsRequest): Promise<TtsAudio> {
  const secretId = req.credentials.secretId
  const secretKey = req.credentials.secretKey
  if (!secretId || !secretKey) throw new Error("Tencent SecretId and SecretKey required")

  const host = "tts.tencentcloudapi.com"
  const endpoint = req.baseUrl || `https://${host}`
  const service = "tts"
  const region = req.credentials.region || "ap-guangzhou"
  const action = "TextToVoice"
  const version = "2019-08-23"
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const voice = Number(req.voice || 10510000)
  if (!Number.isFinite(voice)) throw new Error(`Tencent VoiceType must be numeric, got: ${req.voice}`)
  const speed = speedToTencent(req.speed)
  const volume = volumeToTencent(req.volume)

  const payload = JSON.stringify({
    Text: req.text,
    SessionId: `tts-studio-${timestamp}`,
    ModelType: 1,
    VoiceType: voice,
    Codec: "mp3",
    SampleRate: 16000,
    Speed: speed,
    Volume: volume
  })

  const canonicalRequest = ["POST", "/", "", `content-type:application/json; charset=utf-8\nhost:${host}\n`, "content-type;host", sha256(payload)].join("\n")
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = ["TC3-HMAC-SHA256", String(timestamp), credentialScope, sha256(canonicalRequest)].join("\n")
  const secretDate = hmac(`TC3${secretKey}`, date)
  const secretService = hmac(secretDate, service)
  const secretSigning = hmac(secretService, "tc3_request")
  const signature = createHmac("sha256", secretSigning).update(stringToSign, "utf8").digest("hex")
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json; charset=utf-8",
      Host: host,
      "X-TC-Action": action,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": version,
      "X-TC-Region": region
    },
    body: payload
  })

  const json = (await res.json().catch(() => null)) as { Response?: { Audio?: string; Error?: { Message?: string } } } | null
  if (!res.ok || json?.Response?.Error) {
    throw new Error(`Tencent TTS error (${res.status}): ${json?.Response?.Error?.Message || res.statusText}`)
  }
  const audio = json?.Response?.Audio
  if (!audio) throw new Error("Tencent TTS response missing Audio")
  return {
    bytes: Buffer.from(audio, "base64"),
    format: "mp3",
    meta: {
      provider: "tencent",
      requestedModel: req.model,
      usedModel: action,
      requestedVoice: req.voice,
      usedVoice: String(voice),
      instructionMode: req.stylePrompt ? "suppressed" : "not-supported",
      languageType: req.languageType,
      warnings: req.stylePrompt ? ["腾讯云 TextToVoice 不发送自然语言导演指令；使用 VoiceType、Speed、Volume 等参数控制。"] : [],
      requestSummary: [
        { label: "接口", value: action },
        { label: "Region", value: region },
        { label: "Speed", value: String(speed) },
        { label: "Volume", value: String(volume) }
      ]
    }
  }
}
