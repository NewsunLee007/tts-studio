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

const examPlaceholder = `可以直接粘贴完整听力文稿：中文题干说明、题号、对话/独白正文、选项和结束语都可以一次放进来。

系统功能：
1. 自动划分语音片段，识别大题说明、题号提示、听力正文和考试结束语。
2. 自动跳过 A/B/C/D 选项、答案行和书面题干，减少手工删改。
3. 自动识别“读两遍”等要求，并为需要重读的正文生成第 2 遍。
4. 自动识别 M/W/A/B、男/女、Man/Woman 等角色标记，分配男女声。
5. 自动插入读题、作答、题号间隔和结束前停顿；需要手动分块时，可单独插入一行 ---。

真实示例：
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
  const [applyMode, setApplyMode] = useState<ApplyMode>("append")
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const parsed = useMemo(() => {
    if (mode === "exam") return parseExamScript(text, { majorBreakMs: props.majorBreakMs, minorBreakMs: props.minorBreakMs, questionNumberGapMs: props.questionNumberGapMs, questionNumberStyle: props.questionNumberStyle })
    return parseSegments(text, mode)
  }, [text, mode, props.majorBreakMs, props.minorBreakMs, props.questionNumberGapMs, props.questionNumberStyle])

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
        placeholder={examPlaceholder}
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
