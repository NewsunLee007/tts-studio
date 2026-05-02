import { createHmac } from "node:crypto"
import type { UnifiedTtsRequest, TtsAudio } from "../types.js"

function xfyunSpeed(speed = 1) {
  return Math.max(0, Math.min(100, Math.round(speed * 50)))
}

function signUrl(baseUrl: string, apiKey: string, apiSecret: string) {
  const url = new URL(baseUrl)
  const date = new Date().toUTCString()
  const signatureOrigin = `host: ${url.host}\ndate: ${date}\nGET ${url.pathname} HTTP/1.1`
  const signatureSha = createHmac("sha256", apiSecret).update(signatureOrigin).digest("base64")
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signatureSha}"`
  url.searchParams.set("authorization", Buffer.from(authorizationOrigin).toString("base64"))
  url.searchParams.set("date", date)
  url.searchParams.set("host", url.host)
  return url.toString()
}

export async function xfyunTts(req: UnifiedTtsRequest): Promise<TtsAudio> {
  const appId = req.credentials.appId
  const apiKey = req.credentials.apiKey
  const apiSecret = req.credentials.apiSecret
  if (!appId || !apiKey || !apiSecret) throw new Error("XFYun AppID, APIKey and APISecret required")
  if (!globalThis.WebSocket) throw new Error("Current Node runtime does not provide WebSocket for XFYun TTS")

  const url = signUrl(req.baseUrl || "wss://tts-api.xfyun.cn/v2/tts", apiKey, apiSecret)
  const payload = {
    common: { app_id: appId },
    business: {
      aue: "lame",
      sfl: 1,
      vcn: req.voice || "xiaoyan",
      speed: xfyunSpeed(req.speed),
      volume: Math.max(0, Math.min(100, Math.round((req.volume || 1) * 50))),
      pitch: Math.max(0, Math.min(100, Math.round((req.pitch || 1) * 50))),
      bgs: 0,
      tte: "UTF8"
    },
    data: {
      status: 2,
      text: Buffer.from(req.text, "utf8").toString("base64")
    }
  }

  return await new Promise<TtsAudio>((resolve, reject) => {
    const ws = new WebSocket(url)
    const chunks: Buffer[] = []
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error("XFYun TTS timeout"))
    }, 45_000)

    ws.onopen = () => ws.send(JSON.stringify(payload))
    ws.onerror = () => {
      clearTimeout(timer)
      reject(new Error("XFYun websocket error"))
    }
    ws.onmessage = (event) => {
      try {
        const json = JSON.parse(String(event.data)) as { code?: number; message?: string; data?: { audio?: string; status?: number } }
        if (json.code && json.code !== 0) throw new Error(json.message || `code ${json.code}`)
        if (json.data?.audio) chunks.push(Buffer.from(json.data.audio, "base64"))
        if (json.data?.status === 2) {
          clearTimeout(timer)
          ws.close()
          resolve({ bytes: Buffer.concat(chunks), format: "mp3" })
        }
      } catch (err) {
        clearTimeout(timer)
        ws.close()
        reject(err)
      }
    }
  })
}
