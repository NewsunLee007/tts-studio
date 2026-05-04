import type { ProviderId, Segment, TtsSegment } from "../types"

type Props = {
  provider: ProviderId
  segments: Segment[]
  selectedUid: string | null
  onSelect: (uid: string) => void
  onReorder: (fromUid: string, toUid: string) => void
  onAddTts: () => void
  onAddSilence: () => void
  onAddMusic: () => void
  onClearAll: () => void
}

function summarize(seg: Segment) {
  if (seg.type === "silence") return `${seg.label ? `${seg.label} · ` : ""}无声 ${formatDuration(seg.durationMs)}`
  if (seg.type === "music") return `${seg.label || "导入音乐"} · ${formatDuration(musicDurationMs(seg.presetId, seg.durationMs))}`
  const text = seg.text.trim().replace(/\s+/g, " ")
  return text.length > 44 ? text.slice(0, 44) + "…" : text || "（空文本）"
}

function musicDurationMs(presetId: string, fallbackMs: number) {
  if (presetId === "ding") return 1730
  if (presetId === "piano") return 13720
  return fallbackMs
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes && seconds) return `${minutes}分${seconds}秒`
  if (minutes) return `${minutes}分钟`
  return `${seconds}秒`
}

function normalizeOneLine(text: string) {
  return text.trim().replace(/\s+/g, " ")
}

function truncate(text: string, max = 54) {
  const normalized = normalizeOneLine(text)
  return normalized.length > max ? normalized.slice(0, max) + "…" : normalized
}

function rangeTitleFromGroupId(groupId?: string) {
  if (!groupId) return ""
  const range = groupId.match(/^q-(\d+)(?:-(\d+))?$/)
  if (!range) return ""
  const start = Number(range[1])
  const end = range[2] ? Number(range[2]) : start
  if (!Number.isFinite(start)) return ""
  if (!Number.isFinite(end) || end === start) return `第${start}题`
  return `第${start}至${end}题`
}

type GeminiGroup = {
  key: string
  groupId?: string
  segments: Segment[]
  containerUid: string
}

function isTts(seg: Segment): seg is TtsSegment {
  return seg.type === "tts"
}

function isQuestion(seg: TtsSegment) {
  return seg.role === "question" || seg.stylePresetId === "question_marker"
}

function isIntro(seg: TtsSegment) {
  const text = seg.text.trim()
  return seg.role === "intro" || seg.label === "考试介绍" || /听力测试[。.!！]?$/i.test(text)
}

function groupForGemini(input: Segment[]) {
  const groups: GeminiGroup[] = []
  let currentKey = ""
  for (const [index, seg] of input.entries()) {
    const groupId = seg.type === "tts" || seg.type === "silence" ? seg.groupId : undefined
    const groupKey = groupId ? `g:${groupId}` : `u:${seg.uid}`
    const key = `${groupKey}:${index}`
    if (groupKey !== currentKey) {
      currentKey = groupKey
      groups.push({ key, groupId, segments: [seg], containerUid: seg.uid })
    } else {
      groups[groups.length - 1].segments.push(seg)
    }
  }
  return groups.map((g) => {
    const tts = g.segments.filter(isTts)
    const container = tts.find((s) => !isQuestion(s) && !s.repeatOfUid) || tts.find((s) => !isQuestion(s)) || tts[0]
    return { ...g, containerUid: container?.uid || g.segments[0]?.uid || g.containerUid }
  })
}

function groupStatusLabel(group: GeminiGroup) {
  if (group.segments.every((s) => s.type === "silence")) return "无声"
  if (group.segments.every((s) => s.type === "music")) return "音乐"
  const allTts = group.segments.filter(isTts)
  const nonQuestion = allTts.filter((s) => !isQuestion(s))
  const tts = nonQuestion.length ? nonQuestion : allTts
  if (tts.some((s) => s.status === "error")) return "失败"
  if (tts.some((s) => s.status === "generating")) return "生成中"
  if (tts.some((s) => s.status === "queued")) return "等待"
  if (tts.some((s) => s.audioId || s.status === "done")) return "已就绪"
  if (tts.some((s) => s.status === "skipped")) return "跳过"
  return "未生成"
}

function groupStatusTone(group: GeminiGroup) {
  if (group.segments.every((s) => s.type === "silence")) return "statusMuted"
  if (group.segments.every((s) => s.type === "music")) return "statusMusic"
  const allTts = group.segments.filter(isTts)
  const nonQuestion = allTts.filter((s) => !isQuestion(s))
  const tts = nonQuestion.length ? nonQuestion : allTts
  if (tts.some((s) => s.status === "error")) return "statusError"
  if (tts.some((s) => s.status === "queued" || s.status === "generating")) return "statusBusy"
  if (tts.some((s) => s.status === "skipped")) return "statusMuted"
  if (tts.some((s) => s.audioId || s.status === "done")) return "statusReady"
  return "statusDraft"
}

function groupKind(group: GeminiGroup) {
  if (group.segments.every((s) => s.type === "silence")) return { label: "停顿", className: "badgeSilence" }
  if (group.segments.every((s) => s.type === "music")) return { label: "音乐", className: "badgeMusic" }
  const tts = group.segments.filter(isTts)
  const nonQuestion = tts.filter((s) => !isQuestion(s))
  if (nonQuestion.some(isIntro)) return { label: "导入", className: "badgeIntro" }
  if (!nonQuestion.length && tts.length) {
    const text = tts.map((s) => s.text.trim()).join(" ")
    if (/^(?:Number|Test)\s+\d+/i.test(text)) return { label: "题号", className: "badgeQuestion" }
    return { label: "说明", className: "badgeNarrator" }
  }
  if (nonQuestion.every((s) => s.role === "narrator" || s.role === "neutral")) return { label: "旁白", className: "badgeNarrator" }
  return { label: "小题", className: "badgeTts" }
}

function groupTitle(group: GeminiGroup) {
  if (group.segments.every((s) => s.type === "silence")) return summarize(group.segments[0])
  if (group.segments.every((s) => s.type === "music")) return summarize(group.segments[0])
  const tts = group.segments.filter(isTts)
  if (tts.some(isIntro)) return "听力导入"
  const rangeTitle = rangeTitleFromGroupId(group.groupId)
  if (rangeTitle) return rangeTitle
  const question = tts.find((s) => isQuestion(s))
  if (question?.text?.trim()) return truncate(question.text, 44)
  const narrator = tts.find((s) => s.role === "narrator" || s.role === "neutral")
  if (narrator?.label && narrator.label !== "旁白") return narrator.label
  const container = tts.find((s) => !isQuestion(s) && !s.repeatOfUid) || tts[0]
  return container ? summarize(container) : "片段"
}

function groupSummary(group: GeminiGroup) {
  if (group.segments.every((s) => s.type === "silence") || group.segments.every((s) => s.type === "music")) return ""
  const tts = group.segments.filter(isTts).filter((s) => !isQuestion(s) && !s.repeatOfUid && s.status !== "skipped")
  if (!tts.length) return ""
  const text = tts
    .slice(0, 3)
    .map((item) => {
      const role = item.role === "female" ? "W" : item.role === "male" ? "M" : ""
      return `${role ? `${role}: ` : ""}${item.text.trim()}`
    })
    .join(" / ")
    .replace(/\s+/g, " ")
  const summary = truncate(text)
  const title = groupTitle(group)
  if (normalizeOneLine(title) === normalizeOneLine(summary)) return ""
  if (normalizeOneLine(summary).startsWith(normalizeOneLine(title))) return ""
  return summary
}

export function SegmentList(props: Props) {
  const groups = groupForGemini(props.segments)
  return (
    <aside className="leftPane">
      <div className="leftHead">
        <div className="leftTitle">语音片段选择</div>
        <div className="leftActions">
          <button className="btnGhost" type="button" onClick={props.onAddTts}>
            + TTS
          </button>
          <button className="btnGhost" type="button" onClick={props.onAddSilence}>
            + 无声
          </button>
          <button className="btnGhost" type="button" onClick={props.onAddMusic}>
            + 音乐
          </button>
          <button className="btnGhost" type="button" onClick={props.onClearAll} disabled={!props.segments.length}>
            清空
          </button>
        </div>
      </div>

      <div className="list" role="listbox" aria-label="segments">
        {groups.map((group, idx) => {
          const selected = group.segments.some((seg) => seg.uid === props.selectedUid)
          const cls = selected ? "listItem listItemActive" : "listItem"
          const kind = groupKind(group)
          return (
            <div
              key={group.key}
              className={cls}
              role="option"
              aria-selected={selected}
              tabIndex={0}
              onClick={() => props.onSelect(group.containerUid)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") props.onSelect(group.containerUid)
              }}
            >
              <div className="liTop">
                <div className="liIndex">#{idx + 1}</div>
                <div className={`badge ${kind.className}`}>{kind.label}</div>
                <div className={`status ${groupStatusTone(group)}`}>{groupStatusLabel(group)}</div>
              </div>
              <div className="liMain">
                <span className="summary">{groupTitle(group)}</span>
              </div>
              {groupSummary(group) ? (
                <div className="liMain">
                  <span className="summary">{groupSummary(group)}</span>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
