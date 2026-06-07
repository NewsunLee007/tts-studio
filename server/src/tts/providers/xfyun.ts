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
  const voice = req.voice || "xiaoyan"
  const speed = xfyunSpeed(req.speed)
  const volume = Math.max(0, Math.min(100, Math.round((req.volume || 1) * 50)))
  const pitch = Math.max(0, Math.min(100, Math.round((req.pitch || 1) * 50)))
  const payload = {
    common: { app_id: appId },
    business: {
      aue: "lame",
      sfl: 1,
      vcn: voice,
      speed,
      volume,
      pitch,
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
          resolve({
            bytes: Buffer.concat(chunks),
            format: "mp3",
            meta: {
              provider: "xfyun",
              requestedModel: req.model,
              usedModel: req.model || "standard",
              requestedVoice: req.voice,
              usedVoice: voice,
              instructionMode: req.stylePrompt ? "suppressed" : "not-supported",
              languageType: req.languageType,
              warnings: req.stylePrompt ? ["讯飞在线语音合成不发送自然语言导演指令；使用 vcn、speed、pitch、volume 控制。"] : [],
              requestSummary: [
                { label: "接口", value: "WebSocket v2" },
                { label: "speed", value: String(speed) },
                { label: "pitch", value: String(pitch) },
                { label: "volume", value: String(volume) }
              ]
            }
          })
        }
      } catch (err) {
        clearTimeout(timer)
        ws.close()
        reject(err)
      }
    }
  })
}
