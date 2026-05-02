import type { UnifiedTtsRequest, TtsAudio } from "../types.js"
import { ProxyAgent, fetch as undiciFetch } from "undici"

function normalizeLanguageCode(value: string | undefined) {
  if (!value) return undefined
  const v = value.trim()
  if (!v) return undefined
  if (/^[a-z]{2}-[A-Z]{2}$/.test(v)) return v
  if (/^[a-z]{2}$/.test(v)) return v
  return undefined
}

/**
 * 解析 Google TTS API 的错误响应
 */
function parseGoogleError(responseText: string, status: number): Error {
  try {
    const parsed = JSON.parse(responseText)
    // Google API 错误格式: { error: { code, message, status, details } }
    if (parsed.error) {
      const error = parsed.error
      const message = error.message || error.status || `HTTP ${status}`
      const code = error.code || status

      // 根据状态码提供更友好的错误信息
      if (status === 400) {
        return new Error(`请求参数错误: ${message}`)
      }
      if (status === 401) {
        return new Error(`认证失败: API Key 无效或已过期`)
      }
      if (status === 403) {
        return new Error(`访问被拒绝: ${message}`)
      }
      if (status === 429) {
        return new Error(`请求频率超限: 请稍后重试`)
      }
      if (status === 500 || status === 503) {
        return new Error(`Google 服务暂时不可用: ${message}`)
      }
      return new Error(`Google TTS 错误 (${code}): ${message}`)
    }
    return new Error(`Google TTS 错误: ${responseText}`)
  } catch {
    // 无法解析 JSON，使用原始响应
    if (/^Proxy\s+error/i.test(responseText.trim())) {
      return new Error(`代理返回错误: ${responseText.trim()}`)
    }
    if (responseText.includes("NETWORK_ERROR") || responseText.includes("ECONNREFUSED")) {
      return new Error(`网络连接失败: 无法访问 Google TTS API，请检查网络或代理设置`)
    }
    return new Error(`Google TTS 错误 (${status}): ${responseText || "未知错误"}`)
  }
}

export async function googleTts(req: UnifiedTtsRequest): Promise<TtsAudio> {
  const apiKey = req.credentials.apiKey
  if (!apiKey) {
    throw new Error("Google API Key 未配置，请在设置中填入有效的 API Key")
  }

  // 验证 API Key 格式 (应以 AIza 开头)
  if (!apiKey.startsWith("AIza")) {
    throw new Error("API Key 格式无效，Google API Key 应以 'AIza' 开头")
  }

  const defaultEndpoint = "https://texttospeech.googleapis.com/v1/text:synthesize"
  const rawBaseUrl = req.baseUrl || defaultEndpoint
  const looksLikeForwardProxy = (() => {
    try {
      const u = new URL(rawBaseUrl)
      const localhost = u.hostname === "127.0.0.1" || u.hostname === "localhost"
      const hasSynthesizePath = u.pathname.includes("text:synthesize")
      return localhost && !hasSynthesizePath
    } catch {
      return false
    }
  })()

  const baseUrl = looksLikeForwardProxy ? defaultEndpoint : rawBaseUrl
  const url = new URL(baseUrl)
  if (!url.searchParams.has("key")) url.searchParams.set("key", apiKey)
  const proxyUrl =
    req.credentials.proxyUrl ||
    (looksLikeForwardProxy ? rawBaseUrl : undefined) ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY
  const dispatcher = proxyUrl ? new ProxyAgent(String(proxyUrl)) : undefined

  // 验证文本长度 (Google TTS 单次请求限制约 5000 bytes)
  const inputText = req.ssml || req.text
  const textLength = Buffer.byteLength(inputText, "utf8")
  if (textLength > 5000) {
    throw new Error(`文本过长 (${textLength} bytes)，Google TTS 单次请求限制 5000 bytes，请分段处理`)
  }
  if (textLength === 0) {
    throw new Error("文本内容不能为空")
  }

  // 验证并规范化参数
  const speakingRate = typeof req.speed === "number" && Number.isFinite(req.speed) ? Math.min(Math.max(req.speed, 0.25), 2) : undefined
  const pitch = typeof req.pitch === "number" && Number.isFinite(req.pitch) ? Math.min(Math.max((req.pitch - 1) * 10, -20), 20) : undefined
  const volumeGainDb =
    typeof req.volume === "number" && Number.isFinite(req.volume) ? Math.min(Math.max((req.volume - 1) * 10, -96), 16) : undefined

  // 验证 voice 名称格式
  const voiceName = req.voice || "en-US-Neural2-F"
  const validVoicePattern = /^[a-z]{2}-[A-Z]{2}-[A-Za-z0-9]+-?[A-Za-z0-9]*$/
  if (!validVoicePattern.test(voiceName)) {
    console.warn(`警告: voice 名称格式可能不正确: ${voiceName}`)
  }

  const body: {
    input: { text?: string; ssml?: string }
    voice: { name: string; languageCode?: string }
    audioConfig: {
      audioEncoding: "MP3"
      speakingRate?: number
      pitch?: number
      volumeGainDb?: number
    }
  } = {
    input: req.ssml ? { ssml: req.ssml } : { text: req.text },
    voice: {
      name: voiceName,
      languageCode: normalizeLanguageCode(req.languageType)
    },
    audioConfig: {
      audioEncoding: "MP3"
    }
  }

  // 从 voice 名称提取 languageCode
  if (!body.voice.languageCode) {
    const m = String(body.voice.name).match(/^([a-z]{2}-[A-Z]{2})-/)
    body.voice.languageCode = m ? m[1] : "en-US"
  }

  // 只添加非 undefined 的可选参数
  if (typeof speakingRate === "number") body.audioConfig.speakingRate = speakingRate
  if (typeof pitch === "number") body.audioConfig.pitch = pitch
  if (typeof volumeGainDb === "number") body.audioConfig.volumeGainDb = volumeGainDb

  let res: any
  let responseText = ""
  try {
    res = await undiciFetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      dispatcher,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    })
    responseText = await res.text()
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err))
    const cause = "cause" in e ? e.cause : undefined
    const details =
      cause && typeof cause === "object"
        ? [
            "code" in cause ? cause.code : "",
            "syscall" in cause ? cause.syscall : "",
            "hostname" in cause ? cause.hostname : "",
            "address" in cause ? cause.address : ""
          ].filter(Boolean).join(" ")
        : ""

    // 识别常见网络错误
    if (e.message.includes("ENOTFOUND") || e.message.includes("getaddrinfo")) {
      throw new Error("网络错误: 无法解析 Google TTS 服务器地址，请检查网络连接或代理设置")
    }
    if (e.message.includes("ETIMEDOUT") || e.message.includes("UND_ERR_CONNECT_TIMEOUT") || e.message.includes("timeout")) {
      throw new Error("网络错误: 连接 Google TTS 超时 (30秒)。在中国大陆通常需要在 Base URL 中配置可访问的 Google TTS 代理网关")
    }
    if (e.message.includes("ECONNRESET")) {
      throw new Error("网络错误: 连接被重置，请检查网络连接后重试")
    }
    if (e.message.includes("ECONNREFUSED")) {
      throw new Error("网络错误: 连接被拒绝，请检查代理设置或网络配置")
    }

    throw new Error(`Google TTS 网络错误: ${e.message}${details ? ` (${details})` : ""}`)
  }

  if (!res.ok) {
    throw parseGoogleError(responseText, res.status)
  }

  let json: any
  try {
    json = JSON.parse(responseText)
  } catch {
    const trimmed = responseText.trim()
    if (/^Proxy\s+error/i.test(trimmed) || /^<!doctype/i.test(trimmed) || /^<html/i.test(trimmed)) {
      throw new Error(`Google TTS 代理响应异常: ${trimmed.slice(0, 200)}`)
    }
    throw new Error(`无效的响应格式，无法解析 JSON: ${responseText.slice(0, 200)}`)
  }

  const audioContent = typeof json?.audioContent === "string" ? json.audioContent : ""
  if (!audioContent) {
    // 检查是否返回了其他错误字段
    if (json.error) {
      throw parseGoogleError(responseText, res.status)
    }
    throw new Error("响应中未找到 audioContent 字段，合成可能失败")
  }

  try {
    const bytes = Buffer.from(audioContent, "base64")
    if (bytes.length === 0) {
      throw new Error("合成的音频数据为空")
    }
    return { bytes, format: "mp3" }
  } catch (err) {
    if (err instanceof Error && err.message.includes("音频")) {
      throw err
    }
    throw new Error(`音频数据解码失败: ${err instanceof Error ? err.message : "未知错误"}`)
  }
}
