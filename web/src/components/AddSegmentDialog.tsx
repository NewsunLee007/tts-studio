import { useEffect, useRef, useState } from "react"

export type NewSegment = { type: "tts" | "silence" | "music"; text: string; durationMs: number }

export function AddSegmentDialog(props: { afterLabel: string; onClose: () => void; onAdd: (value: NewSegment) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [type, setType] = useState<NewSegment["type"]>("silence")
  const [seconds, setSeconds] = useState(3)
  const [text, setText] = useState("")
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="addSegmentDialog" onCancel={props.onClose} onClick={event => { if (event.target === dialog.current) props.onClose() }} aria-labelledby="add-segment-title">
    <form onSubmit={event => { event.preventDefault(); props.onAdd({ type, text: text.trim(), durationMs: Math.round(seconds * 1000) }) }}>
      <div className="addDialogHead"><h2 id="add-segment-title">添加片段</h2><button type="button" className="textButton" aria-label="关闭添加片段" onClick={props.onClose}>×</button></div>
      <p className="settingsHelp">{props.afterLabel}</p>
      <div className="addTypeChoices">{([{ id: "silence", label: "停顿" }, { id: "tts", label: "朗读" }, { id: "music", label: "音乐" }] as const).map(item => <button key={item.id} type="button" aria-pressed={type === item.id} className={type === item.id ? "active" : ""} onClick={() => setType(item.id)}>{item.label}</button>)}</div>
      {type === "tts" ? <label className="field"><span className="label">朗读文字</span><textarea aria-label="新增朗读文字" rows={4} value={text} onChange={event => setText(event.target.value)} autoFocus /></label> : <label className="field"><span className="label">{type === "silence" ? "停顿秒数" : "音乐秒数"}</span><input autoFocus aria-label="新增片段秒数" type="number" min={0.1} max={600} step={0.1} value={seconds} onChange={event => setSeconds(Number(event.target.value))} /><div className="durationPresets">{[1, 3, 5, 10].map(value => <button type="button" key={value} aria-pressed={seconds === value} onClick={() => setSeconds(value)}>{value} 秒</button>)}</div></label>}
      <div className="addDialogActions"><button className="btn" type="button" onClick={props.onClose}>取消</button><button className="btnPrimary" type="submit" disabled={type === "tts" ? !text.trim() : !Number.isFinite(seconds) || seconds < 0.1 || seconds > 600}>添加{type === "silence" ? "停顿" : type === "tts" ? "朗读" : "音乐"}</button></div>
    </form>
  </dialog>
}
