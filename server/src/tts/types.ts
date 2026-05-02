export type TtsAudioFormat = "mp3" | "wav"

export type TtsAudio = {
  bytes: Buffer
  format: TtsAudioFormat
}

export type TtsCredentials = Record<string, string | undefined>

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
