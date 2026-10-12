import type { Segment, TtsSegment } from "../types"

export type RepeatMode = "once" | "original" | "male-female"
export type RepeatVoices = { first: string; second: string }

function isContent(item: TtsSegment) {
  return item.role !== "intro" && item.role !== "question" && item.stylePresetId !== "question_marker" && !/[\u3400-\u9fff]/.test(item.text) && Boolean(item.text.trim())
}

export function isRepeat(segment: Segment) {
  return segment.type === "tts" && Boolean(segment.repeatSourceUid || segment.repeatOfUid || /第\s*2\s*遍/.test(segment.directorNote || ""))
}

export function repeatGroupLeader(segments: Segment[], groupId?: string) {
  if (!groupId || /exam-intro|::instruction|::closing|::number/.test(groupId)) return undefined
  const content = segments.filter((item): item is TtsSegment => item.type === "tts" && item.groupId === groupId && !isRepeat(item) && item.role !== "intro")
  if (!content.some(isContent)) return undefined
  return content[0]
}

export function groupRepeatMode(segments: Segment[], groupId: string): RepeatMode {
  if (!segments.some(item => item.type === "tts" && item.groupId === groupId && isRepeat(item))) return "once"
  return segments.some(item => item.type === "tts" && item.groupId === groupId && item.repeatVoiceMode === "male-female") ? "male-female" : "original"
}

// Rebuild only the second reading, retaining internal pauses and the question's
// trailing answer time. Changed voices invalidate their own generated audio.
export function configureGroupRepeat(segments: Segment[], groupId: string, mode: RepeatMode, voices: RepeatVoices, makeUid: () => string): Segment[] {
  if (!repeatGroupLeader(segments, groupId)) return segments
  const base = segments.filter(item => !(
    item.type === "tts" && item.groupId === groupId && isRepeat(item)
    || item.type === "silence" && item.groupId === groupId && (item.repeatGroupId === groupId || item.label === "重读间隔")
  )).map((item): Segment => {
    if (item.type !== "tts" || item.groupId !== groupId || !isContent(item)) return item
    if (mode !== "male-female" && !item.repeatVoiceMode && item.repeatOriginalVoiceId === undefined) return item
    const voiceId = mode === "male-female" ? voices.first : item.repeatOriginalVoiceId ?? item.voiceId
    const next: TtsSegment = { ...item, voiceId, repeatVoiceMode: mode === "male-female" ? mode : undefined,
      repeatOriginalVoiceId: mode === "male-female" ? item.repeatOriginalVoiceId ?? item.voiceId : undefined }
    return voiceId === item.voiceId ? next : { ...next, audioId: undefined, audioUrl: undefined, generationMeta: undefined, status: "idle", error: "" }
  })
  if (mode === "once") return base
  const content = base.filter((item): item is TtsSegment => item.type === "tts" && item.groupId === groupId && isContent(item))
  if (!content.length) return base
  const start = base.indexOf(content[0]), end = base.indexOf(content.at(-1)!)
  const repeats: Segment[] = [{ uid: makeUid(), type: "silence", durationMs: 1200, label: "重读间隔", groupId, repeatGroupId: groupId }]
  for (const item of base.slice(start, end + 1)) {
    if (item.type === "silence" && item.groupId === groupId) repeats.push({ ...item, uid: makeUid(), repeatGroupId: groupId })
    if (item.type !== "tts" || !content.includes(item)) continue
    repeats.push({ ...item, uid: makeUid(), repeatSourceUid: item.uid,
      repeatOfUid: mode === "original" ? item.uid : undefined,
      voiceId: mode === "male-female" ? voices.second : item.voiceId,
      audioId: mode === "original" ? item.audioId : undefined,
      audioUrl: mode === "original" ? item.audioUrl : undefined,
      generationMeta: mode === "original" ? item.generationMeta : undefined,
      status: mode === "original" && item.audioId ? "done" : "idle", error: "",
      directorNote: (item.directorNote || "").replace(/第\s*1\s*遍/g, "第2遍") + "\n第2遍。" })
  }
  base.splice(end + 1, 0, ...repeats)
  return base
}
