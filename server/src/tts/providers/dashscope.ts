import type { UnifiedTtsRequest, TtsAudio } from "../types.js"

function parseDashscopeAudio(json: unknown) {
  const data = json as Record<string, any>
  const audioUrl =
    data?.output?.audio?.url ||
    data?.output?.audio_url ||
    data?.output?.audioUrl ||
    data?.output?.audios?.[0]?.url ||
    data?.output?.result?.audio_url

  const audioBase64 =
    data?.output?.audio?.data ||
    data?.output?.audio ||
    data?.output?.audio_base64 ||
    data?.output?.audioBase64

  return { audioUrl, audioBase64 }
}

function normalizeInstructions(value: string) {
  const cleaned = value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (cleaned.length <= 1000) return cleaned
  return cleaned.slice(0, 1000)
}

const slashPhonemePattern = /\/([^/\n]{1,40})\//g

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function normalizeIpaToken(raw: string) {
  return raw
    .trim()
    .replace(/\s+/g, "")
    .replace(/ei/g, "eɪ")
    .replace(/ou/g, "oʊ")
    .replace(/ɑ:/g, "ɑː")
    .replace(/ɔ:/g, "ɔː")
    .replace(/ɜ:/g, "ɜː")
    .replace(/i:/g, "iː")
    .replace(/u:/g, "uː")
}

function phonemeFallbackText(ipa: string, raw: string) {
  const compact = raw.trim().replace(/\s+/g, "")
  const normalized = ipa.replace(/[ˈˌ.]/g, "")
  const known: Record<string, string> = {
    sp: "sp",
    "speɪ": "spay",
    "speɪs": "space"
  }
  return known[normalized] || compact || ipa
}

function dashscopeTextPayload(text: string) {
  if (!slashPhonemePattern.test(text)) return { text, ssml: false }
  slashPhonemePattern.lastIndex = 0
  let lastIndex = 0
  let ssml = "<speak>"
  for (const match of text.matchAll(slashPhonemePattern)) {
    const start = match.index || 0
    const rawToken = match[1] || ""
    const ipa = normalizeIpaToken(rawToken)
    ssml += escapeXml(text.slice(lastIndex, start))
    ssml += `<phoneme alphabet="ipa" ph="/${escapeXml(ipa)}/">${escapeXml(phonemeFallbackText(ipa, rawToken))}</phoneme>`
    lastIndex = start + match[0].length
  }
  ssml += escapeXml(text.slice(lastIndex))
  ssml += "</speak>"
  return { text: ssml, ssml: true }
}

function compatibleCosyVoice(model: string, voice?: string) {
  const requested = voice || ""
  if (model.startsWith("cosyvoice-v3")) {
    if (!requested || requested.endsWith("_v2") || ["Cherry", "Ethan"].includes(requested)) return "loongbella_v3"
    return requested
  }
  if (model.startsWith("cosyvoice-v2")) {
    if (!requested || requested.endsWith("_v3") || requested === "longanyang" || ["Cherry", "Ethan"].includes(requested)) return "loongbella_v2"
    return requested
  }
  return requested || "loongbella_v2"
}

const qwenVoiceByGender = {
  female: ["Cherry", "Serena", "Chelsie"],
  male: ["Ethan"]
}

function qwenVoiceAttempts(preferredVoice: string) {
  const allowed = [...qwenVoiceByGender.female, ...qwenVoiceByGender.male]
  const preferredGender = qwenVoiceByGender.male.includes(preferredVoice) ? qwenVoiceByGender.male : qwenVoiceByGender.female.includes(preferredVoice) ? qwenVoiceByGender.female : []
  return Array.from(new Set([preferredVoice, ...preferredGender, ...allowed])).filter(Boolean)
}

function isUnsupportedQwenVoiceError(errorText: string) {
  return /Voice .* is not supported|voice.*not.*supported|Input should be .*input\.voice/i.test(errorText)
}

export async function dashscopeTts(req: UnifiedTtsRequest): Promise<TtsAudio> {
  const apiKey = req.credentials.apiKey
  if (!apiKey) throw new Error("DashScope API Key required")

  const rawBase = (req.baseUrl || "https://dashscope.aliyuncs.com/api/v1").replace(/\/+$/, "")
  const base = rawBase.endsWith("/api/v1") ? rawBase : `${rawBase}/api/v1`
  const preferredModel = req.model || "qwen-tts"
  if (preferredModel.startsWith("cosyvoice-")) {
    return cosyVoiceTts(req, base, apiKey, preferredModel)
  }

  const fallbackModels = ["qwen-tts", "qwen3-tts-flash", "qwen3-tts-instruct-flash"]
  const modelAttempts = Array.from(new Set([preferredModel, ...fallbackModels]))
  const preferredVoice = req.voice || "Cherry"
  const voiceAttempts = qwenVoiceAttempts(preferredVoice)

  const url = `${base}/services/aigc/multimodal-generation/generation`

  let res: Response | null = null
  let errorText = ""
  let usedModel = preferredModel
  let usedVoice = preferredVoice

  for (const model of modelAttempts) {
    for (const voice of voiceAttempts) {
      usedModel = model
      usedVoice = voice
      const textPayload = dashscopeTextPayload(req.text)
      const input: Record<string, unknown> = {
        text: textPayload.text,
        voice
      }
      if (textPayload.ssml) input.text_type = "ssml"
      if (req.languageType) input.language_type = req.languageType
      if (req.stylePrompt) {
        input.instructions = normalizeInstructions(req.stylePrompt)
        input.optimize_instructions = false
      }

      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ model, input })
      })

      if (res.ok) break

      errorText = await res.text().catch(() => "")
      const voiceUnsupported = isUnsupportedQwenVoiceError(errorText)
      const modelUnsupported = /Model not exist|model.*not.*exist/i.test(errorText)
      const canFallbackVoice = res.status === 400 && voiceUnsupported && voice !== voiceAttempts[voiceAttempts.length - 1]
      const canFallbackModel = res.status === 400 && modelUnsupported && model !== modelAttempts[modelAttempts.length - 1]
      if (!canFallbackVoice && !canFallbackModel) {
        throw new Error(`DashScope TTS error (${res.status}): ${errorText || res.statusText}`)
      }
    }
    if (res?.ok) break
  }

  if (!res?.ok) {
    throw new Error(`DashScope TTS error: ${errorText || "model fallback failed"}`)
  }

  const json = await res.json().catch(() => null)
  const { audioUrl, audioBase64 } = parseDashscopeAudio(json)

  if (typeof audioBase64 === "string" && audioBase64) {
    return { bytes: Buffer.from(audioBase64, "base64"), format: "wav" }
  }

  if (typeof audioUrl === "string" && audioUrl) {
    const audioRes = await fetch(audioUrl)
    if (!audioRes.ok) {
      const text = await audioRes.text().catch(() => "")
      throw new Error(`DashScope audio fetch error (${audioRes.status}): ${text || audioRes.statusText}`)
    }
    const audioCt = audioRes.headers.get("content-type") || ""
    const arrayBuffer = await audioRes.arrayBuffer()
    const format = audioCt.includes("wav") || audioUrl.toLowerCase().includes(".wav") ? "wav" : "mp3"
    return { bytes: Buffer.from(arrayBuffer), format }
  }

  throw new Error(`Unexpected DashScope response: audio payload not found (model ${usedModel}, voice ${usedVoice})`)
}

async function cosyVoiceTts(req: UnifiedTtsRequest, base: string, apiKey: string, model: string): Promise<TtsAudio> {
  const url = `${base}/services/audio/tts/SpeechSynthesizer`
  const preferredVoice = compatibleCosyVoice(model, req.voice)
  const textPayload = dashscopeTextPayload(req.text)
  const input: Record<string, unknown> = {
    text: textPayload.text,
    voice: preferredVoice,
    format: "mp3",
    sample_rate: 24000,
    rate: Math.max(0.5, Math.min(2, req.speed || 1)),
    pitch: Math.max(0.5, Math.min(2, req.pitch || 1)),
    volume: Math.max(0, Math.min(100, Math.round((req.volume || 1) * 50)))
  }
  if (textPayload.ssml) input.text_type = "ssml"

  if (req.languageType) {
    const language = req.languageType.toLowerCase().startsWith("en") ? "en" : req.languageType.toLowerCase().startsWith("zh") || req.languageType === "Chinese" ? "zh" : ""
    if (language) input.language_hints = [language]
  }

  // CosyVoice system voices only accept model/voice-specific instruction formats.
  // Avoid sending arbitrary project prompts here; use text, voice, rate, pitch and volume for stability.

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model, input })
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`DashScope CosyVoice error (${res.status}): ${text || res.statusText}`)
  }

  const json = await res.json().catch(() => null)
  const { audioUrl, audioBase64 } = parseDashscopeAudio(json)

  if (typeof audioBase64 === "string" && audioBase64) {
    return { bytes: Buffer.from(audioBase64, "base64"), format: "mp3" }
  }

  if (typeof audioUrl === "string" && audioUrl) {
    const audioRes = await fetch(audioUrl)
    if (!audioRes.ok) {
      const text = await audioRes.text().catch(() => "")
      throw new Error(`DashScope CosyVoice audio fetch error (${audioRes.status}): ${text || audioRes.statusText}`)
    }
    const arrayBuffer = await audioRes.arrayBuffer()
    return { bytes: Buffer.from(arrayBuffer), format: audioUrl.toLowerCase().includes(".wav") ? "wav" : "mp3" }
  }

  throw new Error(`Unexpected DashScope CosyVoice response: audio payload not found`)
}
