export type TtsAudioFormat = "mp3" | "wav"

export type TtsAudio = {
  bytes: Buffer
  format: TtsAudioFormat
  meta?: TtsGenerationMeta
}

export type TtsCredentials = Record<string, string | undefined>

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

export type UnifiedTtsRequest = {
  credentials: TtsCredentials
  text: string
  ssml?: string
  voice?: string
  model?: string
  baseUrl?: string
  stylePrompt?: string
  speed?: number
  pitch?: number
  volume?: number
  languageType?: string
}
