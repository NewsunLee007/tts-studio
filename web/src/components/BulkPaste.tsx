import { useMemo, useRef, useState } from "react"
import { parseExamScript, type ExamDraftSegment } from "../lib/examScriptParser"
import { parseSegments, type ParseMode, type ParsedSegment } from "../lib/parseSegments"

type ApplyMode = "append" | "replace"
type InputMode = ParseMode | "exam"

type Props = {
  onApply: (segments: Array<ParsedSegment | ExamDraftSegment>, mode: ApplyMode) => void
  onAnalyze: (text: string, mode: ApplyMode) => void
  analyzing: boolean
  majorBreakMs: number
  minorBreakMs: number
  questionNumberGapMs: number
}

export function BulkPaste(props: Props) {
  const [text, setText] = useState("")
  const [mode, setMode] = useState<InputMode>("exam")
  const [applyMode, setApplyMode] = useState<ApplyMode>("append")
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const parsed = useMemo(() => {
    if (mode === "exam") return parseExamScript(text, { majorBreakMs: props.majorBreakMs, minorBreakMs: props.minorBreakMs, questionNumberGapMs: props.questionNumberGapMs })
    return parseSegments(text, mode)
  }, [text, mode, props.majorBreakMs, props.minorBreakMs, props.questionNumberGapMs])

  return (
    <section className="rightCard">
      <div className="cardHeadRow">
        <div className="cardHead">
          <div className="cardTitle">语音文稿处理</div>
        </div>
        <div className="cardActionsInline bulkActions">
          <button className="btnPrimary" type="button" onClick={() => props.onAnalyze(text, applyMode)} disabled={!text.trim() || props.analyzing}>
            {props.analyzing ? "拆分中…" : "按题生成片段"}
          </button>
          {mode === "exam" ? (
            <button
              className="btn"
              type="button"
              onClick={() => {
                const marker = "\n---\n"
                const el = textareaRef.current
                if (!el) {
                  setText((prev) => prev + marker)
                  return
                }
                const start = el.selectionStart || 0
                const end = el.selectionEnd || 0
                const next = text.slice(0, start) + marker + text.slice(end)
                setText(next)
                requestAnimationFrame(() => {
                  el.focus()
                  const pos = start + marker.length
                  el.setSelectionRange(pos, pos)
                })
              }}
              disabled={!text.trim()}
            >
              插入分块线
            </button>
          ) : null}
          <button className="btn" type="button" onClick={() => props.onApply(parsed, applyMode)} disabled={!parsed.length}>
            基础拆分
          </button>
          <button className="btnGhost" type="button" onClick={() => setText("")} disabled={!text.trim()}>
            清空
          </button>
        </div>
      </div>

      <textarea
        ref={textareaRef}
        className="pasteArea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"在此粘贴听力试卷脚本或文本…\n\n规则：M:/W:/A:/B:/男:/女: 会作为听力正文；A/B/C/D 选项、英文问句题干、答案行会自动过滤。\n\n提示：在需要手动分题的位置插入一行 ---（三个横线）。\n\n示例：\n1. M: Hello.\nW: Hi.\nA. At school.\nB. At home.\n---\n听下面一段对话，回答第2题。"}
        rows={10}
      />

      <div className="cardGrid bulkControlsGrid compactControls">
        <label className="field">
          <div className="label">拆分规则</div>
          <select value={mode} onChange={(e) => setMode(e.target.value as InputMode)}>
            <option value="exam">听力试卷（M/W/A/B + 旁白 + 10s/5s + 读两遍）</option>
            <option value="blank">空行分段</option>
            <option value="line">每行一段</option>
            <option value="dialogue">对白（Speaker: text）</option>
          </select>
        </label>

        <label className="field">
          <div className="label">应用方式</div>
          <select value={applyMode} onChange={(e) => setApplyMode(e.target.value as ApplyMode)}>
            <option value="append">追加到末尾</option>
            <option value="replace">覆盖当前列表</option>
          </select>
        </label>
      </div>
    </section>
  )
}
