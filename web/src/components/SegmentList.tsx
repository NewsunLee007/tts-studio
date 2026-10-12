import { useState } from "react"
import type { ProviderId, Segment, TtsSegment, VoicePreset, VoiceRoleKey } from "../types"
import { groupRepeatMode, isRepeat, repeatGroupLeader, type RepeatMode, type RepeatVoices } from "../lib/groupRepeat"

type Props = {
  provider: ProviderId
  segments: Segment[]
  selectedUid: string | null
  onSelect: (uid: string) => void
  onReorder: (fromUid: string, toUid: string) => void
  onAdd: (afterUid?: string) => void
  onClearAll: () => void
  voiceOptions: VoicePreset[]
  roleVoiceIds: Record<VoiceRoleKey, string>
  onRoleVoiceChange: (role: VoiceRoleKey, voiceId: string) => void
  onRepeatChange: (groupId: string, mode: RepeatMode, voices: RepeatVoices) => void
  recording: boolean
}

function summarize(seg: Segment) {
  if (seg.type === "silence") return `${seg.label ? `${seg.label} · ` : ""}无声 ${formatDuration(seg.durationMs)}`
  if (seg.type === "music") return `${seg.label || "导入音乐"} · ${formatDuration(musicDurationMs(seg.presetId, seg.durationMs))}`
  const text = seg.text.trim().replace(/\s+/g, " ")
  return text.length > 90 ? text.slice(0, 90) + "…" : text || "（空文本）"
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
    const groupId = seg.type === "tts" ? seg.groupId : undefined
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
  if (tts.length === 1 && tts[0].role === "male") return { label: "男声", className: "badgeTts" }
  if (tts.length === 1 && tts[0].role === "female") return { label: "女声", className: "badgeTts" }
  const nonQuestion = tts.filter((s) => !isQuestion(s))
  if (nonQuestion.some(isIntro)) return { label: "导入", className: "badgeIntro" }
  if (!nonQuestion.length && tts.length) {
    const text = tts.map((s) => s.text.trim()).join(" ")
    if (/^(?:Number|Test)\s+(?:\d+|[a-z]+(?:\s+[a-z]+)?)/i.test(text)) return { label: "题号", className: "badgeQuestion" }
    return { label: "说明", className: "badgeNarrator" }
  }
  if (nonQuestion.every((s) => s.role === "narrator" || s.role === "neutral")) return { label: "旁白", className: "badgeNarrator" }
  return { label: "小题", className: "badgeTts" }
}

function groupTitle(group: GeminiGroup) {
  if (group.segments.every((s) => s.type === "silence")) return summarize(group.segments[0])
  if (group.segments.every((s) => s.type === "music")) return summarize(group.segments[0])
  const tts = group.segments.filter(isTts)
  if (tts.length === 1) return summarize(tts[0])
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
  if (group.segments.length === 1) return ""
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

function voiceCandidates(voices: VoicePreset[], role: VoiceRoleKey) {
  const filtered =
    role === "male"
      ? voices.filter((voice) => voice.gender === "male")
      : role === "female"
        ? voices.filter((voice) => voice.gender === "female")
        : role === "question"
          ? voices.filter((voice) => voice.locale !== "zh-CN" && (voice.role === "question" || voice.role === "narrator" || voice.gender === "female"))
          : voices.filter((voice) => voice.locale === "zh-CN" || voice.role === "narrator")
  return filtered.length ? filtered : voices
}

export function SegmentList(props: Props) {
  const [voicesOpen, setVoicesOpen] = useState(false)
  const groups = groupForGemini(props.segments.map(segment => {
    if (segment.type !== "tts") return segment
    const source = segment.repeatOfUid ? props.segments.find(item => item.uid === segment.repeatOfUid) : undefined
    return { ...segment, groupId: undefined, audioId: segment.audioId || (source?.type === "tts" ? source.audioId : undefined) }
  }))
  const roleRules: Array<{ id: VoiceRoleKey; label: string }> = [
    { id: "narrator", label: "中文说明" },
    { id: "question", label: "英文题号" },
    { id: "male", label: "英语男声 M/A" },
    { id: "female", label: "英语女声 W/B" }
  ]
  return (
    <aside className="leftPane">
      <div className="leftHead">
        <div>
          <h2 className="leftTitle">片段 <small>{props.segments.length}</small></h2>
        </div>
        <div className="leftActions">
          <button className="btnGhost" type="button" onClick={() => props.onAdd()}>
            ＋ 添加
          </button>
          <button className="btnGhost" type="button" aria-expanded={voicesOpen} aria-controls="role-voice-panel" onClick={() => setVoicesOpen(value => !value)}>音色</button>
          <button className="btnGhost" type="button" onClick={props.onClearAll} disabled={!props.segments.length}>
            清空
          </button>
        </div>
      </div>

      {voicesOpen ? <div className="roleRules" id="role-voice-panel">
        <div className="roleRuleGrid">
          {roleRules.map((rule) => {
            const options = voiceCandidates(props.voiceOptions, rule.id)
            return (
              <label className="field" key={rule.id}>
                <div className="label">{rule.label}</div>
                <select
                  aria-label={rule.label}
                  value={props.roleVoiceIds[rule.id] || ""}
                  onChange={(event) => props.onRoleVoiceChange(rule.id, event.target.value)}
                  disabled={!options.length}
                >
                  {options.map((voice) => (
                    <option key={voice.id} value={voice.id}>{voice.label}</option>
                  ))}
                </select>
              </label>
            )
          })}
        </div>
        <div className="roleRulesHint">应用到当前及后续同类片段。</div>
      </div> : null}

      <div className="list" role="list" aria-label="录音片段">
        {groups.map((group, idx) => {
          const selected = group.segments.some((seg) => seg.uid === props.selectedUid)
          const cls = selected ? "listItem listItemActive" : "listItem"
          const kind = groupKind(group)
          const original = props.segments.find(item => item.uid === group.containerUid)
          const groupId = original && "groupId" in original ? original.groupId : undefined
          const leader = repeatGroupLeader(props.segments, groupId)
          const showRepeat = leader?.uid === original?.uid
          const repeatMode = groupId ? groupRepeatMode(props.segments, groupId) : "once"
          const maleVoices = props.voiceOptions.filter(voice => voice.gender === "male")
          const femaleVoices = props.voiceOptions.filter(voice => voice.gender === "female")
          const firstContent = props.segments.find((item): item is TtsSegment => item.type === "tts" && item.groupId === groupId && item.repeatVoiceMode === "male-female" && !isRepeat(item))
          const secondContent = props.segments.find((item): item is TtsSegment => item.type === "tts" && item.groupId === groupId && Boolean(item.repeatSourceUid))
          const repeatVoices = { first: firstContent?.voiceId || props.roleVoiceIds.male || maleVoices[0]?.id || "", second: repeatMode === "male-female" ? secondContent?.voiceId || "" : props.roleVoiceIds.female || femaleVoices[0]?.id || "" }
          return (
            <div
              key={group.key}
              className={cls}
              role="listitem"
              aria-current={selected ? "true" : undefined}
              tabIndex={0}
              onClick={() => props.onSelect(group.containerUid)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onSelect(group.containerUid) }
              }}
            >
              {showRepeat && groupId ? <div className="questionRepeat" onClick={event => event.stopPropagation()}>
                <label><span>本题朗读</span><select aria-label="本题朗读次数与音色" value={repeatMode} disabled={props.recording} onChange={event => props.onRepeatChange(groupId, event.target.value as RepeatMode, repeatVoices)}>
                  <option value="once">读一遍</option><option value="original">读两遍 · 沿用原声</option><option value="male-female" disabled={!maleVoices.length || !femaleVoices.length}>读两遍 · 先男后女</option>
                </select></label>
                {repeatMode === "male-female" ? <div className="repeatVoiceFields">{([ ["first", "第一遍 · 男声", maleVoices], ["second", "第二遍 · 女声", femaleVoices] ] as const).map(([pass, label, options]) => <label key={pass}><span>{label}</span><select aria-label={label} value={repeatVoices[pass]} disabled={props.recording} onChange={event => props.onRepeatChange(groupId, repeatMode, { ...repeatVoices, [pass]: event.target.value })}>{options.map(voice => <option key={voice.id} value={voice.id}>{voice.label}</option>)}</select></label>)}</div> : null}
                {repeatMode === "male-female" ? <small>两遍分别生成，按服务商用量计费。</small> : null}
              </div> : null}
              <div className="liTop">
                <div className="liIndex">#{idx + 1}</div>
                <div className={`badge ${kind.className}`}>{original?.type === "tts" && original.repeatVoiceMode ? isRepeat(original) ? "女声 · 第二遍" : "男声 · 第一遍" : kind.label + (original && isRepeat(original) ? " · 第二遍" : "")}</div>
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
              {selected ? <button className="insertAfterButton" type="button" onClick={event => { event.stopPropagation(); props.onAdd(group.containerUid) }}>＋ 在此后添加</button> : null}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
