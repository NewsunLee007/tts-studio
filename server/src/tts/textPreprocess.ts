export function normalizeTextForTts(text: string) {
  return text.replace(/[!！]+/g, ".")
}
