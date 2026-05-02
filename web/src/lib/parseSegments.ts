export type ParseMode = "blank" | "line" | "dialogue"

export type ParsedSegment =
  | { type: "tts"; text: string; label?: string }
  | { type: "silence"; durationMs: number; label?: string }

function parseSilenceToken(raw: string): { type: "silence"; durationMs: number } | null {
  const m = raw.trim().match(/^\[(silence|pause)\s+(\d+)\]$/i)
  if (!m) return null
  const durationMs = Number(m[2])
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null
  return { type: "silence", durationMs }
}

export function parseSegments(input: string, mode: ParseMode): ParsedSegment[] {
  const text = input.replace(/\r\n/g, "\n")
  if (!text.trim()) return []

  if (mode === "blank") {
    const out: ParsedSegment[] = []
    for (const p of text.split(/\n\s*\n+/)) {
      const trimmed = p.trim()
      if (!trimmed) continue
      const s = parseSilenceToken(trimmed)
      if (s) out.push(s)
      else out.push({ type: "tts", text: trimmed })
    }
    return out
  }

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)
  const out: ParsedSegment[] = []

  if (mode === "line") {
    for (const l of lines) {
      const s = parseSilenceToken(l)
      if (s) out.push(s)
      else out.push({ type: "tts", text: l })
    }
    return out
  }

  for (const l of lines) {
    const s = parseSilenceToken(l)
    if (s) {
      out.push(s)
      continue
    }

    const m = l.match(/^([^:]{1,32})\s*:\s*(.+)$/)
    if (!m) out.push({ type: "tts", text: l })
    else out.push({ type: "tts", label: m[1].trim(), text: m[2].trim() })
  }
  return out
}
