import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"
import "./App.css"
import { BulkPaste } from "./components/BulkPaste"
import { SegmentEditor } from "./components/SegmentEditor"
import { SegmentList } from "./components/SegmentList"
import { SettingsDrawer } from "./components/SettingsDrawer"
import { TopBar } from "./components/TopBar"
import type { ExamDraftSegment } from "./lib/examScriptParser"
import type {
  EnglishAccentId,
  ExamTemplate,
  PacePreset,
  PacePresetId,
  ProviderCatalogResponse,
  ProviderConfig,
  ProviderId,
  ProvidersResponse,
  Segment,
  SegmentPatch,
  TtsSegment,
  VoiceGender
} from "./types"

type ApplyMode = "append" | "replace"
type DirectorSegment = Segment & { stylePresetId?: string }

function isSecondPassSegment(segment: Segment) {
  return segment.type === "tts" && /第\s*2\s*遍|第2遍/.test(segment.directorNote || "")
}

function isFirstPassSegment(segment: Segment) {
  return segment.type === "tts" && /第\s*1\s*遍|第1遍/.test(segment.directorNote || "")
}

function repeatMatchKey(segment: Segment) {
  if (segment.type !== "tts") return ""
  return [segment.groupId || "", segment.label || "", segment.role || "", segment.text.trim()].join("\u001f")
}

function isTtsSegment(segment: Segment): segment is TtsSegment {
  return segment.type === "tts"
}

function stripLeadingSpeakerTag(input: string) {
  let next = input.trim()
  let previous = ""
  while (next && next !== previous) {
    previous = next
    next = next
      .replace(/^\s*(?:(\d+)[.、)]\s*)?(?:M|W|A|B|Male|Female|Man|Woman|男|女|男士|女士)\s*[:：]\s*/i, "")
      .trim()
  }
  return next
}

function normalizeDialogueText(input: string) {
  return input
    .split("\n")
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((line) => {
      const speaker = line.match(/^\s*(M|W|A|B|Male|Female|Man|Woman|男|女|男士|女士)\s*[:：]/i)?.[1] || ""
      if (!speaker) return line
      const normalizedSpeaker = /^(?:W|B|Female|Woman|女|女士)$/i.test(speaker) ? "Female" : "Male"
      return `${normalizedSpeaker}: ${stripLeadingSpeakerTag(line)}`
    })
    .join("\n")
}

function normalizeGeminiDialogueText(input: string) {
  return normalizeDialogueText(input)
    .split("\n")
    .map((line) => {
      const female = line.match(/^\s*(?:W|B|Woman|Female|女|女士)\s*[:：]\s*(.+)$/i)
      if (female) return `Female: ${female[1].trim()}`
      const male = line.match(/^\s*(?:M|A|Man|Male|男|男士)\s*[:：]\s*(.+)$/i)
      if (male) return `Male: ${male[1].trim()}`
      return line
    })
    .join("\n")
}

function isNonAudioExamLine(line: string) {
  const text = line.trim()
  if (!text) return true
  if (/^(?:选项\s*)?[A-D][.、):：]\s*\S+/i.test(text)) return true
  if (/^(?:参考答案|答案|听力答案|Answer\s+key|Answers?)\b/i.test(text)) return true
  if (/^\d+\s*[.、)]\s*(?:What|Where|When|Why|How|Who|Which|Whose|Whom|Can|Could|Would|Will|Is|Are|Do|Does|Did|Has|Have|Was|Were)\b/i.test(text)) return true
  if (/^(?:Questions?|Q)\s*\d+/i.test(text)) return true
  if (/^(?:第\s*)?\d+\s*[.、)]\s*.+[?？]$/.test(text)) return true
  if (/^第\s*[0-9一二两三四五六七八九十]+\s*题\s*[:：]?.+[?？]$/.test(text)) return true
  return false
}

function cleanExamAudioText(input: string) {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !isNonAudioExamLine(line))
    .join("\n")
    .trim()
}

function stableHash(input: string) {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function linkRepeatedAudioSegments(input: Segment[]) {
  const firstPass = new Map<string, string[]>()
  return input.map((segment) => {
    if (segment.type !== "tts") return segment
    const key = repeatMatchKey(segment)
    if (isSecondPassSegment(segment)) {
      const sourceUid = firstPass.get(key)?.shift()
      return sourceUid ? { ...segment, repeatOfUid: sourceUid, status: "idle" as const } : segment
    }
    if (isFirstPassSegment(segment)) {
      const list = firstPass.get(key) || []
      list.push(segment.uid)
      firstPass.set(key, list)
    }
    return segment
  })
}

const defaultTemplate: ExamTemplate = {
  school: "",
  schoolYear: "2025 学年",
  semester: "第二学期",
  examName: "期中考试",
  subject: "英语",
  grade: "",
  examType: "期中考试",
  includeIntroMusic: true,
  introMusicPreset: "warmup",
  includeExamIntro: true,
  includeQuestionNumbers: true,
  majorBreakMs: 10000,
  minorBreakMs: 5000,
  questionNumberGapMs: 1000,
  englishWordsPerMinute: 118,
  chineseCharsPerMinute: 210
}

function safeGetItem(key: string) {
  try {
    return typeof window === "undefined" ? null : localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 静默处理 localStorage 写入失败
  }
}

function readJson(key: string) {
  const raw = safeGetItem(key)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function providerPrefsKey(provider: ProviderId) {
  return `tts_provider_prefs_${provider}`
}

const fallbackPaces: PacePreset[] = [
  { id: "exam_slow", label: "中考慢速", speed: 0.76, description: "更慢、更清楚，适合初中听力" },
  { id: "exam_standard", label: "高考标准", speed: 0.86, description: "正式高考听力的稳健语速" },
  { id: "dialogue_natural", label: "自然对话", speed: 0.96, description: "接近日常交流但不过快" },
  { id: "quick_preview", label: "快速预览", speed: 1.08, description: "用于草稿试听" }
]

const englishAccentOptions: Array<{ id: EnglishAccentId; label: string; locale: "en-GB" | "en-US" | "en"; description: string; instruction: string }> = [
  {
    id: "british_standard",
    label: "英式标准",
    locale: "en-GB",
    description: "默认选项，适合中高考正式听力",
    instruction: "Use standard British English pronunciation. Keep vowels and rhythm consistent with UK English listening tests."
  },
  {
    id: "british_rp_exam",
    label: "英式 RP 考试腔",
    locale: "en-GB",
    description: "更正式、更清楚，适合题号和考试说明",
    instruction: "Use clear Received Pronunciation British English. Avoid regional slang. Keep articulation formal and exam-like."
  },
  {
    id: "american_general",
    label: "美国通用",
    locale: "en-US",
    description: "适合美式教材或美音听力",
    instruction: "Use General American English pronunciation with stable, neutral classroom delivery."
  },
  {
    id: "international_clear",
    label: "国际清晰",
    locale: "en",
    description: "弱化地域口音，优先清楚和可懂度",
    instruction: "Use internationally intelligible English with neutral accent influence, clear consonants, and no strong regional features."
  }
]

function uid() {
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2)
}

function defaultTtsSegment(defaults: { voiceId: string; modelId: string; stylePresetId: string; stylePrompt: string; pacePreset: PacePresetId; speed: number }) {
  return {
    uid: uid(),
    type: "tts" as const,
    text: "",
    voiceId: defaults.voiceId,
    modelId: defaults.modelId,
    stylePresetId: defaults.stylePresetId,
    stylePrompt: defaults.stylePrompt,
    role: "neutral" as const,
    pacePreset: defaults.pacePreset,
    speed: defaults.speed,
    pitch: 1,
    volume: 1,
    status: "idle" as const
  }
}


function estimateSeconds(segments: Segment[]) {
  return segments.reduce((total, segment) => {
    if (segment.type === "silence" || segment.type === "music") return total + segment.durationMs / 1000
    const chars = segment.text.trim().replace(/\s+/g, " ").length
    return total + chars / 12 / (segment.speed || 1)
  }, 0)
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.round(seconds))
  const min = Math.floor(safe / 60)
  const sec = safe % 60
  return `${min}:${String(sec).padStart(2, "0")}`
}

function providerLocalKey(provider: ProviderId, key: string) {
  return `tts_${provider}_${key}`
}

function credentialsComplete(provider: ProviderConfig | undefined, credentials: Record<string, string>) {
  if (!provider || provider.status !== "ready") return false
  return provider.credentialFields.every((field) => !field.required || Boolean(credentials[field.key]?.trim()))
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function isRetryableTtsError(message: string) {
  return /429|RateQuota|rate limit|Throttling|超时|timeout|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/i.test(message)
}

function readStoredNumber(key: string, fallback: number) {
  const raw = safeGetItem(key)
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

function clampSpeedMultiplier(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.min(Math.max(value, 0.68), 1.18)
}

function containsPhonicsToken(text: string) {
  return /\/[^/\n]{1,32}\//.test(text)
}

function hasChineseText(text: string) {
  return /[\u3400-\u9fff]/.test(text)
}

function targetSpeedForText(text: string, template: ExamTemplate) {
  if (hasChineseText(text)) {
    const target = Number.isFinite(template.chineseCharsPerMinute) ? template.chineseCharsPerMinute : 210
    return Math.max(0.5, Math.min(2, target / 250))
  }
  const target = Number.isFinite(template.englishWordsPerMinute) ? template.englishWordsPerMinute : 118
  return Math.max(0.5, Math.min(2, target / 150))
}

function languageRateDirective(text: string, template: ExamTemplate) {
  if (hasChineseText(text)) {
    const cpm = Number.isFinite(template.chineseCharsPerMinute) ? template.chineseCharsPerMinute : 210
    return `Mandarin Chinese delivery target: approximately ${cpm} Chinese characters per minute. Use standard Putonghua, CCTV News anchor style, clear tones, logical phrase grouping, authoritative yet warm.`
  }
  const wpm = Number.isFinite(template.englishWordsPerMinute) ? template.englishWordsPerMinute : 118
  return `English delivery target: approximately ${wpm} words per minute. Use Standard British RP, professional warm exam-listening tone, clear word endings, and distinct punctuation pauses.`
}

export default function App() {
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [styles, setStyles] = useState<Array<{ id: string; label: string }>>([])
  const [paces, setPaces] = useState<PacePreset[]>(fallbackPaces)
  const [provider, setProvider] = useState<ProviderId>(() => (safeGetItem("tts_last_provider") as ProviderId) || "dashscope")
  const [credentialsByProvider, setCredentialsByProvider] = useState<Record<string, Record<string, string>>>({})
  const [modelId, setModelId] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [languageType, setLanguageType] = useState("English")
  const [voiceGender, setVoiceGender] = useState<VoiceGender | "all">("all")
  const [voiceId, setVoiceId] = useState("")
  const [geminiMaleVoiceId, setGeminiMaleVoiceId] = useState("")
  const [geminiFemaleVoiceId, setGeminiFemaleVoiceId] = useState("")
  const [stylePresetId] = useState("exam_host")
  const [stylePrompt, setStylePrompt] = useState(() => (typeof readJson("tts_style_prompt") === "string" ? (readJson("tts_style_prompt") as string) : ""))
  const [pacePreset, setPacePreset] = useState<PacePresetId>(() => (safeGetItem("tts_pace_preset") as PacePresetId) || "exam_standard")
  const [speedMultiplier, setSpeedMultiplier] = useState(() => clampSpeedMultiplier(readStoredNumber("tts_speed_multiplier", 1)))
  const [englishAccent, setEnglishAccent] = useState<EnglishAccentId>(() => {
    const stored = safeGetItem("tts_english_accent") as EnglishAccentId | null
    return stored && englishAccentOptions.some((item) => item.id === stored) ? stored : "british_standard"
  })
  const [template, setTemplate] = useState<ExamTemplate>(() => {
    const raw = readJson("tts_exam_template")
    return raw && typeof raw === "object" ? { ...defaultTemplate, ...(raw as Record<string, unknown>) } : defaultTemplate
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [previewError, setPreviewError] = useState("")
  const [pastePaneWidth, setPastePaneWidth] = useState(520)
  const [exportFormat, setExportFormat] = useState<"mp3" | "wav">(() => (safeGetItem("tts_export_format") === "wav" ? "wav" : "mp3"))
  const [speedSampleUrl, setSpeedSampleUrl] = useState("")
  const [speedSampleState, setSpeedSampleState] = useState<"idle" | "generating" | "done" | "error">("idle")
  const [speedSampleError, setSpeedSampleError] = useState("")
  const [catalogState, setCatalogState] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [catalogMessage, setCatalogMessage] = useState("")

  const [segments, setSegments] = useState<Segment[]>([])
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [composeRunning, setComposeRunning] = useState(false)
  const [composeError, setComposeError] = useState("")
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkProgressText, setBulkProgressText] = useState("")
  const [analyzing, setAnalyzing] = useState(false)
  const stopRef = useRef(false)
  const previewStopRef = useRef(false)
  const previewRunIdRef = useRef(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const providerRef = useRef(provider)

  useEffect(() => {
    fetch("/api/providers")
      .then(async (res) => {
        const text = await res.text()
        const data = (() => {
          try {
            return JSON.parse(text) as Partial<ProvidersResponse> & { error?: string; detail?: string }
          } catch {
            return null
          }
        })()
        if (!res.ok) {
          const message = data?.error || data?.detail || text || `HTTP ${res.status}`
          throw new Error(message)
        }
        if (!data || !Array.isArray(data.providers) || !Array.isArray(data.styles)) {
          throw new Error("Invalid /api/providers response")
        }
        return data as ProvidersResponse
      })
      .then((data) => {
        setProviders(data.providers)
        setStyles(data.styles)
        setPaces(data.paces?.length ? data.paces : fallbackPaces)
        if (!data.providers.find((item) => item.id === provider)) {
          const firstReady = data.providers.find((item) => item.id === "dashscope") || data.providers.find((item) => item.status === "ready") || data.providers[0]
          if (firstReady) setProvider(firstReady.id)
        }
      })
      .catch((err) => {
        setProviders([])
        setStyles([])
        setPaces(fallbackPaces)
        setComposeError(err instanceof Error ? `后端未就绪：${err.message}` : "后端未就绪：无法加载服务商列表")
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const providerConfig = useMemo(() => providers.find((item) => item.id === provider), [providers, provider])
  const credentials = credentialsByProvider[provider] || {}
  const pace = paces.find((item) => item.id === pacePreset) || fallbackPaces[1]
  const calibratedSpeed = Math.max(0.5, Math.min(2, pace.speed * speedMultiplier))
  const accentOption = englishAccentOptions.find((item) => item.id === englishAccent) || englishAccentOptions[0]
  const selectedSegment = useMemo(() => segments.find((item) => item.uid === selectedUid) || null, [segments, selectedUid])
  const geminiOverrideText = (overrides?: Record<string, unknown>) => {
    const value = overrides?.geminiGroupText
    return typeof value === "string" ? value : ""
  }
  const geminiContextPreview = useMemo(() => {
    if (provider !== "google_gemini") return ""
    if (!selectedSegment || selectedSegment.type !== "tts") return ""
    const seg = selectedSegment as TtsSegment
    if (!seg.groupId) return ""
    if (seg.role === "question" || seg.stylePresetId === "question_marker") return ""
    const override = cleanExamAudioText(geminiOverrideText(seg.providerOverrides))
    if (override) return normalizeDialogueText(override)
    const list = segments.filter((item): item is TtsSegment => isTtsSegment(item) && item.groupId === seg.groupId && !isSecondPassSegment(item) && !item.repeatOfUid)
    const content = list.filter((s) => s.role !== "question" && s.stylePresetId !== "question_marker" && Boolean(s.text.trim()))
    if (!content.length) return ""
    const hasDialogue = content.some((s) => s.role === "male" || s.role === "female" || ["M", "W", "A", "B"].includes((s.label || "").trim().toUpperCase()))
    if (!hasDialogue) return cleanExamAudioText(content.map((s) => s.text.trim()).join("\n\n"))
    const lines = content.map((s) => {
      const label = (s.label || "").trim().toUpperCase()
      const speaker = s.role === "female" || label === "W" || label === "B" ? "Female" : "Male"
      return `${speaker}: ${stripLeadingSpeakerTag(s.text.trim())}`
    })
    return normalizeGeminiDialogueText(cleanExamAudioText(lines.join("\n")))
  }, [provider, selectedSegment, segments])

  type PreviewItem = { kind: "silence"; durationMs: number } | { kind: "audio"; url: string }

  const previewItems = useMemo<PreviewItem[]>(() => {
    const out: PreviewItem[] = []
    for (const item of segments) {
      if (item.type === "silence") out.push({ kind: "silence", durationMs: item.durationMs })
      else if (item.type === "tts") {
        const source = item.repeatOfUid ? segments.find((candidate): candidate is TtsSegment => isTtsSegment(candidate) && candidate.uid === item.repeatOfUid) : null
        const url = item.audioUrl || source?.audioUrl
        if (url) out.push({ kind: "audio", url })
      }
    }
    return out
  }, [segments])

  useEffect(() => {
    if (!providerConfig) return
    const nextCredentials: Record<string, string> = {}
    for (const field of providerConfig.credentialFields) {
      nextCredentials[field.key] = safeGetItem(providerLocalKey(providerConfig.id, field.key)) || ""
    }
    setCredentialsByProvider((prev) => ({ ...prev, [providerConfig.id]: nextCredentials }))
    const prefs = readJson(providerPrefsKey(providerConfig.id))
    const prefObj = prefs && typeof prefs === "object" ? (prefs as Record<string, unknown>) : {}
    const candidateModel = typeof prefObj.modelId === "string" ? prefObj.modelId : ""
    const candidateVoice = typeof prefObj.voiceId === "string" ? prefObj.voiceId : ""
    const candidateBaseUrl = typeof prefObj.baseUrl === "string" ? prefObj.baseUrl : ""
    const candidateLanguage = typeof prefObj.languageType === "string" ? prefObj.languageType : ""
    const candidateVoiceGender =
      prefObj.voiceGender === "male" || prefObj.voiceGender === "female" || prefObj.voiceGender === "neutral" || prefObj.voiceGender === "all"
        ? prefObj.voiceGender
        : ""
    const candidateGeminiMaleVoice = typeof prefObj.geminiMaleVoiceId === "string" ? prefObj.geminiMaleVoiceId : ""
    const candidateGeminiFemaleVoice = typeof prefObj.geminiFemaleVoiceId === "string" ? prefObj.geminiFemaleVoiceId : ""

    setModelId(providerConfig.models.some((m) => m.id === candidateModel) ? candidateModel : providerConfig.defaultModelId)
    setVoiceId(providerConfig.voices.some((v) => v.id === candidateVoice) ? candidateVoice : providerConfig.defaultVoiceId)
    setBaseUrl(candidateBaseUrl || providerConfig.defaultBaseUrl || "")
    setLanguageType(providerConfig.id === "dashscope" ? (candidateLanguage || "English") : "")
    if (candidateVoiceGender) setVoiceGender(candidateVoiceGender)
    if (providerConfig.id === "google_gemini") {
      const maleCandidate = providerConfig.voices.find((v) => v.id === candidateGeminiMaleVoice && v.gender === "male")?.id
      const femaleCandidate = providerConfig.voices.find((v) => v.id === candidateGeminiFemaleVoice && v.gender === "female")?.id
      setGeminiMaleVoiceId(maleCandidate || providerConfig.voices.find((v) => v.gender === "male" && v.role === "dialogue")?.id || "Puck")
      setGeminiFemaleVoiceId(femaleCandidate || providerConfig.voices.find((v) => v.gender === "female" && v.role === "dialogue")?.id || "Kore")
    } else {
      setGeminiMaleVoiceId("")
      setGeminiFemaleVoiceId("")
    }
  }, [providerConfig])

  useEffect(() => {
    providerRef.current = provider
    safeSetItem("tts_last_provider", provider)
    setCatalogState("idle")
    setCatalogMessage("")
  }, [provider])

  useEffect(() => {
    safeSetItem("tts_style_prompt", JSON.stringify(stylePrompt))
  }, [stylePrompt])

  useEffect(() => {
    safeSetItem("tts_pace_preset", pacePreset)
  }, [pacePreset])

  useEffect(() => {
    safeSetItem("tts_speed_multiplier", String(speedMultiplier))
  }, [speedMultiplier])

  useEffect(() => {
    safeSetItem("tts_english_accent", englishAccent)
  }, [englishAccent])

  useEffect(() => {
    safeSetItem("tts_exam_template", JSON.stringify(template))
  }, [template])

  useEffect(() => {
    safeSetItem("tts_export_format", exportFormat)
  }, [exportFormat])

  useEffect(() => {
    safeSetItem(
      providerPrefsKey(provider),
      JSON.stringify({
        modelId,
        voiceId,
        baseUrl,
        languageType,
        voiceGender,
        geminiMaleVoiceId: provider === "google_gemini" ? geminiMaleVoiceId : "",
        geminiFemaleVoiceId: provider === "google_gemini" ? geminiFemaleVoiceId : ""
      })
    )
  }, [provider, modelId, voiceId, baseUrl, languageType, voiceGender, geminiMaleVoiceId, geminiFemaleVoiceId])

  function setCredentials(next: Record<string, string>) {
    setCredentialsByProvider((prev) => ({ ...prev, [provider]: next }))
    for (const [key, value] of Object.entries(next)) {
      safeSetItem(providerLocalKey(provider, key), value)
    }
  }

  async function refreshProviderCatalog() {
    const current = providerConfig
    if (!current) return
    const requestProvider = current.id
    setCatalogState("loading")
    setCatalogMessage("")
    try {
      const res = await fetch(`/api/providers/${requestProvider}/catalog`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials, baseUrl })
      })
      const json = (await res.json()) as ProviderCatalogResponse
      if (providerRef.current !== requestProvider) return
      if (!res.ok && !json.models?.length && !json.voices?.length) throw new Error(json.error || "刷新远端模型失败")

      setProviders((prev) =>
        prev.map((item) =>
          item.id === requestProvider
            ? {
                ...item,
                models: json.models?.length ? json.models : item.models,
                voices: json.voices?.length ? json.voices : item.voices
              }
            : item
        )
      )

      if (json.models?.length && !json.models.some((item) => item.id === modelId)) setModelId(json.models[0].id)
      if (json.voices?.length && !json.voices.some((item) => item.id === voiceId)) setVoiceId(json.voices[0].id)
      setCatalogState(res.ok ? "done" : "error")
      setCatalogMessage(json.message || json.error || (json.source === "remote" ? "已刷新远端模型/音色。" : "当前服务商使用内置列表。"))
    } catch (err) {
      if (providerRef.current !== requestProvider) return
      setCatalogState("error")
      setCatalogMessage(err instanceof Error ? err.message : "刷新远端模型失败")
    }
  }

  function updateSegment(segUid: string, patch: SegmentPatch) {
    setSegments((prev) =>
      prev.map((item) => {
        if (item.uid !== segUid) {
          if (item.type === "tts" && "text" in patch && item.repeatOfUid === segUid) {
            return { ...item, audioId: undefined, audioUrl: undefined, status: "idle", error: "" }
          }
          return item
        }
        const next = { ...item, ...patch } as Segment
        if (item.type === "tts" && "text" in patch && patch.text !== item.text) {
          return { ...next, audioId: undefined, audioUrl: undefined, status: "idle", error: "" }
        }
        return next
      })
    )
  }

  function deleteSegment(segUid: string) {
    setSegments((prev) => prev.filter((item) => item.uid !== segUid))
    setSelectedUid((prev) => (prev === segUid ? null : prev))
  }

  function clearAllSegments() {
    setSegments([])
    setSelectedUid(null)
    stopRef.current = true
    previewStopRef.current = true
    setPreviewing(false)
    setPreviewIndex(0)
    setPreviewError("")
    setBulkRunning(false)
    setBulkProgressText("")
    setComposeError("")
    localStorage.removeItem("tts_workspace_segments")
  }

  async function startPreview(startAt = previewIndex) {
    if (previewing) return
    if (!previewItems.length) {
      setPreviewError("暂无可预览的已生成音频")
      return
    }
    const startIndex = Math.max(0, Math.min(previewItems.length - 1, startAt))
    const runId = previewRunIdRef.current + 1
    previewRunIdRef.current = runId
    previewStopRef.current = false
    setPreviewError("")
    setPreviewing(true)
    setPreviewIndex(startIndex)

    const playAt = async (idx: number): Promise<void> => {
      if (previewStopRef.current || previewRunIdRef.current !== runId) return
      const item = previewItems[idx]
      if (!item) {
        setPreviewing(false)
        return
      }
      setPreviewIndex(idx)

      if (item.kind === "silence") {
        await delay(Math.max(0, item.durationMs))
        return playAt(idx + 1)
      }

      const audio = audioRef.current
      if (!audio) return
      audio.pause()
      audio.src = item.url
      audio.currentTime = 0

      try {
        await audio.play()
      } catch (err) {
        if (previewStopRef.current || previewRunIdRef.current !== runId) return
        setPreviewError(err instanceof Error ? err.message : "预览播放失败")
        setPreviewing(false)
        return
      }

      await new Promise<void>((resolve) => {
        const onEnd = () => {
          audio.removeEventListener("ended", onEnd)
          audio.removeEventListener("error", onError)
          resolve()
        }
        const onError = () => {
          audio.removeEventListener("ended", onEnd)
          audio.removeEventListener("error", onError)
          resolve()
        }
        audio.addEventListener("ended", onEnd)
        audio.addEventListener("error", onError)
      })

      return playAt(idx + 1)
    }

    playAt(startIndex).catch((err) => {
      if (previewStopRef.current || previewRunIdRef.current !== runId) return
      setPreviewError(err instanceof Error ? err.message : "预览失败")
      setPreviewing(false)
    })
  }

  function stopPreview() {
    previewRunIdRef.current += 1
    previewStopRef.current = true
    setPreviewing(false)
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.currentTime = 0
    }
  }

  function seekPreview(index: number) {
    const nextIndex = Math.max(0, Math.min(Math.max(0, previewItems.length - 1), index))
    setPreviewIndex(nextIndex)
    if (!previewing) return
    stopPreview()
    window.setTimeout(() => {
      void startPreview(nextIndex)
    }, 0)
  }

  function clearAudio(segUid: string) {
    setSegments((prev) =>
      prev.map((item) =>
        item.type === "tts" && (item.uid === segUid || item.repeatOfUid === segUid)
          ? { ...item, audioId: undefined, audioUrl: undefined, status: "idle", error: "" }
          : item
      )
    )
  }

  function speedForPace(paceId?: PacePresetId, multiplier = speedMultiplier) {
    const base = paces.find((item) => item.id === paceId)?.speed || pace.speed
    return Math.max(0.5, Math.min(2, base * multiplier))
  }

  function accentDirectorNote() {
    return `English accent standard: ${accentOption.label}. ${accentOption.instruction}`
  }

  function preferredVoiceForAccent(role?: string) {
    const voices = providerConfig?.voices || []
    const preferredLocale = accentOption.locale
    if (preferredLocale === "en") return undefined
    const roleMatch = role === "question" ? "question" : role === "male" || role === "female" ? "dialogue" : "narrator"
    return (
      voices.find((voice) => voice.locale === preferredLocale && voice.role === roleMatch) ||
      voices.find((voice) => voice.locale === preferredLocale && (role === "male" || role === "female" ? voice.gender === role : true)) ||
      voices.find((voice) => voice.locale === preferredLocale)
    )
  }

  function geminiVoiceByGender(gender: "male" | "female") {
    const voices = providerConfig?.voices || []
    return (
      voices.find((voice) => voice.gender === gender && voice.role === "dialogue") ||
      voices.find((voice) => voice.gender === gender) ||
      voices.find((voice) => voice.id === (gender === "male" ? "Puck" : "Kore"))
    )
  }

  function isGeminiVoiceGender(voiceIdValue: string, gender: "male" | "female") {
    return providerConfig?.voices.some((voice) => voice.id === voiceIdValue && voice.gender === gender) || false
  }

  function safeGeminiDialogueVoice(gender: "male" | "female", preferred: string) {
    if (isGeminiVoiceGender(preferred, gender)) return preferred
    return geminiVoiceByGender(gender)?.id || preferred || ""
  }

  function geminiDialogueVoiceForGroup(gender: "male" | "female", groupId: string, transcript: string) {
    const voices = (providerConfig?.voices || []).filter((voice) => voice.gender === gender && (voice.role === "dialogue" || voice.role === "general"))
    if (!voices.length) return safeGeminiDialogueVoice(gender, gender === "male" ? geminiMaleVoiceId : geminiFemaleVoiceId)
    const key = `${groupId}\n${transcript}\n${gender}`
    return voices[stableHash(key) % voices.length].id
  }

  function reorder(fromUid: string, toUid: string) {
    setSegments((prev) => {
      const from = prev.findIndex((item) => item.uid === fromUid)
      const to = prev.findIndex((item) => item.uid === toUid)
      if (from < 0 || to < 0 || from === to) return prev
      const copy = [...prev]
      const [item] = copy.splice(from, 1)
      copy.splice(to, 0, item)
      return copy
    })
  }

  function addTts() {
    const segment = defaultTtsSegment({ voiceId: voiceForRole("narrator"), modelId, stylePresetId: "", stylePrompt: "", pacePreset, speed: calibratedSpeed })
    setSegments((prev) => insertAfterSelection(prev, segment))
    setSelectedUid(segment.uid)
  }

  function addSilence() {
    const segment: Segment = { uid: uid(), type: "silence", durationMs: 1000, role: "neutral" }
    setSegments((prev) => insertAfterSelection(prev, segment))
    setSelectedUid(segment.uid)
  }

  function insertAfterSelection(input: Segment[], segment: Segment) {
    if (!selectedUid) return [...input, segment]
    const selected = input.find((item) => item.uid === selectedUid)
    if (!selected) return [...input, segment]
    const selectedGroupId = selected.type === "tts" || selected.type === "silence" ? selected.groupId : undefined
    let insertAt = input.findIndex((item) => item.uid === selectedUid)
    if (selectedGroupId) {
      const lastInGroup = input.reduce((last, item, index) => {
        const groupId = item.type === "tts" || item.type === "silence" ? item.groupId : undefined
        return groupId === selectedGroupId ? index : last
      }, insertAt)
      insertAt = lastInGroup
    }
    const copy = [...input]
    copy.splice(insertAt + 1, 0, segment)
    return copy
  }

  function repeatEnabledForGroup(groupId?: string) {
    if (!groupId) return false
    return segments.some((item) => item.type === "tts" && item.groupId === groupId && (Boolean(item.repeatOfUid) || isSecondPassSegment(item)))
  }

  function canRepeatSelectedGroup(segment: Segment | null) {
    if (!segment || segment.type !== "tts" || !segment.groupId || isQuestionRole(segment)) return false
    const firstPass = segments.filter((item): item is TtsSegment => item.type === "tts" && item.groupId === segment.groupId && !isQuestionRole(item) && !item.repeatOfUid && !isSecondPassSegment(item))
    return firstPass.length > 0
  }

  function toggleRepeatForSegment(segUid: string) {
    const selected = segments.find((item) => item.uid === segUid)
    if (!selected || selected.type !== "tts" || !selected.groupId) return
    const groupId = selected.groupId
    const enabled = repeatEnabledForGroup(groupId)
    setSegments((prev) => {
      if (enabled) {
        return prev.filter((item) => {
          if (item.type === "silence" && item.groupId === groupId && item.label === "重读间隔") return false
          if (item.type === "tts" && item.groupId === groupId && (item.repeatOfUid || isSecondPassSegment(item))) return false
          return true
        })
      }
      const firstPass = prev.filter((item): item is TtsSegment => item.type === "tts" && item.groupId === groupId && !isQuestionRole(item) && !item.repeatOfUid && !isSecondPassSegment(item))
      if (!firstPass.length) return prev
      const lastInGroup = prev.reduce((last, item, index) => {
        const itemGroupId = item.type === "tts" || item.type === "silence" ? item.groupId : undefined
        return itemGroupId === groupId ? index : last
      }, -1)
      const repeats: Segment[] = [
        { uid: uid(), type: "silence", durationMs: 1200, label: "重读间隔", role: "neutral", groupId },
        ...firstPass.map((item) => ({
          ...item,
          uid: uid(),
          repeatOfUid: item.uid,
          audioId: undefined,
          audioUrl: undefined,
          status: "idle" as const,
          error: "",
          directorNote: item.directorNote?.replace(/第1遍/g, "第2遍") || "第2遍；复用第1遍音频。"
        }))
      ]
      const copy = [...prev]
      copy.splice(lastInGroup + 1, 0, ...repeats)
      return copy
    })
  }

  function voiceForRole(role?: string) {
    const voices = providerConfig?.voices || []
    const byAccent = preferredVoiceForAccent(role)
    const byGender = role === "male" ? voices.find((voice) => voice.gender === "male") : role === "female" ? voices.find((voice) => voice.gender === "female") : undefined
    const byRole = voices.find((voice) => voice.role === (role === "question" ? "question" : role === "male" || role === "female" ? "dialogue" : "narrator"))
    return byAccent?.id || byGender?.id || byRole?.id || voiceId || providerConfig?.defaultVoiceId || ""
  }

  async function requestSegmentTts(seg: TtsSegment, text = seg.text) {
    const allowedModels = providerConfig?.models || []
    const modelToUse = seg.modelId && allowedModels.some((m) => m.id === seg.modelId) ? seg.modelId : modelId
    const maxAttempts = provider === "dashscope" ? 3 : provider === "google_gemini" ? 2 : 1
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        provider,
        credentials,
        baseUrl,
        model: modelToUse,
        languageType: provider === "dashscope" ? languageType : accentOption.locale === "en" ? undefined : accentOption.locale,
        text,
        voice: seg.voiceId || voiceForRole(seg.role) || voiceId,
        stylePresetId: seg.stylePresetId || stylePresetId,
        stylePrompt: seg.stylePrompt || stylePrompt,
        directorNote: [accentDirectorNote(), languageRateDirective(text, template), seg.directorNote].filter(Boolean).join("\n"),
        speed: targetSpeedForText(text, template),
        pitch: seg.pitch || 1,
        volume: seg.volume || 1
      })
      })
      const rawText = await res.text()
      const json = (() => {
        try {
          return JSON.parse(rawText) as { id?: string; url?: string; error?: string }
        } catch {
          return { error: rawText }
        }
      })()
      const message = json.error || rawText || "生成失败"
      if (res.ok) {
        if (!json.id || !json.url) throw new Error("生成返回缺少音频信息")
        return json
      }
      if (attempt < maxAttempts && (res.status === 429 || isRetryableTtsError(message))) {
        const waitMs = provider === "dashscope" ? 3500 * attempt : 1800 * attempt
        setBulkProgressText(`服务商繁忙，${Math.round(waitMs / 1000)} 秒后自动重试 ${attempt}/${maxAttempts - 1}`)
        await delay(waitMs)
        continue
      }
      throw new Error(message)
    }
    throw new Error("生成失败")
  }

  async function postTtsJson(path: string, body: Record<string, unknown>, fallbackError: string) {
    const maxAttempts = provider === "dashscope" ? 3 : provider === "google_gemini" ? 2 : 1
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      })
      const rawText = await res.text()
      const json = (() => {
        try {
          return JSON.parse(rawText) as { id?: string; url?: string; error?: string }
        } catch {
          return { error: rawText }
        }
      })()
      const message = json.error || rawText || fallbackError
      if (res.ok) {
        if (!json.id || !json.url) throw new Error("生成返回缺少音频信息")
        return json
      }
      if (attempt < maxAttempts && (res.status === 429 || isRetryableTtsError(message))) {
        const waitMs = provider === "dashscope" ? 3500 * attempt : 1800 * attempt
        setBulkProgressText(`服务商繁忙，${Math.round(waitMs / 1000)} 秒后自动重试 ${attempt}/${maxAttempts - 1}`)
        await delay(waitMs)
        continue
      }
      throw new Error(message)
    }
    throw new Error(fallbackError)
  }

  function normalizeDirectorSegment(item: DirectorSegment): Segment {
    if (item.type === "music") return { uid: uid(), type: "music", presetId: item.presetId || template.introMusicPreset, durationMs: item.durationMs || 3500, label: item.label || "导入音乐", role: "music" }
    if (item.type === "silence") return { uid: uid(), type: "silence", durationMs: item.durationMs || 1000, label: item.label, role: item.role, groupId: item.groupId }
    const nextPace = item.pacePreset || pacePreset
    const nextSpeed = targetSpeedForText(item.text, template)
    return {
      uid: uid(),
      type: "tts",
      text: item.text,
      label: item.label,
      voiceId: voiceForRole(item.role),
      modelId,
      stylePresetId: item.stylePresetId || "",
      stylePrompt: "",
      role: item.role,
      groupId: item.groupId,
      directorNote: item.directorNote,
      emotion: item.emotion,
      pacePreset: nextPace,
      speed: nextSpeed,
      pitch: 1,
      volume: 1,
      status: "idle"
    }
  }

  async function analyzeScript(text: string, mode: ApplyMode) {
    setAnalyzing(true)
    setComposeError("")
    try {
      const res = await fetch("/api/script/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, template })
      })
      const rawText = await res.text()
      const json = (() => {
        try {
          return JSON.parse(rawText) as { segments?: DirectorSegment[]; error?: string; detail?: string }
        } catch {
          return null
        }
      })()
      if (!res.ok) {
        const message = json?.error || json?.detail || rawText || `HTTP ${res.status}`
        throw new Error(message)
      }
      if (!json?.segments) throw new Error(json?.error || "脚本导演分析失败")
      const mapped = linkRepeatedAudioSegments(json.segments.map(normalizeDirectorSegment))
      setSegments((prev) => (mode === "replace" ? mapped : [...prev, ...mapped]))
      if (mapped[0]) setSelectedUid(mapped[0].uid)
    } catch (err) {
      setComposeError(err instanceof Error ? `脚本导演分析失败：${err.message}` : "脚本导演分析失败")
    } finally {
      setAnalyzing(false)
    }
  }

  function groupSegments(groupId: string) {
    return segments.filter((item): item is TtsSegment => isTtsSegment(item) && item.groupId === groupId)
  }

  function isQuestionRole(segment: TtsSegment) {
    return segment.role === "question" || segment.stylePresetId === "question_marker"
  }

  function toDialogueSpeaker(segment: TtsSegment): "M" | "W" | "" {
    if (segment.role === "male") return "M"
    if (segment.role === "female") return "W"
    const label = (segment.label || "").trim().toUpperCase()
    if (label === "M" || label === "A" || label === "MALE" || label === "MAN") return "M"
    if (label === "W" || label === "B" || label === "FEMALE" || label === "WOMAN") return "W"
    return ""
  }

  function pickGroupContainer(list: TtsSegment[], pass: "first" | "second") {
    const candidates = list.filter((s) => !isQuestionRole(s) && Boolean(s.text.trim()))
    const fallback = list.filter((s) => Boolean(s.text.trim()))
    const pool = candidates.length ? candidates : fallback
    if (!pool.length) return null
    if (pass === "first") {
      return pool.find((s) => !s.repeatOfUid) || pool[0]
    }
    return pool.find((s) => s.repeatOfUid || isSecondPassSegment(s)) || pool[0]
  }

  async function generateGeminiGroup(groupId: string) {
    const list = groupSegments(groupId)
    const firstPass = list.filter((s) => !isSecondPassSegment(s) && !s.repeatOfUid)
    const secondPass = list.filter((s) => Boolean(s.repeatOfUid) || isSecondPassSegment(s))
    const container = pickGroupContainer(firstPass, "first")
    if (!container) return false

    const contentSegments = firstPass.filter((s) => !isQuestionRole(s) && Boolean(s.text.trim()))
    const questionSegments = firstPass.filter((s) => isQuestionRole(s) && Boolean(s.text.trim()))
    const overrideText = cleanExamAudioText(geminiOverrideText(container.providerOverrides))
    const hasDialogue =
      (overrideText ? /^(?:\s*(?:M|W|A|B)\s*:)/im.test(overrideText) : false) ||
      contentSegments.some((s) => s.role === "male" || s.role === "female" || Boolean(toDialogueSpeaker(s)))

    updateSegment(container.uid, { status: "generating", error: "" })

    try {
      if (!credentialsComplete(providerConfig, credentials)) {
        updateSegment(container.uid, { status: "error", error: "请先在设置中完整填写当前服务商密钥" })
        setSettingsOpen(true)
        return false
      }

      if (!contentSegments.length && questionSegments.length) {
        const question = questionSegments[0]
        const combinedText = question.text.trim()
        const json = await postTtsJson("/api/tts", {
            provider,
            credentials,
            baseUrl,
            model: modelId,
            languageType: provider === "dashscope" ? languageType : accentOption.locale === "en" ? undefined : accentOption.locale,
            text: combinedText,
            voice: question.voiceId || container.voiceId || voiceId,
            stylePresetId: question.stylePresetId || container.stylePresetId || stylePresetId,
            stylePrompt: question.stylePrompt || container.stylePrompt || stylePrompt,
            directorNote: [accentDirectorNote(), languageRateDirective(combinedText, template), question.directorNote].filter(Boolean).join("\n"),
            speed: targetSpeedForText(combinedText, template),
            pitch: question.pitch || 1,
            volume: question.volume || 1
          }, "生成失败")

        setSegments((prev) => {
          const containerUid = container.uid
          return prev.map((item) => (item.type === "tts" && item.uid === containerUid ? { ...item, text: combinedText, audioId: json.id, audioUrl: json.url, status: "done", error: "" } : item))
        })
        return true
      }

      if (hasDialogue) {
        const promptLines = cleanExamAudioText(overrideText || contentSegments
          .map((s) => {
            const speaker = toDialogueSpeaker(s) === "W" ? "Female" : "Male"
            return `${speaker}: ${stripLeadingSpeakerTag(s.text.trim())}`
          })
          .join("\n"))
        const normalizedPromptLines = normalizeGeminiDialogueText(promptLines)
        if (!normalizedPromptLines) throw new Error("当前小题没有可生成的对话正文，请检查是否只粘贴了题目或选项。")
        const prompt = [
          `TTS only the transcript for current group ${groupId}.`,
          "Keep this group isolated. Do not infer, continue, summarize, or borrow text from any previous or next question.",
          "Every transcript line is explicitly prefixed with Male: or Female:. Use those labels as the only source of speaker gender.",
          "Male lines must use the configured Male speaker voice. Female lines must use the configured Female speaker voice. Never swap voices between adjacent turns.",
          "Context matters only within the transcript below, but context must never override the explicit Male/Female prefix.",
          "Do not translate; keep Chinese in Chinese and English in English.",
          "Do not speak question stems, choices, answer keys, section labels, or any text that is not in the transcript below.",
          "",
          normalizedPromptLines
        ].join("\n")
        const maleVoice = geminiDialogueVoiceForGroup("male", groupId, normalizedPromptLines)
        const femaleVoice = geminiDialogueVoiceForGroup("female", groupId, normalizedPromptLines)

        const json = await postTtsJson("/api/gemini/tts/dialogue", {
            credentials,
            baseUrl,
            model: modelId,
            speed: targetSpeedForText(normalizedPromptLines, template),
            prompt,
            speakers: [
              { speaker: "Male", voiceName: maleVoice },
              { speaker: "Female", voiceName: femaleVoice }
            ]
          }, "Gemini 对话生成失败")

        const combinedText = normalizedPromptLines

        setSegments((prev) => {
          const containerUid = container.uid
          const secondContainer = pickGroupContainer(secondPass, "second")
          return prev.map((item) => {
            if (!isTtsSegment(item)) return item
            if (item.uid === containerUid) {
              return { ...item, providerOverrides: { ...(item.providerOverrides || {}), generatedGroupText: combinedText }, audioId: json.id, audioUrl: json.url, status: "done", error: "" }
            }
            if (item.repeatOfUid === containerUid) {
              return { ...item, status: "done", error: "" }
            }
            if (item.groupId !== groupId) return item
            if (isQuestionRole(item)) return item
            if (secondContainer && item.uid === secondContainer.uid) {
              return { ...item, repeatOfUid: containerUid, audioId: "", audioUrl: "", status: "done", error: "" }
            }
            return { ...item, status: "skipped", error: "" }
          })
        })
        return true
      }

      const combinedText = cleanExamAudioText(overrideText || contentSegments.map((s) => s.text.trim()).join("\n\n"))
      if (!combinedText) throw new Error("当前小题没有可生成的正文，请检查是否只粘贴了题目或选项。")
      const json = await postTtsJson("/api/tts", {
          provider,
          credentials,
          baseUrl,
          model: modelId,
          languageType: provider === "dashscope" ? languageType : accentOption.locale === "en" ? undefined : accentOption.locale,
          text: combinedText,
          voice: container.voiceId || voiceId,
          stylePresetId: container.stylePresetId || stylePresetId,
          stylePrompt: container.stylePrompt || stylePrompt,
          directorNote: [accentDirectorNote(), languageRateDirective(combinedText, template), container.directorNote].filter(Boolean).join("\n"),
          speed: targetSpeedForText(combinedText, template),
          pitch: container.pitch || 1,
          volume: container.volume || 1
        }, "生成失败")

      setSegments((prev) => {
        const containerUid = container.uid
        const secondContainer = pickGroupContainer(secondPass, "second")
        return prev.map((item) => {
            if (!isTtsSegment(item)) return item
            if (item.uid === containerUid) {
            return { ...item, providerOverrides: { ...(item.providerOverrides || {}), generatedGroupText: combinedText }, audioId: json.id, audioUrl: json.url, status: "done", error: "" }
          }
          if (item.repeatOfUid === containerUid) {
            return { ...item, status: "done", error: "" }
          }
          if (item.groupId !== groupId) return item
          if (isQuestionRole(item)) return item
          if (secondContainer && item.uid === secondContainer.uid) {
            return { ...item, repeatOfUid: containerUid, audioId: "", audioUrl: "", status: "done", error: "" }
          }
          return { ...item, status: "skipped", error: "" }
        })
      })
      return true
    } catch (err) {
      updateSegment(container.uid, { status: "error", error: err instanceof Error ? err.message : "生成失败" })
      return false
    }
  }

  async function generateUnifiedGroup(groupId: string) {
    const list = groupSegments(groupId)
    const firstPass = list.filter((s) => !isSecondPassSegment(s) && !s.repeatOfUid)
    const container = pickGroupContainer(firstPass, "first") || firstPass[0]
    if (!container) return false

    const targets = firstPass.filter((s) => Boolean(s.text.trim()))

    updateSegment(container.uid, { status: "generating", error: "" })

    try {
      if (!containsPhonicsToken(container.text) && !credentialsComplete(providerConfig, credentials)) {
        updateSegment(container.uid, { status: "error", error: "请先在设置中完整填写当前服务商密钥" })
        setSettingsOpen(true)
        return false
      }

      if (!targets.length) {
        throw new Error("当前题组没有可生成的正文，请检查是否只粘贴了题目或选项。")
      }

      for (const item of targets) {
        updateSegment(item.uid, { status: "generating", error: "" })
        const json = await requestSegmentTts(item)
        setSegments((prev) => prev.map((segment) => {
          if (segment.type !== "tts") return segment
          if (segment.uid === item.uid || segment.repeatOfUid === item.uid) return { ...segment, audioId: json.id, audioUrl: json.url, status: "done", error: "" }
          return segment
        }))
        if (provider === "dashscope" && targets.length > 1) await delay(1200)
      }

      setSegments((prev) =>
        prev.map((item) => {
          if (item.type !== "tts" || item.groupId !== groupId) return item
          if (targets.some((target) => target.uid === item.uid)) return item
          if (item.repeatOfUid) return item
          return item.status === "generating" ? { ...item, status: "idle" } : item
        })
      )
      return true
    } catch (err) {
      updateSegment(container.uid, { status: "error", error: err instanceof Error ? err.message : "生成失败" })
      return false
    }
  }

  async function generateGroup(groupId: string) {
    if (provider === "google_gemini") return generateGeminiGroup(groupId)
    return generateUnifiedGroup(groupId)
  }

  async function generateSegmentAudio(segUid: string) {
    const seg = segments.find((item) => item.uid === segUid)
    if ((!seg || seg.type !== "tts") && groupSegments(segUid).length) {
      return generateGroup(segUid)
    }
    if (!seg || seg.type !== "tts") return false
    if (seg.repeatOfUid) {
      const source = segments.find((item): item is TtsSegment => isTtsSegment(item) && item.uid === seg.repeatOfUid)
      if (source?.audioId && source.audioUrl) {
        updateSegment(seg.uid, { audioId: source.audioId, audioUrl: source.audioUrl, status: "done", error: "" })
        return true
      }
      updateSegment(seg.uid, { status: "error", error: "复用片段需要先生成第 1 遍音频" })
      return false
    }
    if (!seg.text.trim()) {
      updateSegment(segUid, { status: "error", error: "文本不能为空" })
      return false
    }
    if (seg.groupId && !isQuestionRole(seg)) {
      return generateGroup(seg.groupId)
    }
    if (!containsPhonicsToken(seg.text) && !credentialsComplete(providerConfig, credentials)) {
      updateSegment(segUid, { status: "error", error: "请先在设置中完整填写当前服务商密钥" })
      setSettingsOpen(true)
      return false
    }

    updateSegment(segUid, { status: "generating", error: "" })

    try {
      const allowedModels = providerConfig?.models || []
      const modelToUse = seg.modelId && allowedModels.some((m) => m.id === seg.modelId) ? seg.modelId : modelId
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          credentials,
          baseUrl,
          model: modelToUse,
          languageType: provider === "dashscope" ? languageType : accentOption.locale === "en" ? undefined : accentOption.locale,
          text: seg.text,
          voice: seg.voiceId || voiceId,
          stylePresetId: seg.stylePresetId || stylePresetId,
          stylePrompt: seg.stylePrompt || stylePrompt,
          directorNote: [accentDirectorNote(), languageRateDirective(seg.text, template), seg.directorNote].filter(Boolean).join("\n"),
          speed: targetSpeedForText(seg.text, template),
          pitch: seg.pitch || 1,
          volume: seg.volume || 1
        })
      })
      const rawText = await res.text()
      const json = (() => {
        try {
          return JSON.parse(rawText) as { id?: string; url?: string; error?: string }
        } catch {
          return { error: rawText }
        }
      })()
      if (!res.ok) throw new Error(json.error || "生成失败")
      setSegments((prev) =>
        prev.map((item) =>
          item.type === "tts" && (item.uid === segUid || item.repeatOfUid === segUid)
            ? { ...item, audioId: json.id, audioUrl: json.url, status: "done", error: "" }
            : item
        )
      )
      return true
    } catch (err) {
      updateSegment(segUid, { status: "error", error: err instanceof Error ? err.message : "生成失败" })
      return false
    }
  }

  async function runQueue(queue: string[]) {
    if (bulkRunning) return
    if (!queue.length) {
      setBulkProgressText("没有需要生成的片段")
      return
    }
    stopRef.current = false
    setBulkRunning(true)
    setSegments((prev) =>
      prev.map((item) => {
        if (item.type !== "tts") return item
        const hit =
          queue.includes(item.uid) ||
          (item.groupId && queue.includes(item.groupId))
        return hit ? { ...item, status: "queued" } : item
      })
    )

    let done = 0
    let failed = 0
    for (const item of queue) {
      if (stopRef.current) {
        setSegments((prev) => prev.map((segment) => (segment.type === "tts" && segment.status === "queued" ? { ...segment, status: "skipped" } : segment)))
        break
      }
      const ok = await generateSegmentAudio(item)
      done++
      if (!ok) failed++
      setBulkProgressText(`${done}/${queue.length}${failed ? ` · 失败 ${failed}` : ""}`)
      if (!stopRef.current && provider === "dashscope") await delay(1200)
    }
    setBulkRunning(false)
    setBulkProgressText(`${done}/${queue.length}${failed ? ` · 失败 ${failed}` : " · 完成"}`)
  }

  function generateAll() {
    const groupIds = Array.from(
      new Set(
        segments
          .filter((item): item is TtsSegment => isTtsSegment(item) && Boolean(item.groupId) && !item.audioId && !item.repeatOfUid && Boolean(item.text.trim()))
          .map((item) => item.groupId as string)
      )
    )
    const orphan = segments.filter((item) => item.type === "tts" && !item.groupId && !item.audioId && !item.repeatOfUid).map((item) => item.uid)
    void runQueue([...groupIds, ...orphan])
  }

  function generateSelected() {
    if (selectedSegment?.type !== "tts") return
    if (selectedSegment.groupId && !isQuestionRole(selectedSegment)) {
      void runQueue([selectedSegment.groupId])
      return
    }
    void runQueue([selectedSegment.repeatOfUid || selectedSegment.uid])
  }

  function retryFailed() {
    const groupIds = Array.from(
      new Set(
        segments
          .filter((item): item is TtsSegment => isTtsSegment(item) && Boolean(item.groupId) && item.status === "error" && !item.repeatOfUid)
          .map((item) => item.groupId as string)
      )
    )
    const orphan = segments.filter((item) => item.type === "tts" && item.status === "error" && !item.repeatOfUid && !item.groupId).map((item) => item.uid)
    void runQueue([...groupIds, ...orphan])
  }

  function stopGenerateAll() {
    stopRef.current = true
    setBulkRunning(false)
  }

  function startResizePastePane(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = pastePaneWidth
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.round(startWidth + moveEvent.clientX - startX)
      setPastePaneWidth(Math.max(360, Math.min(760, next)))
    }
    const onUp = () => {
      document.body.style.userSelect = ""
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
    document.body.style.userSelect = "none"
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp, { once: true })
  }

  async function generateSpeedSample(_multiplier: number, sampleText: string) {
    if (!credentialsComplete(providerConfig, credentials)) {
      setSpeedSampleState("error")
      setSpeedSampleError("请先在设置中完整填写当前服务商密钥")
      return
    }
    setSpeedSampleState("generating")
    setSpeedSampleError("")
    setSpeedSampleUrl("")
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          credentials,
          baseUrl,
          model: modelId,
          languageType: provider === "dashscope" ? languageType : accentOption.locale === "en" ? undefined : accentOption.locale,
          text: sampleText,
          voice: voiceId,
          stylePresetId: "exam_host",
          stylePrompt,
          directorNote: `${accentDirectorNote()}\nSpeed calibration sample for Chinese middle school or Gaokao English listening. Keep the voice stable and exam-like.`,
          speed: targetSpeedForText(sampleText, template),
          pitch: 1,
          volume: 1
        })
      })
      const rawText = await res.text()
      const json = (() => {
        try {
          return JSON.parse(rawText) as { id?: string; url?: string; error?: string }
        } catch {
          return { error: rawText }
        }
      })()
      if (!res.ok || !json.url) throw new Error(json.error || "示例音频生成失败")
      setSpeedSampleUrl(json.url)
      setSpeedSampleState("done")
    } catch (err) {
      setSpeedSampleState("error")
      setSpeedSampleError(err instanceof Error ? err.message : "示例音频生成失败")
    }
  }

  function applySpeedCalibration(multiplier: number) {
    const next = clampSpeedMultiplier(multiplier)
    setSpeedMultiplier(next)
    setSegments((prev) =>
      prev.map((item) => {
        if (item.type !== "tts") return item
        return {
          ...item,
          speed: speedForPace(item.pacePreset || pacePreset, next),
          audioId: undefined,
          audioUrl: undefined,
          status: item.text.trim() ? ("idle" as const) : item.status,
          error: item.audioId ? "语速已更新，请重新生成该片段" : item.error
        }
      })
    )
  }

  function applyTargetSpeakingRates(englishWordsPerMinute: number, chineseCharsPerMinute: number) {
    const nextEnglish = Math.max(80, Math.min(180, Math.round(englishWordsPerMinute)))
    const nextChinese = Math.max(140, Math.min(320, Math.round(chineseCharsPerMinute)))
    setTemplate((prev) => ({ ...prev, englishWordsPerMinute: nextEnglish, chineseCharsPerMinute: nextChinese }))
    setSegments((prev) =>
      prev.map((item) => {
        if (item.type !== "tts") return item
        return {
          ...item,
          speed: targetSpeedForText(item.text, { ...template, englishWordsPerMinute: nextEnglish, chineseCharsPerMinute: nextChinese }),
          audioId: undefined,
          audioUrl: undefined,
          status: item.text.trim() ? ("idle" as const) : item.status,
          error: item.audioId ? "目标语速已更新，请重新生成该片段" : item.error
        }
      })
    )
  }

  function applyEnglishAccent(nextAccent: EnglishAccentId) {
    setEnglishAccent(nextAccent)
    const option = englishAccentOptions.find((item) => item.id === nextAccent) || englishAccentOptions[0]
    if (providerConfig?.id !== "dashscope" && option.locale !== "en") {
      setLanguageType(option.locale)
    }
    const nextVoice = (() => {
      const voices = providerConfig?.voices || []
      if (option.locale === "en") return ""
      return voices.find((voice) => voice.locale === option.locale && voice.role === "narrator")?.id || voices.find((voice) => voice.locale === option.locale)?.id || ""
    })()
    if (nextVoice) setVoiceId(nextVoice)
    setSegments((prev) =>
      prev.map((item) => {
        if (item.type !== "tts") return item
        const roleVoice = nextVoice || voiceForRole(item.role)
        return {
          ...item,
          voiceId: roleVoice || item.voiceId,
          audioId: undefined,
          audioUrl: undefined,
          status: item.text.trim() ? ("idle" as const) : item.status,
          error: item.audioId ? "发音标准已更新，请重新生成该片段" : item.error
        }
      })
    )
  }

  function applyBreakDurations(majorBreakMs: number, minorBreakMs: number, questionNumberGapMs: number) {
    const nextMajor = Math.max(0, Math.round(majorBreakMs))
    const nextMinor = Math.max(0, Math.round(minorBreakMs))
    const nextQuestionGap = Math.max(0, Math.round(questionNumberGapMs))
    setTemplate((prev) => ({ ...prev, majorBreakMs: nextMajor, minorBreakMs: nextMinor, questionNumberGapMs: nextQuestionGap }))
    setSegments((prev) =>
      prev.map((item) => {
        if (item.type !== "silence") return item
        if (item.label === "大题间隔") return { ...item, durationMs: nextMajor }
        if (item.label === "小题间隔") return { ...item, durationMs: nextMinor }
        if (item.label === "题号间隔") return { ...item, durationMs: nextQuestionGap }
        return item
      })
    )
  }

  async function composeAndDownload() {
    setComposeRunning(true)
    setComposeError("")
    try {
      const resolveAudioId = (item: Segment) => {
        if (item.type !== "tts") return ""
        if (item.status === "skipped") return ""
        if (item.audioId) return item.audioId
        if (!item.repeatOfUid) return ""
        const source = segments.find((candidate): candidate is TtsSegment => isTtsSegment(candidate) && candidate.uid === item.repeatOfUid)
        return source?.audioId || ""
      }
      const missing = segments.find((item) => item.type === "tts" && item.status !== "skipped" && !resolveAudioId(item))
      if (missing) throw new Error("存在未生成的 TTS 片段，请先生成或删除")
      const payloadSegments: Array<
        | { type: "tts"; id: string }
        | { type: "silence"; durationMs: number }
        | { type: "music"; presetId?: "warmup" | "bell" | "soft"; durationMs?: number }
      > = []
      for (const item of segments) {
        if (item.type === "silence") {
          payloadSegments.push({ type: "silence", durationMs: item.durationMs })
          continue
        }
        if (item.type === "music") {
          payloadSegments.push({ type: "music", presetId: item.presetId, durationMs: item.durationMs })
          continue
        }
        const id = resolveAudioId(item)
        if (!id) continue
        payloadSegments.push({ type: "tts", id })
      }
      const payload = { segments: payloadSegments, format: exportFormat }
      const res = await fetch("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
      const json = (await res.json()) as { url?: string; error?: string }
      if (!res.ok) throw new Error(json.error || "合成失败")
      if (json.url) window.location.href = json.url
    } catch (err) {
      setComposeError(err instanceof Error ? err.message : "合成失败")
    } finally {
      setComposeRunning(false)
    }
  }

  const stats = useMemo(() => {
    const tts = segments.filter((item) => item.type === "tts")
    const generated = tts.filter((item) => {
      if (item.audioId || item.status === "skipped") return true
      if (!item.repeatOfUid) return false
      return Boolean(segments.find((candidate): candidate is TtsSegment => isTtsSegment(candidate) && candidate.uid === item.repeatOfUid && Boolean(candidate.audioId)))
    }).length
    const errors = tts.filter((item) => item.status === "error").length
    const queued = tts.filter((item) => item.status === "queued" || item.status === "generating").length
    return {
      total: segments.length,
      tts: tts.length,
      generated,
      errors,
      queued,
      silence: segments.filter((item) => item.type === "silence").length,
      totalTime: formatTime(estimateSeconds(segments)),
      progress: tts.length ? Math.round((generated / tts.length) * 100) : 0
    }
  }, [segments])

  return (
    <div className="appRoot">
      <TopBar
        provider={providerConfig}
        bulkRunning={bulkRunning}
        bulkProgressText={bulkProgressText}
        onGenerateAll={generateAll}
        onGenerateSelected={generateSelected}
        onRetryFailed={retryFailed}
        onStopGenerateAll={stopGenerateAll}
        canCompose={
          segments.some((item) => item.type === "tts") &&
          segments.every((item) => {
            if (item.type !== "tts") return true
            if (item.status === "skipped") return true
            if (item.audioId) return true
            if (!item.repeatOfUid) return false
            return Boolean(segments.find((candidate): candidate is TtsSegment => isTtsSegment(candidate) && candidate.uid === item.repeatOfUid && Boolean(candidate.audioId)))
          })
        }
        composeRunning={composeRunning}
        onCompose={composeAndDownload}
        exportFormat={exportFormat}
        onExportFormatChange={setExportFormat}
        onOpenSettings={() => setSettingsOpen(true)}
        stats={stats}
      />

      <main className="workspace" style={{ "--paste-pane-width": `${pastePaneWidth}px` } as CSSProperties}>
        <div className="pastePane">
          <BulkPaste
            analyzing={analyzing}
            majorBreakMs={template.majorBreakMs}
            minorBreakMs={template.minorBreakMs}
            questionNumberGapMs={template.questionNumberGapMs}
            onAnalyze={analyzeScript}
            onApply={(parsed, mode) => {
            const mapped: Segment[] = linkRepeatedAudioSegments(parsed.map((item) => {
              const itemGroupId = "groupId" in item ? item.groupId : undefined
              const itemDirectorNote = "directorNote" in item ? item.directorNote : undefined
              if (item.type === "silence")
                return { uid: uid(), type: "silence", durationMs: item.durationMs, label: item.label, role: "neutral" as const, groupId: itemGroupId }
              // 尝试从 ExamDraftSegment 类型获取 speakerTag
              const examItem = item as ExamDraftSegment
              const speakerTag = "speakerTag" in examItem && typeof examItem.speakerTag === "string" ? examItem.speakerTag : ""
              const isQuestionMarker = speakerTag === "NARRATOR" && /^Number\s+\d+/i.test(item.text.trim())
              const inferred =
                speakerTag === "M" || speakerTag === "A" || item.label === "M" || item.label === "A"
                  ? ({ role: "male" as const, label: speakerTag || item.label || "M" })
                  : speakerTag === "W" || speakerTag === "B" || item.label === "W" || item.label === "B"
                    ? ({ role: "female" as const, label: speakerTag || item.label || "W" })
                    : isQuestionMarker
                      ? ({ role: "question" as const, label: item.label || item.text.trim() })
                    : speakerTag === "NARRATOR"
                      ? ({ role: "narrator" as const, label: item.label || "旁白" })
                      : ({ role: "neutral" as const, label: item.label })
              const nextPace = inferred.role === "question" ? "exam_standard" : pacePreset
              return {
                uid: uid(),
                type: "tts" as const,
                text: item.text,
                label: inferred.label,
                voiceId: voiceForRole(inferred.role),
                modelId,
                stylePresetId: inferred.role === "question" ? "question_marker" : inferred.role === "male" || inferred.role === "female" ? "dialogue" : "",
                stylePrompt: "",
                role: inferred.role,
                groupId: itemGroupId,
                directorNote: itemDirectorNote,
                pacePreset: nextPace,
                speed: targetSpeedForText(item.text, template),
                pitch: 1,
                volume: 1,
                status: "idle" as const
              }
            }))
            setSegments((prev) => (mode === "replace" ? mapped : [...prev, ...mapped]))
            if (mapped[0]) setSelectedUid(mapped[0].uid)
            }}
          />
          <button
            className="resizeHandle"
            type="button"
            aria-label="拖动调整粘贴拆分面板宽度"
            onPointerDown={startResizePastePane}
          />
        </div>

        <SegmentList
          provider={provider}
          segments={segments}
          selectedUid={selectedUid}
          onSelect={setSelectedUid}
          onReorder={reorder}
          onAddTts={addTts}
          onAddSilence={addSilence}
          onClearAll={clearAllSegments}
        />

        <div className="editorStack">
          <SegmentEditor
            provider={provider}
            voiceOptions={providerConfig?.voices || []}
            voiceGender={voiceGender}
            globalVoiceId={voiceId}
            stylePresetId={stylePresetId}
            styleOptions={styles}
            stylePrompt={stylePrompt}
            contextPreview={geminiContextPreview}
            groupSegments={selectedSegment?.type === "tts" && selectedSegment.groupId ? groupSegments(selectedSegment.groupId) : []}
            segment={selectedSegment}
            onUpdate={updateSegment}
            onDelete={deleteSegment}
            onGenerate={generateSegmentAudio}
            onClearAudio={clearAudio}
            repeatControl={{ canUse: canRepeatSelectedGroup(selectedSegment), enabled: selectedSegment?.type === "tts" ? repeatEnabledForGroup(selectedSegment.groupId) : false }}
            onToggleRepeat={toggleRepeatForSegment}
          />

          {composeError ? <div className="toast toastError">{composeError}</div> : null}
        </div>
      </main>

      <footer className="transportBar" aria-label="project transport">
        <div className="transportControls">
          <button className="btnGhost" type="button" onClick={() => void startPreview(previewIndex)} disabled={previewing || !previewItems.length}>
            {previewing ? "预览中…" : "预览"}
          </button>
          <button className="btnGhost" type="button" onClick={stopPreview} disabled={!previewing}>
            停止
          </button>
          <div className="transportStatus">
            <strong>{stats.generated}/{stats.tts}</strong>
            <span>
              {previewError
                ? previewError
                : previewing
                  ? `播放进度 ${previewIndex + 1}/${previewItems.length}`
                  : "已生成音频"}
            </span>
          </div>
        </div>
        <div className="waveRail">
          {Array.from({ length: 42 }).map((_, index) => (
            <span key={index} style={{ height: `${18 + ((index * 7) % 28)}px` }} />
          ))}
          <input
            className="transportSeek"
            type="range"
            min={0}
            max={Math.max(0, previewItems.length - 1)}
            step={1}
            value={Math.min(previewIndex, Math.max(0, previewItems.length - 1))}
            onChange={(event) => seekPreview(Number(event.target.value))}
            disabled={!previewItems.length}
            aria-label="预览播放进度"
          />
        </div>
        <div className="transportMeta transportMetaRight">
          <strong>{stats.totalTime}</strong>
          <span>{stats.total} 段 · {stats.silence} 个停顿</span>
        </div>
      </footer>

      <audio ref={audioRef} style={{ display: "none" }} />

      <SettingsDrawer
        open={settingsOpen}
        providers={providers}
        provider={provider}
        onProviderChange={setProvider}
        credentials={credentials}
        onCredentialsChange={setCredentials}
        modelId={modelId}
        onModelIdChange={setModelId}
        voiceId={voiceId}
        onVoiceIdChange={setVoiceId}
        geminiMaleVoiceId={safeGeminiDialogueVoice("male", geminiMaleVoiceId)}
        onGeminiMaleVoiceIdChange={setGeminiMaleVoiceId}
        geminiFemaleVoiceId={safeGeminiDialogueVoice("female", geminiFemaleVoiceId)}
        onGeminiFemaleVoiceIdChange={setGeminiFemaleVoiceId}
        voiceGender={voiceGender}
        onVoiceGenderChange={setVoiceGender}
        catalogState={catalogState}
        catalogMessage={catalogMessage}
        onRefreshCatalog={refreshProviderCatalog}
        baseUrl={baseUrl}
        onBaseUrlChange={setBaseUrl}
        languageType={languageType}
        onLanguageTypeChange={setLanguageType}
        template={template}
        onTemplateChange={(patch) => setTemplate((prev) => ({ ...prev, ...patch }))}
        onApplyBreakDurations={applyBreakDurations}
        pacePreset={pacePreset}
        onPacePresetChange={(value) => setPacePreset(value as PacePresetId)}
        paceOptions={paces}
        speedMultiplier={speedMultiplier}
        effectiveSpeed={calibratedSpeed}
        englishAccent={englishAccent}
        englishAccentOptions={englishAccentOptions}
        onEnglishAccentChange={applyEnglishAccent}
        speedSampleUrl={speedSampleUrl}
        speedSampleState={speedSampleState}
        speedSampleError={speedSampleError}
        onGenerateSpeedSample={generateSpeedSample}
        onApplySpeedCalibration={applySpeedCalibration}
        onApplyTargetSpeakingRates={applyTargetSpeakingRates}
        stylePrompt={stylePrompt}
        onStylePromptChange={setStylePrompt}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}
