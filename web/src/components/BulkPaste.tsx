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
  questionNumberStyle: "number" | "test"
}

const examPlaceholder = `请把完整的英语听力文稿粘贴到这里。系统会识别题号、旁白、男女角色和“读两遍”等要求，不会擅自加入学校、学年、考试名称或开场音乐。

示例：
第一节：听下面5段小对话，每段对话后有一个小题。每段对话仅读一遍。
1. M: Hi, Mary. How do you usually go to school?
W: I usually ride my bike, but today I took the bus because of the rain.
A. By bike.
B. By bus.
C. On foot.
---
第二节：听下面一段较长对话，回答第6至第7两个小题。对话读两遍。
M: Good morning. Can I help you?
W: Yes, please. I want to buy a sweater for my son.
M: What color does he like?
W: Blue. How much is this one?
M: It is fifty yuan.
---
第三节：听独白，从A、B、C三个选项中选出正确选项。独白读两遍。
Hello, welcome to our school radio station. Today we are going to meet a new friend, Fiona.
听力测试到此结束。`

export function BulkPaste(props: Props) {
  const [text, setText] = useState("")
  const [mode, setMode] = useState<InputMode>("exam")
  const [applyMode, setApplyMode] = useState<ApplyMode>("replace")
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const parsed = useMemo(() => {
    if (mode === "exam") return parseExamScript(text, { majorBreakMs: props.majorBreakMs, minorBreakMs: props.minorBreakMs, questionNumberGapMs: props.questionNumberGapMs, questionNumberStyle: props.questionNumberStyle })
    return parseSegments(text, mode)
  }, [text, mode, props.majorBreakMs, props.minorBreakMs, props.questionNumberGapMs, props.questionNumberStyle])

  return (
    <section className="rightCard">
      <div className="cardHeadRow">
        <div className="cardHead">
          <h2 className="cardTitle">第 1 步｜粘贴听力文稿</h2>
          <div className="cardSub">不会自动加入考试信息或开场音乐；题号和必要停顿会按原文结构生成。</div>
        </div>
        <div className="cardActionsInline bulkActions">
          <button className="btnPrimary" type="button" onClick={() => props.onAnalyze(text, applyMode)} disabled={!text.trim() || props.analyzing}>
            {props.analyzing ? "正在拆分…" : "拆分文稿"}
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
        placeholder={examPlaceholder}
        rows={10}
      />

      <details className="bulkAdvanced">
        <summary>更多拆分选项</summary>
        <div className="cardActionsInline advancedActions">
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
            简单拆分
          </button>
        </div>

        <div className="cardGrid bulkControlsGrid compactControls">
          <label className="field">
            <div className="label">拆分规则</div>
            <select aria-label="拆分规则" value={mode} onChange={(e) => setMode(e.target.value as InputMode)}>
              <option value="exam">听力试卷（推荐）</option>
              <option value="blank">按空行分段</option>
              <option value="line">每行一段</option>
              <option value="dialogue">按 Speaker: text 对白分段</option>
            </select>
          </label>

          <label className="field">
            <div className="label">应用方式</div>
            <select aria-label="应用方式" value={applyMode} onChange={(e) => setApplyMode(e.target.value as ApplyMode)}>
              <option value="replace">替换当前内容</option>
              <option value="append">追加到末尾</option>
            </select>
          </label>
        </div>
      </details>
    </section>
  )
}
