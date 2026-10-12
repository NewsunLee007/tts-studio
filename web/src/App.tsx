import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react"
import "./App.css"
import { BulkPaste } from "./components/BulkPaste"
import { SegmentEditor } from "./components/SegmentEditor"
import { SegmentList } from "./components/SegmentList"
import { SettingsPage } from "./components/SettingsPage"
import { TopBar } from "./components/TopBar"
import { ServiceHub } from "./components/ServiceHub"
import { LocalTtsPage } from "./components/LocalTtsPage"
import "./studio.css"
import { PreviewPlayer } from "./lib/previewPlayer"
import type { ExamDraftSegment } from "./lib/examScriptParser"
import type {
  EnglishAccentId,
  ExamTemplate,
  MusicSegment,
  PacePreset,
  PacePresetId,
  ProviderCatalogResponse,
  ProviderConfig,
  ProviderId,
  ProvidersResponse,
  ScriptAnalysisMeta,
  Segment,
  SegmentPatch,
  TtsGenerationMeta,
  TtsSegment,
  VoiceGender,
  VoicePreset,
  VoiceRoleKey
} from "./types"

type ApplyMode = "append" | "replace"
type DirectorSegment = Segment & { stylePresetId?: string }
type TtsResult = { id?: string; url?: string; error?: string; meta?: TtsGenerationMeta }
type AutoWorkflowStage = "idle" | "analyzing" | "ready" | "generating" | "compose-pending" | "composing" | "done" | "error"

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
  schoolYear: "",
  semester: "",
  examName: "",
  subject: "英语",
  grade: "",
  examType: "",
  includeIntroMusic: false,
  introMusicPreset: "warmup",
  includeExamIntro: false,
  includeQuestionNumbers: true,
  questionNumberStyle: "number",
  majorBreakMs: 10000,
  minorBreakMs: 5000,
  questionNumberGapMs: 1000,
  englishWordsPerMinute: 118,
  chineseCharsPerMinute: 230
}

const MUSIC_PRESET_DURATIONS_MS: Partial<Record<MusicSegment["presetId"], number>> = {
  ding: 1730,
  piano: 13720
}

function musicPresetDurationMs(presetId: MusicSegment["presetId"], fallbackMs = 3500) {
  return MUSIC_PRESET_DURATIONS_MS[presetId] || fallbackMs
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

function safeRemoveItem(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    // 旧版密钥清理失败时不阻断页面
  }
}

function safeGetSessionItem(key: string) {
  try {
    return typeof window === "undefined" ? null : sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSetSessionItem(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    // 临时密钥不可保存时仍保留在当前 React 状态
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

function readStoredSegments() {
  const raw = readJson("tts_workspace_segments")
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Segment => item && typeof item === "object" && "uid" in item && "type" in item)
    .map((item) => {
      if (item.type === "music") {
        return { ...item, durationMs: musicPresetDurationMs(item.presetId, item.durationMs) }
      }
      if (item.type !== "tts") return item
      const status = item.status === "queued" || item.status === "generating" ? "idle" : item.status
      return { ...item, status, error: status === "idle" ? "" : item.error }
    })
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
    if (segment.type === "silence") return total + segment.durationMs / 1000
    if (segment.type === "music") return total + musicPresetDurationMs(segment.presetId, segment.durationMs) / 1000
    const chars = segment.text.trim().replace(/\s+/g, " ").length
    return total + chars / 12 / (segment.speed || 1)
  }, 0)
}

function estimatePreviewItemMs(item: PreviewItem) {
  if (item.kind === "silence") return Math.max(0, item.durationMs)
  if (item.kind === "music") return Math.max(0, musicPresetDurationMs(item.presetId, item.durationMs))
  return Math.max(900, (item.estimatedSeconds || 1) * 1000)
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
  if (provider.serverConfigured) return true
  return provider.credentialFields.every((field) => !field.required || Boolean(credentials[field.key]?.trim()))
}

function migrateLegacyCredentials(providers: Array<Pick<ProviderConfig, "id" | "credentialFields">>) {
  for (const provider of providers) {
    for (const field of provider.credentialFields) {
      const key = providerLocalKey(provider.id, field.key)
      const legacyValue = safeGetItem(key)
      if (legacyValue && !safeGetSessionItem(key)) safeSetSessionItem(key, legacyValue)
      if (legacyValue !== null) safeRemoveItem(key)
    }
  }
}

function migrateKnownLegacyCredentials() {
  const knownFields: Partial<Record<ProviderId, string[]>> = {
    dashscope: ["apiKey"],
    minimax: ["apiKey"],
    google: ["apiKey", "proxyUrl"],
    google_gemini: ["apiKey", "proxyUrl"],
    volcengine: ["appId", "accessToken", "cluster"],
    xfyun: ["appId", "apiKey", "apiSecret"],
    tencent: ["secretId", "secretKey", "appId", "region"],
    openai: ["apiKey"]
  }
  migrateLegacyCredentials(Object.entries(knownFields).map(([id, fields]) => ({
    id: id as ProviderId,
    credentialFields: (fields || []).map((key) => ({ key, label: key, type: "password" as const, required: false }))
  })))
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
    const target = Number.isFinite(template.chineseCharsPerMinute) ? template.chineseCharsPerMinute : 230
    return Math.max(0.5, Math.min(2, target / 250))
  }
  const target = Number.isFinite(template.englishWordsPerMinute) ? template.englishWordsPerMinute : 118
  return Math.max(0.5, Math.min(2, target / 130))
}

function compatibleVoices(provider: ProviderConfig | undefined, model: string) {
  const voices = provider?.voices || []
  if (provider?.id !== "dashscope") return voices
  const cosyVoiceModel = model.startsWith("cosyvoice-")
  return voices.filter((voice) => {
    if (voice.modelIds) return voice.modelIds.includes(model)
    if (model.startsWith("qwen-audio-")) return false
    const cosyVoice = /^loo?ng/i.test(voice.id)
    return cosyVoiceModel ? cosyVoice : !cosyVoice
  })
}

function defaultRoleVoices(provider: ProviderConfig | undefined, model: string): Record<VoiceRoleKey, string> {
  const voices = compatibleVoices(provider, model)
  const fallback = voices.find((voice) => voice.id === provider?.defaultVoiceId)?.id || voices[0]?.id || ""
  const narrator =
    voices.find((voice) => voice.locale === "zh-CN" && voice.role === "narrator") ||
    voices.find((voice) => voice.id === "Neil") ||
    voices.find((voice) => voice.role === "narrator") ||
    voices[0]
  const question =
    voices.find((voice) => voice.role === "question" && voice.locale !== "zh-CN") ||
    voices.find((voice) => voice.id === "Cherry") ||
    voices.find((voice) => voice.gender === "female" && voice.locale !== "zh-CN") ||
    voices[0]
  const male =
    voices.find((voice) => voice.gender === "male" && voice.role === "dialogue") ||
    voices.find((voice) => voice.gender === "male") ||
    voices[0]
  const female =
    voices.find((voice) => voice.gender === "female" && voice.role === "dialogue") ||
    voices.find((voice) => voice.gender === "female") ||
    voices[0]
  return {
    narrator: narrator?.id || fallback,
    question: question?.id || fallback,
    male: male?.id || fallback,
    female: female?.id || fallback
  }
}

function voiceRuleForSegment(segment: TtsSegment): VoiceRoleKey | null {
  if (segment.role === "male" || segment.role === "female") return segment.role
  if (segment.role === "question" || segment.stylePresetId === "question_marker") return "question"
  if (hasChineseText(segment.text) && (segment.role === "narrator" || segment.role === "intro" || segment.role === "neutral")) return "narrator"
  return null
}

function languageRateDirective(text: string, template: ExamTemplate) {
  if (hasChineseText(text)) {
    const cpm = Number.isFinite(template.chineseCharsPerMinute) ? template.chineseCharsPerMinute : 230
    return `Mandarin Chinese delivery target: approximately ${cpm} Chinese characters per minute. Use standard Putonghua, CCTV News anchor style, clear tones, logical phrase grouping, authoritative yet warm.`
  }
  const wpm = Number.isFinite(template.englishWordsPerMinute) ? template.englishWordsPerMinute : 118
  return `English delivery target: approximately ${wpm} words per minute. Use Standard British RP, professional warm exam-listening tone, clear word endings, and distinct punctuation pauses.`
}

function requestLanguageType(text: string, provider: ProviderId, languageType: string, accentLocale: string) {
  if (provider === "dashscope") {
    if (hasChineseText(text)) return "Chinese"
    return languageType === "Auto" ? undefined : languageType
  }
  if (hasChineseText(text)) return "zh-CN"
  return accentLocale === "en" ? undefined : accentLocale
}

type PreviewItem =
  | { kind: "silence"; durationMs: number; label?: string; groupId?: string }
  | { kind: "music"; presetId: MusicSegment["presetId"]; durationMs: number; label?: string; groupId?: string }
  | { kind: "audio"; url: string; label?: string; groupId?: string; role?: string; estimatedSeconds?: number }

export default function App() {
  const [workspaceView, setWorkspaceView] = useState<"script" | "studio" | "export" | "services" | "settings" | "local">(() => window.location.pathname.replace(/\/$/, "") === "/local-tts" ? "local" : "script")
  useEffect(() => {
    const onPopState = () => setWorkspaceView(window.location.pathname.replace(/\/$/, "") === "/local-tts" ? "local" : "services")
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])
  useEffect(() => {
    if (workspaceView === "local" && window.location.pathname !== "/local-tts") window.history.pushState(null, "", "/local-tts")
    if (workspaceView !== "local" && window.location.pathname.replace(/\/$/, "") === "/local-tts") window.history.pushState(null, "", "/")
    document.querySelector(".studioShell")?.scrollTo({ top: 0 })
    window.scrollTo({ top: 0 })
  }, [workspaceView])
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
  const [roleVoiceIds, setRoleVoiceIds] = useState<Record<VoiceRoleKey, string>>({
    narrator: "",
    question: "",
    male: "",
    female: ""
  })
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
  const [previewing, setPreviewing] = useState(false)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [previewItemProgress, setPreviewItemProgress] = useState(0)
  const [previewError, setPreviewError] = useState("")
  const [previewBuffering, setPreviewBuffering] = useState(false)
  const [previewDurations, setPreviewDurations] = useState<Record<number, number>>({})
  const [pastePaneWidth, setPastePaneWidth] = useState(520)
  const [segmentPaneWidth, setSegmentPaneWidth] = useState(430)
  const [exportFormat, setExportFormat] = useState<"mp3" | "wav">(() => (safeGetItem("tts_export_format") === "wav" ? "wav" : "mp3"))
  const [speedSampleUrl, setSpeedSampleUrl] = useState("")
  const [speedSampleState, setSpeedSampleState] = useState<"idle" | "generating" | "done" | "error">("idle")
  const [speedSampleError, setSpeedSampleError] = useState("")
  const [catalogState, setCatalogState] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [catalogMessage, setCatalogMessage] = useState("")

  const [segments, setSegments] = useState<Segment[]>(() => readStoredSegments())
  const [lastExportUrl, setLastExportUrl] = useState("")
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [composeRunning, setComposeRunning] = useState(false)
  const [composeError, setComposeError] = useState("")
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkProgressText, setBulkProgressText] = useState("")
  const [analyzing, setAnalyzing] = useState(false)
  const [autoWorkflow, setAutoWorkflow] = useState<AutoWorkflowStage>("idle")
  const [scriptAssist, setScriptAssist] = useState<ProvidersResponse["scriptAssist"]>()
  const [analysisMessage, setAnalysisMessage] = useState("")
  const [mobileInspectPanel, setMobileInspectPanel] = useState<"list" | "editor">("list")
  const stopRef = useRef(false)
  const previewPlayerRef = useRef<PreviewPlayer | null>(null)
  const providerRef = useRef(provider)

  useEffect(() => {
    migrateKnownLegacyCredentials()
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
        migrateLegacyCredentials(data.providers)
        setProviders(data.providers)
        setStyles(data.styles)
        setPaces(data.paces?.length ? data.paces : fallbackPaces)
        setScriptAssist(data.scriptAssist)
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
  const roleVoiceOptions = useMemo<VoicePreset[]>(() => compatibleVoices(providerConfig, modelId), [providerConfig, modelId])
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

  const previewItems = useMemo<PreviewItem[]>(() => {
    const out: PreviewItem[] = []
    for (const item of segments) {
      if (item.type === "silence") out.push({ kind: "silence", durationMs: item.durationMs, label: item.label, groupId: item.groupId })
      else if (item.type === "music") out.push({ kind: "music", presetId: item.presetId, durationMs: musicPresetDurationMs(item.presetId, item.durationMs), label: item.label })
      else if (item.type === "tts") {
        const source = item.repeatOfUid ? segments.find((candidate): candidate is TtsSegment => isTtsSegment(candidate) && candidate.uid === item.repeatOfUid) : null
        const url = item.audioUrl || source?.audioUrl
        if (url) out.push({ kind: "audio", url, label: item.label, groupId: item.groupId, role: item.role, estimatedSeconds: estimateSeconds([item]) })
      }
    }
    return out
  }, [segments])


  const previewDurationMs = useCallback((item: PreviewItem, index: number) => previewDurations[index] === undefined ? estimatePreviewItemMs(item) : previewDurations[index] * 1000, [previewDurations])
  const totalPreviewMs = useMemo(() => previewItems.reduce((total, item, index) => total + previewDurationMs(item, index), 0), [previewItems, previewDurationMs])
  const previewElapsedMs = useMemo(() => {
    if (!previewItems.length) return 0
    const index = Math.max(0, Math.min(previewIndex, previewItems.length - 1))
    const completed = previewItems.slice(0, index).reduce((total, item, position) => total + previewDurationMs(item, position), 0)
    return Math.min(totalPreviewMs, completed + previewDurationMs(previewItems[index], index) * Math.max(0, Math.min(1, previewItemProgress)))
  }, [previewIndex, previewItemProgress, previewItems, totalPreviewMs, previewDurationMs])

  useEffect(() => {
    if (!providerConfig) return
    const nextCredentials: Record<string, string> = {}
    for (const field of providerConfig.credentialFields) {
      nextCredentials[field.key] = safeGetSessionItem(providerLocalKey(providerConfig.id, field.key)) || ""
    }
    setCredentialsByProvider((prev) => ({ ...prev, [providerConfig.id]: nextCredentials }))
    const prefs = readJson(providerPrefsKey(providerConfig.id))
    const prefObj = prefs && typeof prefs === "object" ? (prefs as Record<string, unknown>) : {}
    const candidateModel = typeof prefObj.modelId === "string" ? prefObj.modelId : ""
    const candidateVoice = typeof prefObj.voiceId === "string" ? prefObj.voiceId : ""
    const candidateRoleVoices =
      prefObj.roleVoiceIds && typeof prefObj.roleVoiceIds === "object"
        ? (prefObj.roleVoiceIds as Partial<Record<VoiceRoleKey, unknown>>)
        : {}
    const candidateBaseUrl = typeof prefObj.baseUrl === "string" ? prefObj.baseUrl : ""
    const candidateLanguage = typeof prefObj.languageType === "string" ? prefObj.languageType : ""
    const candidateVoiceGender =
      prefObj.voiceGender === "male" || prefObj.voiceGender === "female" || prefObj.voiceGender === "neutral" || prefObj.voiceGender === "all"
        ? prefObj.voiceGender
        : ""
    const candidateGeminiMaleVoice = typeof prefObj.geminiMaleVoiceId === "string" ? prefObj.geminiMaleVoiceId : ""
    const candidateGeminiFemaleVoice = typeof prefObj.geminiFemaleVoiceId === "string" ? prefObj.geminiFemaleVoiceId : ""

    const selectedModel = providerConfig.models.some((m) => m.id === candidateModel) ? candidateModel : providerConfig.defaultModelId
    const nextModel = providerConfig.id === "dashscope" && selectedModel === "qwen3-tts-flash" ? providerConfig.defaultModelId : selectedModel
    const nextVoices = compatibleVoices(providerConfig, nextModel)
    const roleDefaults = defaultRoleVoices(providerConfig, nextModel)
    const nextRoleVoices = (Object.keys(roleDefaults) as VoiceRoleKey[]).reduce<Record<VoiceRoleKey, string>>((result, role) => {
      const candidate = candidateRoleVoices[role]
      result[role] = typeof candidate === "string" && nextVoices.some((voice) => voice.id === candidate) ? candidate : roleDefaults[role]
      return result
    }, { ...roleDefaults })
    setModelId(nextModel)
    setVoiceId(nextVoices.some((voice) => voice.id === candidateVoice) ? candidateVoice : nextVoices.find((voice) => voice.id === providerConfig.defaultVoiceId)?.id || nextVoices[0]?.id || "")
    setRoleVoiceIds(nextRoleVoices)
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
    safeSetItem("tts_workspace_segments", JSON.stringify(segments))
  }, [segments])

  useEffect(() => {
    if (!providerConfig || !modelId) return
    safeSetItem(
      providerPrefsKey(provider),
      JSON.stringify({
        modelId,
        voiceId,
        baseUrl,
        languageType,
        voiceGender,
        roleVoiceIds,
        geminiMaleVoiceId: provider === "google_gemini" ? geminiMaleVoiceId : "",
        geminiFemaleVoiceId: provider === "google_gemini" ? geminiFemaleVoiceId : ""
      })
    )
  }, [providerConfig, provider, modelId, voiceId, baseUrl, languageType, voiceGender, roleVoiceIds, geminiMaleVoiceId, geminiFemaleVoiceId])

  function setCredentials(next: Record<string, string>) {
    setCredentialsByProvider((prev) => ({ ...prev, [provider]: next }))
    for (const [key, value] of Object.entries(next)) {
      const storageKey = providerLocalKey(provider, key)
      safeSetSessionItem(storageKey, value)
      safeRemoveItem(storageKey)
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
            return { ...item, audioId: undefined, audioUrl: undefined, generationMeta: undefined, status: "idle", error: "" }
          }
          return item
        }
        const next = { ...item, ...patch } as Segment
        if (item.type === "tts" && "text" in patch && patch.text !== item.text) {
          return { ...next, audioId: undefined, audioUrl: undefined, generationMeta: undefined, status: "idle", error: "" }
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
    previewPlayerRef.current?.stop()
    setPreviewing(false)
    setPreviewIndex(0)
    setPreviewItemProgress(0)
    setPreviewError("")
    setBulkRunning(false)
    setBulkProgressText("")
    setComposeError("")
    localStorage.removeItem("tts_workspace_segments")
  }

  async function startPreview(startAt = previewIndex) {
    if (!previewItems.length) {
      setPreviewError("暂无可预览的已生成音频")
      return
    }
    const startIndex = Math.max(0, Math.min(previewItems.length - 1, startAt))
    setPreviewError("")
    setPreviewing(true)
    setPreviewIndex(startIndex)
    setPreviewItemProgress(0)

    try {
      if (!previewPlayerRef.current) {
        const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!AudioContextCtor) throw new Error("当前浏览器不支持连续试听，请更新浏览器")
        previewPlayerRef.current = new PreviewPlayer(new AudioContextCtor(), {
          progress: (index, fraction) => { setPreviewIndex(index); setPreviewItemProgress(fraction) },
          buffering: setPreviewBuffering,
          duration: (index, seconds) => setPreviewDurations(previous => previous[index] === seconds ? previous : { ...previous, [index]: seconds }),
          ended: () => { setPreviewing(false); setPreviewIndex(0); setPreviewItemProgress(0) },
          error: message => { setPreviewError(message); setPreviewing(false) }
        })
      }
      document.querySelectorAll<HTMLAudioElement>(".workspace audio").forEach(audio => audio.pause())
      await previewPlayerRef.current.start(previewItems, startIndex)
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "无法开始试听")
      setPreviewing(false)
    }
  }

  const stopPreview = useCallback(() => {
    previewPlayerRef.current?.stop()
    setPreviewing(false)
    setPreviewItemProgress(0)
  }, [])

  useEffect(() => {
    stopPreview()
    setPreviewDurations({})
  }, [previewItems, stopPreview])

  useEffect(() => () => { previewPlayerRef.current?.dispose(); previewPlayerRef.current = null }, [])

  useEffect(() => {
    if (workspaceView !== "studio") {
      stopPreview()
      document.querySelectorAll<HTMLAudioElement>(".workspace audio").forEach(audio => audio.pause())
    }
  }, [workspaceView, stopPreview])

  function seekPreview(index: number) {
    const nextIndex = Math.max(0, Math.min(Math.max(0, previewItems.length - 1), index))
    setPreviewIndex(nextIndex)
    setPreviewItemProgress(0)
    if (!previewing) return
    stopPreview()
    void startPreview(nextIndex)
  }

  function clearAudio(segUid: string) {
    setSegments((prev) =>
      prev.map((item) =>
        item.type === "tts" && (item.uid === segUid || item.repeatOfUid === segUid)
          ? { ...item, audioId: undefined, audioUrl: undefined, generationMeta: undefined, status: "idle", error: "" }
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

  function applyRoleVoice(role: VoiceRoleKey, nextVoiceId: string) {
    if (!roleVoiceOptions.some((voice) => voice.id === nextVoiceId)) return
    setRoleVoiceIds((prev) => ({ ...prev, [role]: nextVoiceId }))
    setSegments((prev) =>
      prev.map((item) => {
        if (item.type !== "tts" || voiceRuleForSegment(item) !== role) return item
        return {
          ...item,
          voiceId: nextVoiceId,
          audioId: undefined,
          audioUrl: undefined,
          generationMeta: undefined,
          status: item.text.trim() ? ("idle" as const) : item.status,
          error: item.audioId ? "统一朗读音色已更新，请重新生成该片段" : ""
        }
      })
    )
  }

  function applyModelChange(nextModel: string) {
    if (!providerConfig?.models.some((model) => model.id === nextModel)) return
    const voices = compatibleVoices(providerConfig, nextModel)
    const nextRoleVoices = defaultRoleVoices(providerConfig, nextModel)
    setModelId(nextModel)
    setRoleVoiceIds(nextRoleVoices)
    setVoiceId((current) => voices.some((voice) => voice.id === current) ? current : voices.find((voice) => voice.id === providerConfig.defaultVoiceId)?.id || voices[0]?.id || "")
    setSegments((prev) =>
      prev.map((item) => {
        if (item.type !== "tts") return item
        const rule = voiceRuleForSegment(item)
        const nextVoice = rule ? nextRoleVoices[rule] : voices.some((voice) => voice.id === item.voiceId) ? item.voiceId : voices[0]?.id || ""
        return {
          ...item,
          modelId: nextModel,
          voiceId: nextVoice,
          audioId: undefined,
          audioUrl: undefined,
          generationMeta: undefined,
          status: item.text.trim() ? ("idle" as const) : item.status,
          error: item.audioId ? "生成模型已更新，请重新生成该片段" : ""
        }
      })
    )
  }

  function preferredVoiceForAccent(role?: string) {
    const voices = roleVoiceOptions
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

  function addMusic() {
    const presetId = template.introMusicPreset || "piano"
    const segment: Segment = {
      uid: uid(),
      type: "music",
      presetId,
      durationMs: musicPresetDurationMs(presetId, 3500),
      label: presetId === "piano" ? "钢琴曲导入音乐" : "导入音乐",
      role: "music"
    }
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
          generationMeta: undefined,
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

  function voiceForRole(role?: string, text?: string) {
    const voices = roleVoiceOptions
    const globalRule =
      role === "male" || role === "female"
        ? roleVoiceIds[role]
        : role === "question"
          ? roleVoiceIds.question
          : text && hasChineseText(text)
            ? roleVoiceIds.narrator
            : ""
    if (globalRule && voices.some((voice) => voice.id === globalRule)) return globalRule
    if (text && hasChineseText(text)) {
      const roleMatch = role === "male" || role === "female" ? "dialogue" : "narrator"
      const byChineseRole = voices.find((voice) => voice.locale === "zh-CN" && voice.role === roleMatch)
      const byChineseGender = voices.find((voice) => voice.locale === "zh-CN" && (role === "male" || role === "female" ? voice.gender === role : true))
      const byChineseAny = voices.find((voice) => voice.locale === "zh-CN")
      if (byChineseRole || byChineseGender || byChineseAny) return (byChineseRole || byChineseGender || byChineseAny)?.id || ""
    }
    const byAccent = preferredVoiceForAccent(role)
    const byGender = role === "male" ? voices.find((voice) => voice.gender === "male") : role === "female" ? voices.find((voice) => voice.gender === "female") : undefined
    const byRole = voices.find((voice) => voice.role === (role === "question" ? "question" : role === "male" || role === "female" ? "dialogue" : "narrator"))
    return byAccent?.id || byGender?.id || byRole?.id || voiceId || providerConfig?.defaultVoiceId || ""
  }

  function voiceForSegmentRequest(seg: TtsSegment, text: string) {
    const voices = roleVoiceOptions
    const rule = voiceRuleForSegment({ ...seg, text })
    if (rule) {
      const selectedRuleVoice = roleVoiceIds[rule]
      if (voices.some((voice) => voice.id === selectedRuleVoice)) return selectedRuleVoice
    }
    const selected = voices.find((voice) => voice.id === seg.voiceId)
    if (hasChineseText(text) && selected?.locale && selected.locale !== "zh-CN") {
      return voiceForRole(seg.role, text) || seg.voiceId || voiceId
    }
    return selected?.id || voiceForRole(seg.role, text) || voices.find((voice) => voice.id === voiceId)?.id || voices[0]?.id || ""
  }

  function conversationContinuityNote(seg: TtsSegment, text: string) {
    if (!seg.groupId) return ""
    const turns = groupSegments(seg.groupId).filter((item) => !item.repeatOfUid && !isQuestionRole(item) && Boolean(item.text.trim()))
    const index = turns.findIndex((item) => item.uid === seg.uid)
    if (index < 0 || turns.length < 2) return ""
    const role = seg.role === "female" ? "Female speaker W/B" : seg.role === "male" ? "Male speaker M/A" : "Narrator"
    const voice = voiceForSegmentRequest(seg, text)
    const excerpt = (value?: string) => (value || "").trim().replace(/\s+/g, " ").slice(0, 180)
    const previous = turns[index - 1]
    const next = turns[index + 1]
    return [
      `CONVERSATION CONTINUITY: This is turn ${index + 1} of ${turns.length} in one continuous dialogue.`,
      `CHARACTER LOCK: ${role} always uses voice ${voice}. Preserve exactly the same speaker identity, age impression, accent, pace, energy, pitch range, and microphone distance in every turn.`,
      previous ? `Previous turn for context only, do not speak it: ${excerpt(previous.text)}` : "",
      next ? `Next turn for context only, do not speak it: ${excerpt(next.text)}` : "",
      "Respond naturally to the meaning of the adjacent turn. Keep the emotion restrained and consistent with an English listening exam; do not restart with a fresh announcer tone."
    ].filter(Boolean).join("\n")
  }

  async function requestSegmentTts(seg: TtsSegment, text = seg.text) {
    const modelToUse = modelId || providerConfig?.defaultModelId || seg.modelId
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
          languageType: requestLanguageType(text, provider, languageType, accentOption.locale),
          text,
          voice: voiceForSegmentRequest(seg, text),
          stylePresetId: seg.stylePresetId || stylePresetId,
          stylePrompt: seg.stylePrompt || stylePrompt,
          directorNote: [accentDirectorNote(), languageRateDirective(text, template), conversationContinuityNote(seg, text), seg.directorNote].filter(Boolean).join("\n"),
          speed: targetSpeedForText(text, template),
          pitch: seg.pitch || 1,
          volume: seg.volume || 1
        })
      })
      const rawText = await res.text()
      const json = (() => {
        try {
          return JSON.parse(rawText) as TtsResult
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
          return JSON.parse(rawText) as TtsResult
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
    if (item.type === "music") {
      const presetId = item.presetId || template.introMusicPreset
      return { uid: uid(), type: "music", presetId, durationMs: musicPresetDurationMs(presetId, item.durationMs || 3500), label: item.label || "导入音乐", role: "music" }
    }
    if (item.type === "silence") return { uid: uid(), type: "silence", durationMs: item.durationMs || 1000, label: item.label, role: item.role, groupId: item.groupId }
    const nextPace = item.pacePreset || pacePreset
    const nextSpeed = targetSpeedForText(item.text, template)
    return {
      uid: uid(),
      type: "tts",
      text: item.text,
      label: item.label,
      voiceId: voiceForRole(item.role, item.text),
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

  async function analyzeScript(text: string, mode: ApplyMode, smart = false) {
    setAnalyzing(true)
    setComposeError("")
    try {
      const res = await fetch("/api/script/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, template, smart })
      })
      const rawText = await res.text()
      const json = (() => {
        try {
          return JSON.parse(rawText) as { segments?: DirectorSegment[]; analysis?: ScriptAnalysisMeta; error?: string; detail?: string }
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
      const documentLabels: Record<NonNullable<ScriptAnalysisMeta["documentType"]>, string> = {
        exam: "听力试卷",
        podcast: "播客文字稿",
        news: "新闻稿",
        general: "普通文字稿"
      }
      const analysisMode = json.analysis?.mode === "ai" ? `${json.analysis.model || "DeepSeek"} 智能识别` : "本地规则识别"
      const documentLabel = json.analysis?.documentType ? documentLabels[json.analysis.documentType] : "文字稿"
      setAnalysisMessage(`${analysisMode} · ${documentLabel} · 已拆成 ${mapped.filter((item) => item.type === "tts").length} 个朗读片段${json.analysis?.warning ? ` · ${json.analysis.warning}` : ""}`)
      setMobileInspectPanel("list")
      return mapped
    } catch (err) {
      setComposeError(err instanceof Error ? `脚本导演分析失败：${err.message}` : "脚本导演分析失败")
      return null
    } finally {
      setAnalyzing(false)
    }
  }

  async function createAudioFromScript(text: string, mode: ApplyMode, smart = false) {
    if (!credentialsComplete(providerConfig, credentials)) {
      setComposeError(`一键生成前需要先配置${providerConfig?.label || "当前语音服务商"}。`)
      setAutoWorkflow("error")
      setWorkspaceView("services")
      return
    }
    setAutoWorkflow("analyzing")
    setComposeError("")
    setLastExportUrl("")
    const mapped = await analyzeScript(text, mode, smart)
    if (!mapped?.some((item) => item.type === "tts" && item.text.trim())) {
      setAutoWorkflow("error")
      return
    }
    setAutoWorkflow("ready")
  }

  function groupSegments(groupId: string) {
    return segments.filter((item): item is TtsSegment => isTtsSegment(item) && item.groupId === groupId)
  }

  function isQuestionRole(segment: TtsSegment) {
    return segment.role === "question" || segment.stylePresetId === "question_marker"
  }

  function shouldGenerateAsGroup(segment: TtsSegment) {
    if (!segment.groupId || isQuestionRole(segment) || segment.repeatOfUid) return false
    if (segment.role === "intro" || segment.groupId.includes("::instruction") || segment.groupId.includes("::closing") || segment.groupId.includes("::number")) return false
    const list = groupSegments(segment.groupId).filter((item) => !item.repeatOfUid && !isSecondPassSegment(item) && Boolean(item.text.trim()))
    const hasDialogue = list.some((item) => item.role === "male" || item.role === "female" || Boolean(toDialogueSpeaker(item)))
    const hasMultipleNarrationTurns = list.filter((item) => !isQuestionRole(item)).length > 1
    return hasDialogue || hasMultipleNarrationTurns
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
        updateSegment(container.uid, { status: "error", error: "请先在「声音服务」连接当前账号" })
        setWorkspaceView("services")
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
            languageType: requestLanguageType(combinedText, provider, languageType, accentOption.locale),
            text: combinedText,
            voice: voiceForSegmentRequest(question, combinedText) || voiceForSegmentRequest(container, combinedText),
            stylePresetId: question.stylePresetId || container.stylePresetId || stylePresetId,
            stylePrompt: question.stylePrompt || container.stylePrompt || stylePrompt,
            directorNote: [accentDirectorNote(), languageRateDirective(combinedText, template), question.directorNote].filter(Boolean).join("\n"),
            speed: targetSpeedForText(combinedText, template),
            pitch: question.pitch || 1,
            volume: question.volume || 1
          }, "生成失败")

        setSegments((prev) => {
          const containerUid = container.uid
          return prev.map((item) =>
            item.type === "tts" && item.uid === containerUid
              ? { ...item, text: combinedText, audioId: json.id, audioUrl: json.url, generationMeta: json.meta, status: "done", error: "" }
              : item
          )
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
              return { ...item, providerOverrides: { ...(item.providerOverrides || {}), generatedGroupText: combinedText }, audioId: json.id, audioUrl: json.url, generationMeta: json.meta, status: "done", error: "" }
            }
            if (item.repeatOfUid === containerUid) {
              return { ...item, generationMeta: json.meta, status: "done", error: "" }
            }
            if (item.groupId !== groupId) return item
            if (isQuestionRole(item)) return item
            if (secondContainer && item.uid === secondContainer.uid) {
              return { ...item, repeatOfUid: containerUid, audioId: "", audioUrl: "", generationMeta: json.meta, status: "done", error: "" }
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
          languageType: requestLanguageType(combinedText, provider, languageType, accentOption.locale),
          text: combinedText,
          voice: voiceForSegmentRequest(container, combinedText),
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
            return { ...item, providerOverrides: { ...(item.providerOverrides || {}), generatedGroupText: combinedText }, audioId: json.id, audioUrl: json.url, generationMeta: json.meta, status: "done", error: "" }
          }
          if (item.repeatOfUid === containerUid) {
            return { ...item, generationMeta: json.meta, status: "done", error: "" }
          }
          if (item.groupId !== groupId) return item
          if (isQuestionRole(item)) return item
          if (secondContainer && item.uid === secondContainer.uid) {
            return { ...item, repeatOfUid: containerUid, audioId: "", audioUrl: "", generationMeta: json.meta, status: "done", error: "" }
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
        updateSegment(container.uid, { status: "error", error: "请先在「声音服务」连接当前账号" })
        setWorkspaceView("services")
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
          if (segment.uid === item.uid || segment.repeatOfUid === item.uid) return { ...segment, audioId: json.id, audioUrl: json.url, generationMeta: json.meta, status: "done", error: "" }
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

  async function generateSegmentAudio(segUid: string, standalone = false) {
    const seg = segments.find((item) => item.uid === segUid)
    if ((!seg || seg.type !== "tts") && groupSegments(segUid).length) {
      return generateGroup(segUid)
    }
    if (!seg || seg.type !== "tts") return false
    if (seg.repeatOfUid) {
      const source = segments.find((item): item is TtsSegment => isTtsSegment(item) && item.uid === seg.repeatOfUid)
      if (source?.audioId && source.audioUrl) {
        updateSegment(seg.uid, { audioId: source.audioId, audioUrl: source.audioUrl, generationMeta: source.generationMeta, status: "done", error: "" })
        return true
      }
      updateSegment(seg.uid, { status: "error", error: "复用片段需要先生成第 1 遍音频" })
      return false
    }
    if (!seg.text.trim()) {
      updateSegment(segUid, { status: "error", error: "文本不能为空" })
      return false
    }
    if (!standalone && seg.groupId && shouldGenerateAsGroup(seg)) {
      return generateGroup(seg.groupId)
    }
    if (!containsPhonicsToken(seg.text) && !credentialsComplete(providerConfig, credentials)) {
      updateSegment(segUid, { status: "error", error: "请先在「声音服务」连接当前账号" })
      setWorkspaceView("services")
      return false
    }

    updateSegment(segUid, { status: "generating", error: "" })

    try {
      const json = await requestSegmentTts(seg)
      setSegments((prev) =>
        prev.map((item) =>
          item.type === "tts" && (item.uid === segUid || item.repeatOfUid === segUid)
            ? { ...item, audioId: json.id, audioUrl: json.url, generationMeta: json.meta, status: "done", error: "" }
            : item
        )
      )
      return true
    } catch (err) {
      updateSegment(segUid, { status: "error", error: err instanceof Error ? err.message : "生成失败" })
      return false
    }
  }

  async function runQueue(queue: string[], options?: { autoCompose?: boolean }) {
    if (bulkRunning) return
    if (!queue.length) {
      setBulkProgressText("没有需要生成的片段")
      if (options?.autoCompose) setAutoWorkflow("error")
      return
    }
    const needsCloudTts = segments.some((item) => {
      if (!isTtsSegment(item) || !item.text.trim() || containsPhonicsToken(item.text)) return false
      return queue.includes(item.uid) || Boolean(item.groupId && queue.includes(item.groupId))
    })
    if (needsCloudTts && !credentialsComplete(providerConfig, credentials)) {
      setBulkProgressText("")
      setComposeError(`生成前检查：${providerConfig?.label || "当前服务商"}尚未配置。请在「声音服务」连接账号。`)
      if (options?.autoCompose) setAutoWorkflow("error")
      setWorkspaceView("services")
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
    if (options?.autoCompose) {
      setAutoWorkflow(failed || stopRef.current ? "error" : "compose-pending")
    }
  }

  function generationQueue(input = segments) {
    const queue = new Set<string>()
    for (const item of input) {
      if (!isTtsSegment(item) || item.audioId || item.repeatOfUid || !item.text.trim()) continue
      queue.add(shouldGenerateAsGroup(item) ? item.groupId as string : item.uid)
    }
    return [...queue]
  }

  function generateAll(options?: { autoCompose?: boolean }) {
    void runQueue(generationQueue(), options)
  }

  function retryFailed() {
    const queue = new Set<string>()
    for (const item of segments) {
      if (!isTtsSegment(item) || item.status !== "error" || item.repeatOfUid) continue
      queue.add(shouldGenerateAsGroup(item) ? item.groupId as string : item.uid)
    }
    void runQueue([...queue])
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

  function startResizeSegmentPane(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = segmentPaneWidth
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.round(startWidth + moveEvent.clientX - startX)
      setSegmentPaneWidth(Math.max(340, Math.min(680, next)))
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
      setSpeedSampleError("请先在「声音服务」连接当前账号")
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
          languageType: requestLanguageType(sampleText, provider, languageType, accentOption.locale),
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
          return JSON.parse(rawText) as TtsResult
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
          generationMeta: undefined,
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
          generationMeta: undefined,
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
        const roleVoice = nextVoice || voiceForRole(item.role, item.text)
        return {
          ...item,
          voiceId: roleVoice || item.voiceId,
          audioId: undefined,
          audioUrl: undefined,
          generationMeta: undefined,
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

  function downloadExport(url: string, format = exportFormat) {
    const link = document.createElement("a")
    link.href = url
    link.download = `listening-audio.${format}`
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  async function composeAndDownload(options?: { auto?: boolean }) {
    if (options?.auto) setAutoWorkflow("composing")
    let completed = false
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
        | { type: "music"; presetId?: MusicSegment["presetId"]; durationMs?: number }
      > = []
      for (const item of segments) {
        if (item.type === "silence") {
          payloadSegments.push({ type: "silence", durationMs: item.durationMs })
          continue
        }
        if (item.type === "music") {
          payloadSegments.push({ type: "music", presetId: item.presetId, durationMs: musicPresetDurationMs(item.presetId, item.durationMs) })
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
      if (!json.url) throw new Error("合成成功，但没有返回下载地址")
      setLastExportUrl(json.url)
      downloadExport(json.url, exportFormat)
      completed = true
    } catch (err) {
      setComposeError(err instanceof Error ? err.message : "合成失败")
    } finally {
      setComposeRunning(false)
      if (options?.auto) setAutoWorkflow(completed ? "done" : "error")
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

  const canCompose = segments.some((item) => item.type === "tts") &&
    segments.every((item) => {
      if (item.type !== "tts") return true
      if (item.status === "skipped") return true
      if (item.audioId) return true
      if (!item.repeatOfUid) return false
      return Boolean(segments.find((candidate): candidate is TtsSegment => isTtsSegment(candidate) && candidate.uid === item.repeatOfUid && Boolean(candidate.audioId)))
    })
  const hasPendingGeneration = segments.some((item) => {
    if (item.type !== "tts") return false
    if (!item.text.trim() || item.status === "skipped" || item.audioId) return false
    if (!item.repeatOfUid) return true
    return !segments.some((candidate): candidate is TtsSegment => isTtsSegment(candidate) && candidate.uid === item.repeatOfUid && Boolean(candidate.audioId))
  })

  useEffect(() => {
    if (autoWorkflow !== "ready") return
    const queue = generationQueue()
    if (!queue.length) {
      setComposeError("智能拆分完成，但没有找到可生成的朗读内容。请使用手工检查功能调整片段。")
      setAutoWorkflow("error")
      return
    }
    setAutoWorkflow("generating")
    void runQueue(queue, { autoCompose: true })
    // generationQueue/runQueue intentionally use the latest rendered segment snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoWorkflow, segments])

  useEffect(() => {
    if (autoWorkflow !== "compose-pending" || !canCompose) return
    void composeAndDownload({ auto: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoWorkflow, canCompose])

  return (
    <div className={`appRoot studioShell view-${workspaceView}`}>
      <aside className="studioSidebar">
        <a className="studioLogo" href="/" aria-label="听见工作台首页"><span className="logoWave" aria-hidden="true"><i /><i /><i /><i /><i /></span><span>听见<span className="logoEnglish">LISTEN STUDIO</span></span></a>
        <div className="sidebarSectionLabel">音频制作</div>
        <nav className="studioNav" aria-label="工作区导航">
          <button className={workspaceView === "script" ? "active" : ""} onClick={() => setWorkspaceView("script")}><span>01</span>准备文稿</button>
          <button className={workspaceView === "studio" ? "active" : ""} onClick={() => setWorkspaceView("studio")}><span>02</span>配音与试听{stats.tts ? <em>{stats.tts}</em> : null}</button>
          <button className={workspaceView === "export" ? "active" : ""} onClick={() => setWorkspaceView("export")}><span>03</span>导出成品</button>
        </nav>
        <nav className="studioNav" aria-label="设置导航"><button className={workspaceView === "services" || workspaceView === "local" ? "active" : ""} onClick={() => setWorkspaceView("services")}><span>♫</span>声音服务<span className="navDot" /></button><button className={workspaceView === "settings" ? "active" : ""} onClick={() => setWorkspaceView("settings")}><span>⚙</span>制作设置</button></nav>
        <div className="sidebarBottom"><div className="sidebarAccount"><span>N</span><div>Newsun English<small>教师音频工作台</small></div></div></div>
      </aside>
      <TopBar
        workspaceView={workspaceView}
        provider={providerConfig}
        bulkRunning={bulkRunning}
        bulkProgressText={bulkProgressText}
        onGenerateAll={generateAll}
        onRetryFailed={retryFailed}
        onStopGenerateAll={stopGenerateAll}
        hasPendingGeneration={hasPendingGeneration}
        stats={stats}
      />

      {workspaceView === "local" ? <LocalTtsPage onBack={() => setWorkspaceView("services")} /> : workspaceView === "services" ? <div className="servicePage"><ServiceHub providers={providers} provider={providerConfig} onProviderChange={setProvider} credentials={credentials} onCredentialsChange={setCredentials} modelId={modelId} onModelChange={applyModelChange} voiceId={voiceId} voices={roleVoiceOptions} onVoiceChange={setVoiceId} baseUrl={baseUrl} onContinue={() => setWorkspaceView("script")} onAdvanced={() => setWorkspaceView("settings")} onLocalModels={() => setWorkspaceView("local")} /></div> : <div className="studioPageHeading"><div><h1>{workspaceView === "script" ? "准备文稿" : workspaceView === "studio" ? "配音与试听" : workspaceView === "settings" ? "制作设置" : "导出成品"}</h1></div>{workspaceView === "script" || workspaceView === "studio" ? <button className="currentVoiceCard" onClick={() => setWorkspaceView("services")}><span className="voiceCardIcon">♫</span><span><small>当前声音服务</small><strong>{providerConfig?.label || "正在加载…"}</strong><em>{providerConfig?.serverConfigured || credentialsComplete(providerConfig, credentials) ? "已配置 · 点击测试或更换" : "尚未连接 · 点此开通"}</em></span><span>↗</span></button> : null}</div>}

      {workspaceView === "script" && providerConfig && !providerConfig.serverConfigured && !credentialsComplete(providerConfig, credentials) ? <div className="setupBanner"><span>连接声音服务后即可生成音频。</span><button onClick={() => setWorkspaceView("services")}>选择声音服务 →</button></div> : null}

      {workspaceView === "export" ? <section className="exportPage">
        <div className="exportContent">
          <div className="exportStatus"><span aria-hidden="true">{canCompose ? "✓" : "◷"}</span><div><h2>{canCompose ? "音频已就绪" : "还有片段待完成"}</h2><p>{stats.tts ? `已生成 ${stats.generated} / ${stats.tts} 段 · 预计 ${stats.totalTime}` : "先添加文稿并生成语音。"}</p></div></div>
          <label className="field"><span className="label">文件格式</span><select value={exportFormat} onChange={e => setExportFormat(e.target.value === "wav" ? "wav" : "mp3")}><option value="mp3">MP3 · 日常播放</option><option value="wav">WAV · 后期编辑</option></select></label>
          <button className="btnPrimary exportMainButton" disabled={!canCompose || composeRunning} onClick={() => void composeAndDownload()}>{composeRunning ? "正在合成…" : "合成并下载 ↓"}</button>
          {!canCompose ? <button className="textButton exportReturn" onClick={() => setWorkspaceView(stats.tts ? "studio" : "script")}>{stats.tts ? `继续完成剩余 ${Math.max(0, stats.tts - stats.generated)} 段 →` : "准备文稿 →"}</button> : null}
          {lastExportUrl ? <div className="exportLast"><span>上次成品</span><audio controls preload="none" src={lastExportUrl} /><button className="textButton" onClick={() => downloadExport(lastExportUrl)}>再次下载 ↓</button></div> : null}
          {composeError ? <div className="inlineError" role="alert">{composeError}</div> : null}
        </div>
      </section> : null}

      <main className="workspace" aria-label="文稿与配音工作区" style={{ "--paste-pane-width": `${pastePaneWidth}px`, "--segment-pane-width": `${segmentPaneWidth}px` } as CSSProperties}>
        <div className="pastePane">
          <BulkPaste
            analyzing={analyzing}
            workflowStage={autoWorkflow}
            hasSegments={segments.length > 0}
            scriptAssist={scriptAssist}
            analysisMessage={analysisMessage}
            majorBreakMs={template.majorBreakMs}
            minorBreakMs={template.minorBreakMs}
            questionNumberGapMs={template.questionNumberGapMs}
            questionNumberStyle={template.questionNumberStyle}
            onAnalyze={(text, mode, smart) => { void analyzeScript(text, mode, smart).then(() => setWorkspaceView("studio")) }}
            onCreateAudio={createAudioFromScript}
            onApply={(parsed, mode) => {
            const mapped: Segment[] = linkRepeatedAudioSegments(parsed.map((item) => {
              const itemGroupId = "groupId" in item ? item.groupId : undefined
              const itemDirectorNote = "directorNote" in item ? item.directorNote : undefined
              if (item.type === "silence")
                return { uid: uid(), type: "silence", durationMs: item.durationMs, label: item.label, role: "neutral" as const, groupId: itemGroupId }
              if (item.type === "music")
                return { uid: uid(), type: "music", presetId: item.presetId, durationMs: musicPresetDurationMs(item.presetId, item.durationMs), label: item.label || "提示音", role: "music" as const }
              // 尝试从 ExamDraftSegment 类型获取 speakerTag
              const examItem = item as ExamDraftSegment
              const speakerTag = "speakerTag" in examItem && typeof examItem.speakerTag === "string" ? examItem.speakerTag : ""
              const isQuestionMarker = speakerTag === "NARRATOR" && /^(?:Number|Test)\s+(?:\d+|[a-z]+(?:\s+[a-z]+)?)/i.test(item.text.trim())
              const inferred =
                speakerTag === "M" || speakerTag === "A" || item.label === "M" || item.label === "A"
                  ? ({ role: "male" as const, label: speakerTag || item.label || "M" })
                  : speakerTag === "W" || speakerTag === "B" || item.label === "W" || item.label === "B"
                    ? ({ role: "female" as const, label: speakerTag || item.label || "W" })
                    : isQuestionMarker
                      ? ({ role: "question" as const, label: item.label || item.text.trim() })
                    : speakerTag === "NARRATOR" && hasChineseText(item.text) && /(?:听力测试|考试).{0,12}(?:现在开始|即将开始)/.test(item.text)
                      ? ({ role: "intro" as const, label: item.label || "旁白" })
                    : speakerTag === "NARRATOR"
                      ? ({ role: "narrator" as const, label: item.label || "旁白" })
                      : ({ role: "neutral" as const, label: item.label })
              const nextPace = inferred.role === "question" ? "exam_standard" : pacePreset
              return {
                uid: uid(),
                type: "tts" as const,
                text: item.text,
                label: inferred.label,
                voiceId: voiceForRole(inferred.role, item.text),
                modelId,
                stylePresetId: inferred.role === "question" ? "question_marker" : inferred.role === "male" || inferred.role === "female" ? "dialogue" : inferred.role === "intro" ? "exam_host" : "",
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
            setAnalysisMessage(`本地简单拆分 · 已拆成 ${mapped.filter((item) => item.type === "tts").length} 个朗读片段`)
            setWorkspaceView("studio")
            setMobileInspectPanel("list")
            }}
          />
          <button
            className="resizeHandle"
            type="button"
            aria-label="拖动调整粘贴拆分面板宽度"
            onPointerDown={startResizePastePane}
          />
        </div>

        <div className="mobileInspectTabs" aria-label="竖屏检查面板">
          <button className={mobileInspectPanel === "list" ? "mobileInspectTab mobileInspectTabActive" : "mobileInspectTab"} type="button" onClick={() => setMobileInspectPanel("list")}>
            片段列表
          </button>
          <button className={mobileInspectPanel === "editor" ? "mobileInspectTab mobileInspectTabActive" : "mobileInspectTab"} type="button" onClick={() => setMobileInspectPanel("editor")} disabled={!selectedSegment}>
            编辑片段
          </button>
        </div>

        <div className={`segmentPane mobileInspectPanel ${mobileInspectPanel === "list" ? "mobileInspectActive" : ""}`}>
          <SegmentList
            provider={provider}
            segments={segments}
            selectedUid={selectedUid}
            onSelect={(nextUid) => {
              setSelectedUid(nextUid)
              setMobileInspectPanel("editor")
            }}
            onReorder={reorder}
            onAddTts={addTts}
            onAddSilence={addSilence}
            onAddMusic={addMusic}
            onClearAll={clearAllSegments}
            voiceOptions={roleVoiceOptions}
            roleVoiceIds={roleVoiceIds}
            onRoleVoiceChange={applyRoleVoice}
          />
          <button
            className="resizeHandle segmentResizeHandle"
            type="button"
            aria-label="拖动调整语音片段选择面板宽度"
            onPointerDown={startResizeSegmentPane}
          />
        </div>

        <div className={`editorStack mobileInspectPanel ${mobileInspectPanel === "editor" ? "mobileInspectActive" : ""}`}>
          <SegmentEditor
            provider={provider}
            voiceOptions={roleVoiceOptions}
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
            onGenerateSingle={(uid) => void generateSegmentAudio(uid, true)}
            onClearAudio={clearAudio}
            repeatControl={{ canUse: canRepeatSelectedGroup(selectedSegment), enabled: selectedSegment?.type === "tts" ? repeatEnabledForGroup(selectedSegment.groupId) : false }}
            onToggleRepeat={toggleRepeatForSegment}
          />

          {composeError ? <div className="toast toastError">{composeError}</div> : null}
        </div>
      </main>

      {workspaceView === "studio" ? <div className="studioPreview" aria-label="全篇试听">
        <span className="studioPreviewLabel">全篇试听</span>
        <button className="studioPreviewButton" type="button" onClick={() => previewing ? stopPreview() : void startPreview(previewIndex)} disabled={!previewItems.length} aria-label={previewing ? "停止全篇试听" : "播放全篇试听"}>{previewing ? "■ 停止" : "▷ 播放"}</button>
        {previewBuffering ? <span role="status">缓冲中…</span> : null}
        <input type="range" min={0} max={Math.max(0, previewItems.length - 1)} step={1} value={Math.min(previewIndex, Math.max(0, previewItems.length - 1))} onChange={event => seekPreview(Number(event.target.value))} disabled={!previewItems.length} aria-label="全篇试听进度" />
        <span className="studioPreviewTime">{formatTime(previewElapsedMs / 1000)} / {formatTime(totalPreviewMs / 1000)}</span>
        {previewError ? <span className="inlineError" role="status">{previewError}</span> : null}
      </div> : null}

      {workspaceView === "settings" ? <SettingsPage
        providers={providers}
        provider={provider}
        onOpenServices={() => setWorkspaceView("services")}
        modelId={modelId}
        onModelIdChange={applyModelChange}
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
      /> : null}
    </div>
  )
}
