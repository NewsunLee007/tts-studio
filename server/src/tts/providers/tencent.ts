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

  const payload = JSON.stringify({
    Text: req.text,
    SessionId: `tts-studio-${timestamp}`,
    ModelType: 1,
    VoiceType: Number(req.voice || 10510000),
    Codec: "mp3",
    SampleRate: 16000,
    Speed: speedToTencent(req.speed),
    Volume: Math.round((req.volume || 1) * 5)
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
  return { bytes: Buffer.from(audio, "base64"), format: "mp3" }
}
