import type { StylePresetId } from "../presets.js"

type PreparedPhonics = {
  text: string
  instruction: string
  detected: boolean
}

const slashTokenPattern = /\/([^/\n]{1,32})\//g

function normalizeToken(raw: string) {
  return raw.trim().toLowerCase().replace(/\s+/g, "")
}

export function hasPhonicsTokens(text: string, stylePresetId?: StylePresetId | "") {
  return stylePresetId === "phonics" || extractSlashTokens(text).length > 0
}

function extractSlashTokens(text: string) {
  return Array.from(text.matchAll(slashTokenPattern), (match) => normalizeToken(match[1])).filter(Boolean)
}

export function preparePhonicsRequest(text: string, stylePresetId?: StylePresetId | ""): PreparedPhonics {
  const tokens = extractSlashTokens(text)
  const detected = stylePresetId === "phonics" || tokens.length > 0
  if (!detected) return { text, instruction: "", detected: false }

  const instruction = [
    "PHONICS MODE: This segment contains English phonics or pronunciation tokens.",
    "Read the original input text as-is, but interpret slash-delimited items like /sp/ and /speɪ/ as pronunciation tokens.",
    "Do not read the slash marks themselves. Do not add extra explanations or translations.",
    "Keep the delivery slow, even, and teacher-like, with a short pause after each item.",
    "For pseudo-IPA spellings, read /ei/ as the long A sound /eɪ/, for example /spei/ as 'spay' and /speis/ as 'space'.",
    "For consonant clusters such as /sp/, demonstrate the blended sound briefly without adding an explanation."
  ].join("\n")

  return { text, instruction, detected: true }
}
