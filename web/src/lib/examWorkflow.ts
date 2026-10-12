import type { Segment } from "../types"

export function buildExamIntro(name: string) {
  const title = name.trim().replace(/^这里是\s*/, "").replace(/[。.!！]+$/, "")
  if (!title) return ""
  return `这里是${title}${/听力测试$/.test(title) ? "" : /听力$/.test(title) ? "测试" : /英语$/.test(title) ? "听力测试" : "英语听力测试"}。`
}

export function insertAfterSegment(input: Segment[], selectedUid: string | null, segment: Segment): Segment[] {
  const index = input.findIndex(item => item.uid === selectedUid)
  if (index < 0) return [...input, segment]
  const selected = input[index]
  const groupId = selected.type !== "music" ? selected.groupId : undefined
  const splitsGroup = groupId && input.slice(index + 1).some(item => item.type === "tts" && item.groupId === groupId)
  const result = input.map((item, itemIndex) => {
    if (!splitsGroup || item.type === "music" || item.groupId !== groupId) return item
    const nextGroup = itemIndex > index ? `${groupId}::after-${segment.uid}` : groupId
    if (item.type === "silence") return { ...item, groupId: nextGroup }
    return { ...item, groupId: nextGroup, audioId: undefined, audioUrl: undefined, status: "idle" as const, error: undefined, generationMeta: undefined }
  })
  result.splice(index + 1, 0, segment)
  return result
}
