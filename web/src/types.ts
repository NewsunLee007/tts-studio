export type ProviderId = "openai" | "dashscope" | "google" | "google_gemini" | "volcengine" | "xfyun" | "tencent" | "baidu" | "huawei"

export type VoiceGender = "male" | "female" | "neutral"

export type CredentialField = {
  key: string
  label: string
  type: "text" | "password" | "url"
  required: boolean
  placeholder?: string
}

export type TtsModelPreset = {
  id: string
  label: string
  description: string
  supportsInstructions?: boolean
  supportsSsml?: boolean
  supportsEmotion?: boolean
  speedRange?: [number, number]
}

export type VoicePreset = {
  id: string
  label: string
  gender: VoiceGender
  locale?: string
  role?: "narrator" | "dialogue" | "question" | "general"
}

export type ProviderConfig = {
  id: ProviderId
  label: string
  region: "global" | "china"
  status: "ready" | "configured-only"
  description: string
  credentialFields: CredentialField[]
  models: TtsModelPreset[]
  voices: VoicePreset[]
  capabilities: string[]
  defaultModelId: string
  defaultVoiceId: string
  defaultBaseUrl?: string
}

export type PacePresetId = "exam_slow" | "exam_standard" | "dialogue_natural" | "quick_preview"

export type PacePreset = { id: PacePresetId; label: string; speed: number; description: string }

export type EnglishAccentId = "british_standard" | "british_rp_exam" | "american_general" | "international_clear"

export type ProvidersResponse = {
  providers: ProviderConfig[]
  styles: Array<{ id: string; label: string }>
  paces: PacePreset[]
}

export type ProviderCatalogResponse = {
  models: TtsModelPreset[]
  voices: VoicePreset[]
  source: "remote" | "builtin"
  message?: string
  error?: string
}

export type PresetsResponse = {
  providers: ProviderId[]
  openai: { voices: VoicePreset[]; defaultModel: string; defaultBaseUrl: string }
  dashscope: { voices: VoicePreset[]; defaultModel: string; defaultBaseUrl: string }
  styles: Array<{ id: string; label: string }>
}

export type ExamTemplate = {
  school: string
  schoolYear: string
  semester: string
  examName: string
  subject: string
  grade: string
  examType: string
  includeIntroMusic: boolean
  introMusicPreset: "warmup" | "bell" | "soft" | "piano"
  includeExamIntro: boolean
  includeQuestionNumbers: boolean
  questionNumberStyle: "number" | "test"
  majorBreakMs: number
  minorBreakMs: number
  questionNumberGapMs: number
  englishWordsPerMinute: number
  chineseCharsPerMinute: number
}

export type SegmentRole = "intro" | "question" | "narrator" | "male" | "female" | "neutral" | "music"

export type QueueStatus = "idle" | "queued" | "generating" | "done" | "error" | "skipped"

export type TtsGenerationMeta = {
  provider: string
  requestedModel?: string
  usedModel?: string
  requestedVoice?: string
  usedVoice?: string
  instructionMode?: "sent" | "suppressed" | "not-supported"
  languageType?: string
  warnings?: string[]
  requestSummary?: Array<{ label: string; value: string }>
}

export type TtsSegment = {
  uid: string
  type: "tts"
  text: string
  label?: string
  voiceId: string
  modelId?: string
  stylePresetId: string
  stylePrompt: string
  role?: SegmentRole
  groupId?: string
  directorNote?: string
  emotion?: string
  pacePreset?: PacePresetId
  speed?: number
  pitch?: number
  volume?: number
  providerOverrides?: Record<string, unknown>
  generationMeta?: TtsGenerationMeta
  repeatOfUid?: string
  audioId?: string
  audioUrl?: string
  status: QueueStatus
  error?: string
}

export type SilenceSegment = {
  uid: string
  type: "silence"
  durationMs: number
  label?: string
  role?: SegmentRole
  groupId?: string
}

export type MusicSegment = {
  uid: string
  type: "music"
  presetId: "warmup" | "bell" | "soft" | "piano" | "ding"
  durationMs: number
  label?: string
  role?: SegmentRole
}

export type Segment = TtsSegment | SilenceSegment | MusicSegment

export type SegmentPatch = Partial<TtsSegment> | Partial<SilenceSegment> | Partial<MusicSegment>
