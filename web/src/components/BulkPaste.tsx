import { useMemo, useRef, useState } from "react"
import { parseExamScript, type ExamDraftSegment } from "../lib/examScriptParser"
import { parseSegments, type ParseMode, type ParsedSegment } from "../lib/parseSegments"

type ApplyMode = "append" | "replace"
type InputMode = ParseMode | "exam"

type Props = {
  onApply: (segments: Array<ParsedSegment | ExamDraftSegment>, mode: ApplyMode) => void
  onAnalyze: (text: string, mode: ApplyMode, smart: boolean) => void
  onCreateAudio: (text: string, mode: ApplyMode, smart: boolean) => void
  analyzing: boolean
  workflowStage: "idle" | "analyzing" | "ready" | "generating" | "compose-pending" | "composing" | "done" | "error"
  hasSegments: boolean
  scriptAssist?: { available: boolean; model: string; label: string }
  analysisMessage?: string
  majorBreakMs: number
  minorBreakMs: number
  questionNumberGapMs: number
  questionNumberStyle: "number" | "test"
}

const examPlaceholder = `粘贴完整文稿，或点击「示例文稿」开始。\n\nM: Good morning. How are you?\nW: Fine, thank you.`

export function BulkPaste(props: Props) {
  const [text, setText] = useState("")
  const [mode, setMode] = useState<InputMode>("exam")
  const [applyMode, setApplyMode] = useState<ApplyMode>("replace")
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const parsed = useMemo(() => {
    if (mode === "exam") return parseExamScript(text, { majorBreakMs: props.majorBreakMs, minorBreakMs: props.minorBreakMs, questionNumberGapMs: props.questionNumberGapMs, questionNumberStyle: props.questionNumberStyle })
    return parseSegments(text, mode)
  }, [text, mode, props.majorBreakMs, props.minorBreakMs, props.questionNumberGapMs, props.questionNumberStyle])
  const workflowRunning = ["analyzing", "ready", "generating", "compose-pending", "composing"].includes(props.workflowStage)
  const workflowLabel: Record<Props["workflowStage"], string> = {
    idle: "一键生成完整音频",
    analyzing: "正在智能识别文稿…",
    ready: "拆分完成，准备生成…",
    generating: "正在逐段生成语音…",
    "compose-pending": "语音完成，准备合成…",
    composing: "正在合成并下载…",
    done: "已生成，可再次制作",
    error: "重试一键生成"
  }

  return (
    <section className={`rightCard bulkPasteCard ${props.hasSegments ? "bulkPasteHasSegments" : ""}`}>
      <div className="bulkHero">
        <div>
          <span className="bulkEyebrow">01 / YOUR SCRIPT</span>
          <h2 className="bulkTitle">放入你的文稿</h2>
          <div className="cardSub">直接粘贴完整内容，题号、对话与停顿交给工作台。</div>
        </div>
        <span className="bulkAiState">{props.scriptAssist?.available ? "DeepSeek 智能识别" : "本地规则识别"}</span>
      </div>


      <div className="scriptTools"><span>文稿编辑器</span><button type="button" className="textButton" disabled={workflowRunning} onClick={() => setText("第一节：听下面一段对话，对话读两遍。\n1. M: Hi, Emma. What are you going to do this weekend?\nW: I'm going to the library. Would you like to come with me?\nM: Sure. What time shall we meet?\nW: Let's meet at nine outside the school gate.\n听力测试到此结束。")}>示例文稿 ↗</button></div>
      <textarea
        ref={textareaRef}
        className="pasteArea"
        aria-label="完整文稿"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={examPlaceholder}
        rows={10}
      />
      <div className="scriptWordCount">{text.length.toLocaleString()} 字符</div>

      <div className="bulkPrimaryActions">
        <button
          className="btnPrimary bulkCreateButton"
          type="button"
          onClick={() => props.onCreateAudio(text, applyMode, Boolean(props.scriptAssist?.available))}
          disabled={!text.trim() || workflowRunning}
        >
          <span aria-hidden="true">▶</span>
          <span>{workflowLabel[props.workflowStage]}</span>
        </button>
        <button
          className="btn bulkReviewButton"
          type="button"
          onClick={() => props.onAnalyze(text, applyMode, Boolean(props.scriptAssist?.available))}
          disabled={!text.trim() || props.analyzing || workflowRunning}
        >
          拆分并检查 →
        </button>
        <button className="btnGhost bulkClearButton" type="button" onClick={() => setText("")} disabled={!text.trim() || workflowRunning}>
          清空
        </button>
      </div>

      {props.analysisMessage ? <div className="analysisMessage">{props.analysisMessage}</div> : null}

      <details className="bulkAdvanced">
        <summary>拆分选项</summary>
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
          <button
            className="btn"
            type="button"
            onClick={() => mode === "exam" ? props.onAnalyze(text, applyMode, false) : props.onApply(parsed, applyMode)}
            disabled={!parsed.length || props.analyzing}
          >
            {mode === "exam" ? "本地快速拆分" : "简单拆分"}
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
