import type { PacePresetId, StylePresetId } from "./presets.js"

export type ExamTemplate = {
  school?: string
  schoolYear?: string
  semester?: string
  examName?: string
  subject?: string
  grade?: string
  examType?: string
  includeIntroMusic?: boolean
  introMusicPreset?: "warmup" | "bell" | "soft" | "piano"
  includeExamIntro?: boolean
  includeQuestionNumbers?: boolean
  questionNumberStyle?: "number" | "test"
  majorBreakMs?: number
  minorBreakMs?: number
  questionNumberGapMs?: number
  englishWordsPerMinute?: number
  chineseCharsPerMinute?: number
}

export type AnalyzedSegment =
  | {
      type: "tts"
      text: string
      label?: string
      role: "intro" | "question" | "narrator" | "male" | "female" | "neutral"
      groupId?: string
      directorNote?: string
      emotion?: string
      pacePreset: PacePresetId
      stylePresetId: StylePresetId
    }
  | { type: "silence"; durationMs: number; label?: string; groupId?: string }
  | { type: "music"; presetId: "warmup" | "bell" | "soft" | "piano" | "ding"; durationMs: number; label?: string; groupId?: string }

type SpeakerTag = "M" | "W" | "A" | "B" | "NARRATOR"
type DialogueSpeakerTag = Exclude<SpeakerTag, "NARRATOR">

type DraftSegment =
  | { type: "tts"; speakerTag: SpeakerTag; text: string; label?: string; groupId?: string; directorNote?: string }
  | { type: "silence"; durationMs: number; label?: string; groupId?: string; directorNote?: string }
  | { type: "music"; presetId: "warmup" | "bell" | "soft" | "piano" | "ding"; durationMs: number; label?: string; groupId?: string }

type SpeakerLine = {
  number?: number
  speakerTag: DialogueSpeakerTag
  text: string
}

type SectionPlan = {
  id: string
  label: string
  qStart?: number
  qEnd?: number
  repeatCount: 1 | 2
  preReadMsPerQuestion: number
  answerMsPerQuestion: number
  perItemAnswerMs: number
  mode: "short-dialogues" | "long-dialogue" | "monologue" | "general"
}

type DialogueBlock = {
  groupId: string
  label: string
  qStart?: number
  qEnd?: number
  repeatCount: 1 | 2
  preReadMs: number
  answerMs: number
  lines: Array<{ speakerTag: SpeakerTag; text: string; label: string }>
}

type AudioTextChunk = {
  text: string
  language: "zh" | "en" | "mixed"
}

const defaultPlan: SectionPlan = {
  id: "exam",
  label: "听力材料",
  repeatCount: 1,
  preReadMsPerQuestion: 0,
  answerMsPerQuestion: 0,
  perItemAnswerMs: 0,
  mode: "general"
}

const cnDigit: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10
}

function normalize(input: string) {
  return input.replace(/\r\n/g, "\n").replace(/\t/g, "  ")
}

function isIndented(line: string) {
  return /^[ \t]+/.test(line)
}

function cnToNumber(raw: string | undefined) {
  if (!raw) return undefined
  const value = raw.trim()
  const leadingNumber = value.match(/^\d+/)
  if (leadingNumber) return Number(leadingNumber[0])
  if (/^\d+$/.test(value)) return Number(value)
  if (value === "十") return 10
  if (value.startsWith("十")) return 10 + (cnDigit[value.slice(1)] || 0)
  if (value.endsWith("十")) return (cnDigit[value.slice(0, -1)] || 0) * 10
  if (value.includes("十")) {
    const [tens, ones] = value.split("十")
    return (cnDigit[tens] || 1) * 10 + (cnDigit[ones] || 0)
  }
  return cnDigit[value]
}

function formatRange(start?: number, end?: number) {
  if (!start) return ""
  if (!end || end === start) return `第${start}题`
  return `第${start}至${end}题`
}

function groupIdFor(start?: number, end?: number, fallback = "section") {
  if (start && end && start !== end) return `q-${start}-${end}`
  if (start) return `q-${start}`
  return fallback
}

function questionCount(start?: number, end?: number) {
  if (!start) return 1
  if (!end) return 1
  return Math.max(1, end - start + 1)
}

function parseSpeakerLine(line: string): SpeakerLine | null {
  const m = line.match(/^\s*(?:(\d+)[.、)]\s*)?(M|W|A|B|Man|Woman|男|女|男士|女士)\s*[:：]\s*(.+)\s*$/i)
  if (!m) return null
  const rawTag = m[2].trim().toLowerCase()
  const speakerTag: DialogueSpeakerTag = rawTag === "w" || rawTag === "b" || rawTag === "woman" || rawTag.startsWith("女") ? "W" : rawTag === "a" ? "A" : "M"
  return {
    number: m[1] ? Number(m[1]) : undefined,
    speakerTag,
    text: m[3].trim()
  }
}

function isSectionLine(line: string) {
  const text = line.trim()
  if (/^(?:第[一二三四五六七八九十0-9]+节[:：]?|听下面|下面请听|请听下面)/.test(text)) return true
  return /^听(?:第?[一二两三四五六七八九十0-9]+|另|下|上)?(?:一|二|三|四|五|六|七|八|九|十)?(?:段|篇)?(?:较长)?(?:对话|独白|材料)/.test(text) && Boolean(parseQuestionRange(text).start)
}

function isManualBoundary(line: string) {
  return /^(?:-{3,}|={3,}|#{3,})$/.test(line.trim())
}

function hasChinese(line: string) {
  return /[\u3400-\u9fff]/.test(line)
}

function hasEnglish(line: string) {
  return /[A-Za-z]/.test(line)
}

function languageOf(line: string): AudioTextChunk["language"] {
  const zh = hasChinese(line)
  const en = hasEnglish(line)
  if (zh && !en) return "zh"
  if (en && !zh) return "en"
  return "mixed"
}

function isClosingAnnouncement(line: string) {
  return /(?:听力(?:测试|部分|考试)?到此结束|听力材料播放完毕|This\s+is\s+the\s+end\s+of\s+the\s+listening\s+test)/i.test(line.trim())
}

function splitMixedLanguageAudioLine(line: string): AudioTextChunk[] {
  const text = line.trim()
  if (!text) return []
  if (!hasChinese(text) || !hasEnglish(text)) return [{ text, language: languageOf(text) }]

  const sentences = text.match(/[^。！？!?；;.]+[。！？!?；;.]?/g) || [text]
  const chunks: AudioTextChunk[] = []
  for (const sentence of sentences) {
    const trimmed = sentence.trim()
    if (!trimmed) continue
    const language = languageOf(trimmed)
    const last = chunks[chunks.length - 1]
    if (last && last.language === language && !isClosingAnnouncement(trimmed)) {
      last.text = `${last.text} ${trimmed}`.trim()
    } else {
      chunks.push({ text: trimmed, language })
    }
  }
  return chunks
}

function isChoiceLine(line: string) {
  return /^(?:选项\s*)?[A-D][.、):：]\s*\S+/i.test(line.trim())
}

function isAnswerKeyLine(line: string) {
  return /^(?:参考答案|答案|听力答案|Answer\s+key|Answers?)\b/i.test(line.trim())
}

function isPrintedQuestionLine(line: string) {
  const text = line.trim()
  if (/^\d+\s*[.、)]\s*(?:What|Where|When|Why|How|Who|Which|Whose|Whom|Can|Could|Would|Will|Is|Are|Do|Does|Did|Has|Have|Was|Were)\b/i.test(text)) return true
  if (/^(?:Questions?|Q)\s*\d+/i.test(text)) return true
  if (/^(?:第\s*)?\d+\s*[.、)]\s*.+[?？]$/.test(text)) return true
  if (/^第\s*[0-9一二两三四五六七八九十]+\s*题\s*[:：]?.+[?？]$/.test(text)) return true
  return false
}

function shouldSkipNonAudioLine(line: string) {
  return isChoiceLine(line) || isAnswerKeyLine(line) || isPrintedQuestionLine(line)
}

function parseQuestionRange(line: string) {
  const range = line.match(/第\s*([0-9一二两三四五六七八九十]+)\s*(?:和|至|到|-|－|—)\s*(?:第)?\s*([0-9一二两三四五六七八九十]+)/)
  if (range) {
    const start = cnToNumber(range[1])
    const end = cnToNumber(range[2])
    if (start) return { start, end: end || start }
  }

  const completed = line.match(/完成第\s*([0-9一二两三四五六七八九十]+)\s*题/)
  if (completed) {
    const start = cnToNumber(completed[1])
    if (start) return { start, end: start }
  }

  const dash = line.match(/\b(\d+)\s*[-－—]\s*(\d+)\b/)
  if (dash) return { start: Number(dash[1]), end: Number(dash[2]) }

  const single = line.match(/第\s*([0-9一二两三四五六七八九十]+)\s*(?:个小题|题)/)
  if (single) {
    const start = cnToNumber(single[1])
    if (start) return { start, end: start }
  }

  const pair = line.match(/回答\s*(?:第\s*)?([0-9一二两三四五六七八九十]+)\s*(?:,|，|、|和)\s*(?:第\s*)?([0-9一二两三四五六七八九十]+)/)
  if (pair) {
    const start = cnToNumber(pair[1])
    const end = cnToNumber(pair[2])
    if (start && end) return { start: Math.min(start, end), end: Math.max(start, end) }
  }

  return {}
}

function detectRepeatCount(line: string): 1 | 2 {
  if (/仅读一遍|只读一遍|读一遍|读1遍/.test(line)) return 1
  if (/读两遍|读2遍|读两次/.test(line)) return 2
  return 1
}

function detectMode(line: string): SectionPlan["mode"] {
  if (/较长对话|长对话/.test(line)) return "long-dialogue"
  if (/独白/.test(line)) return "monologue"
  if (/段对话/.test(line)) return "short-dialogues"
  return "general"
}

function detectTiming(line: string, mode: SectionPlan["mode"]) {
  const everyQuestion = line.match(/每小题\s*([0-9]+)\s*秒/)
  const hasQuestionReadTime = /阅读各小题|读题/.test(line)
  const hasAnswerTime = /作答时间|回答有关小题|回答时间/.test(line)
  const fixedAnswer = line.match(/(?:都有|有)\s*([0-9]+)\s*秒(?:钟)?(?:的时间)?(?:来)?(?:回答|作答|阅读下一小题)?/)

  return {
    preReadMsPerQuestion: everyQuestion && hasQuestionReadTime ? Number(everyQuestion[1]) * 1000 : mode === "monologue" ? 5000 : 0,
    answerMsPerQuestion: everyQuestion && hasAnswerTime ? Number(everyQuestion[1]) * 1000 : mode === "monologue" ? 5000 : 0,
    perItemAnswerMs: fixedAnswer ? Number(fixedAnswer[1]) * 1000 : mode === "short-dialogues" && /每段对话后有一个小题/.test(line) ? 10000 : 0
  }
}

function instructionText(line: string) {
  return line.trim()
}

function buildPlan(line: string, previous: SectionPlan, sectionIndex: number): SectionPlan {
  const mode = detectMode(line)
  const range = parseQuestionRange(line)
  const timing = detectTiming(line, mode)
  const repeatCount = /读两遍|读2遍|读两次|仅读一遍|只读一遍|读一遍|读1遍/.test(line) ? detectRepeatCount(line) : previous.repeatCount

  return {
    id: `section-${sectionIndex}`,
    label: formatRange(range.start, range.end) || (mode === "long-dialogue" ? "较长对话" : mode === "monologue" ? "独白" : mode === "short-dialogues" ? "短对话" : "听力材料"),
    qStart: range.start,
    qEnd: range.end,
    repeatCount,
    preReadMsPerQuestion: timing.preReadMsPerQuestion || (mode === previous.mode ? previous.preReadMsPerQuestion : 0),
    answerMsPerQuestion: timing.answerMsPerQuestion || (mode === previous.mode ? previous.answerMsPerQuestion : 0),
    perItemAnswerMs: timing.perItemAnswerMs || (mode === previous.mode ? previous.perItemAnswerMs : 0),
    mode
  }
}

function mergeLines(input: string) {
  const merged: string[] = []
  for (const rawLine of normalize(input).split("\n")) {
    const line = rawLine.trimEnd()
    if (!line.trim()) continue

    if (isManualBoundary(line)) {
      merged.push(line.trim())
      continue
    }

    const prev = merged[merged.length - 1]
    if (prev && isIndented(line) && parseSpeakerLine(prev) && !parseSpeakerLine(line) && !isSectionLine(line)) {
      merged[merged.length - 1] = `${prev} ${line.trim()}`
      continue
    }

    if (prev && !isSectionLine(line) && !parseSpeakerLine(line) && parseSpeakerLine(prev)) {
      merged[merged.length - 1] = `${prev} ${line.trim()}`
      continue
    }

    merged.push(line.trim())
  }
  return merged
}

function questionMarkerText(number: number, style: "number" | "test") {
  return `${style === "test" ? "Test" : "Number"} ${number}`
}

function musicPresetDurationMs(presetId: "ding" | "piano") {
  return presetId === "ding" ? 1730 : 13720
}

function introMusicDurationMs(presetId: ExamTemplate["introMusicPreset"]) {
  return presetId === "piano" ? musicPresetDurationMs("piano") : 3500
}

function parseStructuredExamScript(input: string, includeQuestionNumbers: boolean, options: { majorBreakMs?: number; minorBreakMs?: number; questionNumberGapMs?: number; questionNumberStyle?: "number" | "test" } = {}): DraftSegment[] {
  const out: DraftSegment[] = []
  const lines = mergeLines(input)
  let currentPlan = defaultPlan
  let sectionIndex = 0
  let block: DialogueBlock | null = null
  let freeformIndex = 0
  let freeformGroupId = currentPlan.id
  let narrationIndex = 0
  let pendingInstructionGapMs = 0
  let lastFlushEndedWithPause = false
  const majorBreakMs = Math.max(0, options.majorBreakMs ?? 10000)
  const minorBreakMs = Math.max(0, options.minorBreakMs ?? 5000)
  const questionNumberGapMs = Math.max(0, options.questionNumberGapMs ?? 1000)
  const questionNumberStyle = options.questionNumberStyle === "test" ? "test" : "number"

  const pushSilence = (durationMs: number, label: string, groupId: string, note: string) => {
    if (durationMs > 0) out.push({ type: "silence", durationMs, label, groupId, directorNote: note })
  }

  const consumeInstructionGap = (durationMs = pendingInstructionGapMs, label = "题干后间隔") => {
    const safeDuration = Math.max(0, durationMs)
    if (safeDuration > 0) pushSilence(safeDuration, label, currentPlan.id, "中文题目要求之后的过渡停顿")
    pendingInstructionGapMs = 0
  }

  const flushBlock = () => {
    if (!block || !block.lines.length) {
      block = null
      lastFlushEndedWithPause = false
      return false
    }

    if (block.preReadMs > 0) {
      pushSilence(block.preReadMs, "读题时间", block.groupId, `${block.label} 读题停顿`)
    }

    for (const line of block.lines) {
      const turnNote =
        line.speakerTag === "M" || line.speakerTag === "A"
          ? "多角色对话中的一个轮次，按后台角色标记锁定性别，不要根据上下文自行改性别。本句后台角色标记：Male。必须使用男声说这一句。"
          : line.speakerTag === "W" || line.speakerTag === "B"
            ? "多角色对话中的一个轮次，按后台角色标记锁定性别，不要根据上下文自行改性别。本句后台角色标记：Female。必须使用女声说这一句。"
            : "独白正文第1遍；使用稳定清晰的考试听力旁白，不要加入题目要求或选项内容。"
      out.push({
        type: "tts",
        speakerTag: line.speakerTag,
        text: line.text,
        label: line.label,
        groupId: block.groupId,
        directorNote: `${block.label} 第1遍；${turnNote}`
      })
    }

    if (block.repeatCount === 2) {
      pushSilence(1200, "重读间隔", block.groupId, `${block.label} 两遍之间的短停顿`)
      for (const line of block.lines) {
        const turnNote =
          line.speakerTag === "M" || line.speakerTag === "A"
            ? "复用第1遍的角色分配和性别分配。本句后台角色标记：Male。必须使用男声说这一句。"
            : line.speakerTag === "W" || line.speakerTag === "B"
              ? "复用第1遍的角色分配和性别分配。本句后台角色标记：Female。必须使用女声说这一句。"
              : "独白正文第2遍；复用第1遍的旁白声音、语速和音量。"
        out.push({
          type: "tts",
          speakerTag: line.speakerTag,
          text: line.text,
          label: line.label,
          groupId: block.groupId,
          directorNote: `${block.label} 第2遍；${turnNote}`
        })
      }
    }

    if (block.answerMs > 0) {
      pushSilence(block.answerMs, "作答时间", block.groupId, `${block.label} 作答停顿`)
    }

    lastFlushEndedWithPause = block.answerMs > 0
    block = null
    return true
  }

  const startBlock = (qStart?: number, qEnd?: number, fallbackId?: string) => {
    const count = questionCount(qStart, qEnd)
    const rangeLabel = formatRange(qStart, qEnd) || currentPlan.label
    const preReadMs = currentPlan.preReadMsPerQuestion * count
    if (preReadMs > 0) pendingInstructionGapMs = 0
    else consumeInstructionGap()
    const nextBlock: DialogueBlock = {
      groupId: groupIdFor(qStart, qEnd, fallbackId || currentPlan.id),
      label: rangeLabel,
      qStart,
      qEnd,
      repeatCount: currentPlan.repeatCount,
      preReadMs,
      answerMs: currentPlan.perItemAnswerMs || currentPlan.answerMsPerQuestion * count,
      lines: []
    }
    block = nextBlock
    return nextBlock
  }

  const pushStandaloneNarration = (text: string, label = "旁白", groupId?: string, directorNote?: string) => {
    narrationIndex += 1
    out.push({
      type: "tts",
      speakerTag: "NARRATOR",
      text,
      label,
      groupId: groupId || `${currentPlan.id}::narration-${narrationIndex}`,
      directorNote: directorNote || "考试旁白，清晰说明要求，避免口语化。"
    })
  }

  const pushFreeformLine = (text: string, label = "旁白") => {
    for (const chunk of splitMixedLanguageAudioLine(text)) {
      const range = parseQuestionRange(chunk.text)
      if (isClosingAnnouncement(chunk.text)) {
        flushBlock()
        pushSilence(5000, "结束前停顿", `${currentPlan.id}::pre-closing`, "考试结束播报前保留 5 秒静音。")
        pushStandaloneNarration(chunk.text, "考试结束", `${currentPlan.id}::closing`, "考试结束提示，中文标准普通话，简短、清楚、不要与前一段英文连读。")
        continue
      }
      if (currentPlan.mode === "monologue" && chunk.language === "en") {
        const activeBlock = block || startBlock(currentPlan.qStart, currentPlan.qEnd, `${currentPlan.id}-monologue`)
        activeBlock.lines.push({ speakerTag: "NARRATOR", text: chunk.text, label: "旁白" })
        continue
      }
      flushBlock()
      pushStandaloneNarration(
        chunk.text,
        formatRange(range.start, range.end) || label,
        groupIdFor(range.start, range.end, `${currentPlan.id}::narration-${narrationIndex + 1}`),
        chunk.language === "zh"
          ? "中文考试旁白，使用标准普通话单独播报，不要接在英文正文后面。"
          : "考试旁白，清晰说明要求，避免口语化。"
      )
    }
  }

  for (const line of lines) {
    if (isManualBoundary(line)) {
      const had = flushBlock()
      if (had) pushSilence(minorBreakMs, "分块间隔", currentPlan.id, "手动分块间隔")
      freeformIndex += 1
      freeformGroupId = `${currentPlan.id}-manual-${freeformIndex}`
      continue
    }

    const speaker = parseSpeakerLine(line)

    if (!speaker && shouldSkipNonAudioLine(line)) {
      continue
    }

    if (!speaker && isSectionLine(line)) {
      flushBlock()
      const hadPendingInstructionGap = pendingInstructionGapMs > 0
      if (hadPendingInstructionGap) consumeInstructionGap(1000, "说明间隔")
      sectionIndex += 1
      if (!hadPendingInstructionGap && sectionIndex > 1) pushSilence(majorBreakMs, "大题间隔", `section-gap-${sectionIndex}`, "大题或题组之间的全局间隔")
      currentPlan = buildPlan(line, currentPlan, sectionIndex)
      freeformIndex = 0
      freeformGroupId = currentPlan.id
      narrationIndex = 0
      const text = instructionText(line)
      if (text) {
        out.push({
          type: "tts",
          speakerTag: "NARRATOR",
          text,
          label: currentPlan.label,
          groupId: `${currentPlan.id}::instruction`,
          directorNote: "考试大题说明，完整播报原题干，同时根据其中的读题、作答和朗读次数信息安排停顿。"
        })
        pendingInstructionGapMs = 3000
      }
      continue
    }

    if (speaker) {
      let activeBlock: DialogueBlock
      if (speaker.number) {
        const hadPreviousQuestion = flushBlock()
        if (hadPreviousQuestion && !lastFlushEndedWithPause) pushSilence(minorBreakMs, "小题间隔", currentPlan.id, "小题之间的全局间隔")
        activeBlock = startBlock(speaker.number, speaker.number)
        if (includeQuestionNumbers) {
          const numberGroupId = `${activeBlock.groupId}::number`
          const markerText = questionMarkerText(speaker.number, questionNumberStyle)
          out.push({
            type: "music",
            presetId: "ding",
            durationMs: musicPresetDurationMs("ding"),
            label: "题号提示音",
            groupId: numberGroupId
          })
          out.push({
            type: "tts",
            speakerTag: "NARRATOR",
            text: markerText,
            label: markerText,
            groupId: numberGroupId,
            directorNote: "题号提示，短促、清楚、语调稳定。"
          })
          pushSilence(questionNumberGapMs, "题号间隔", activeBlock.groupId, `${markerText} 后短停顿`)
        }
      } else {
        activeBlock = block || startBlock(currentPlan.qStart, currentPlan.qEnd, freeformGroupId)
      }

      activeBlock.lines.push({ speakerTag: speaker.speakerTag, text: speaker.text, label: speaker.speakerTag })
      continue
    }

    if (currentPlan.mode === "monologue") {
      pushFreeformLine(line)
      continue
    }

    pushFreeformLine(line)
  }

  flushBlock()
  return out.filter((s) => (s.type === "tts" ? Boolean(s.text.trim()) : s.durationMs > 0))
}

function examIntro(template: ExamTemplate) {
  const year = template.schoolYear || "2025 学年"
  const semester = template.semester || "第二学期"
  const examName = template.examName || template.examType || "期中考试"
  const subject = template.subject || "英语"
  const grade = template.grade ? `${template.grade} ` : ""
  const school = template.school ? `${template.school} ` : ""
  return `这里是${school}${year}${semester}${grade}${examName}${subject}听力测试。`
}

function speakerRole(tag?: string): "male" | "female" | "narrator" | "neutral" {
  if (tag === "M" || tag === "A") return "male"
  if (tag === "W" || tag === "B") return "female"
  if (tag === "NARRATOR") return "narrator"
  return "neutral"
}

function toAnalyzedSegment(item: DraftSegment): AnalyzedSegment {
  if (item.type === "music") return { type: "music", presetId: item.presetId, durationMs: item.durationMs, label: item.label, groupId: item.groupId }
  if (item.type === "silence") return { type: "silence", durationMs: item.durationMs, label: item.label, groupId: item.groupId }

  const question = /^(?:Number|Test)\s+\d+/i.test(item.text.trim())
  const role = question ? "question" : item.speakerTag === "NARRATOR" && hasChinese(item.text) ? "intro" : speakerRole(item.speakerTag)
  const stylePresetId: StylePresetId = question ? "question_marker" : role === "narrator" ? "teacher" : role === "intro" ? "exam_host" : "dialogue"
  const pacePreset: PacePresetId = role === "narrator" || role === "intro" || role === "question" ? "exam_slow" : "exam_standard"
  const baseNote =
    role === "male"
      ? "性别锁定：Male。该句只能由男声角色朗读；与 Female 轮次保持清楚区分，不能串用女声。"
      : role === "female"
        ? "性别锁定：Female。该句只能由女声角色朗读；与 Male 轮次保持清楚区分，不能串用男声。"
        : question
          ? "只读题号，短促、清楚，中性播报；题号片段之间保持完全一致的语调和节奏。"
          : "考试旁白，清晰说明要求，保持稳定节奏；每次重生成也保持同一播报身份、音高和能量。"

  return {
    type: "tts",
    text: item.text,
    label: item.label || (question ? item.text : item.speakerTag === "NARRATOR" ? "旁白" : item.speakerTag),
    role,
    groupId: item.groupId,
    directorNote: [item.directorNote, baseNote].filter(Boolean).join("\n"),
    emotion: role === "narrator" || role === "question" ? "neutral" : "conversational",
    pacePreset,
    stylePresetId
  }
}

export function analyzeExamScript(input: string, template: ExamTemplate): AnalyzedSegment[] {
  const segments: AnalyzedSegment[] = []

  if (template.includeIntroMusic !== false) {
    const introPreset = template.introMusicPreset || "warmup"
    segments.push({ type: "music", presetId: introPreset, durationMs: introMusicDurationMs(introPreset), label: introPreset === "piano" ? "钢琴曲导入音乐" : "导入音乐" })
  }

  if (template.includeExamIntro !== false) {
    const groupId = "exam-intro"
    segments.push({
      type: "tts",
      text: examIntro(template),
      label: "考试介绍",
      role: "intro",
      groupId,
      directorNote: "中文播报：正式、清晰、语速偏慢，像标准普通话考试播音开场；每次重生成也保持同一播报身份、音高和能量。",
      emotion: "formal",
      pacePreset: "exam_slow",
      stylePresetId: "exam_host"
    })
    segments.push({ type: "silence", durationMs: 1200, label: "介绍间隔", groupId })
  }

  const draft = parseStructuredExamScript(input, template.includeQuestionNumbers !== false, {
    majorBreakMs: template.majorBreakMs,
    minorBreakMs: template.minorBreakMs,
    questionNumberGapMs: template.questionNumberGapMs,
    questionNumberStyle: template.questionNumberStyle
  })
  return [...segments, ...draft.map(toAnalyzedSegment)]
}
