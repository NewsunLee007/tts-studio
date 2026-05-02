import { useMemo, useState } from "react"
import type { ProviderId, VoiceGender, VoicePreset } from "../types"

type Props = {
  provider: ProviderId
  voices: VoicePreset[]
  onChange: (voices: VoicePreset[]) => void
  onClose: () => void
}

export function VoiceLibrary(props: Props) {
  const [id, setId] = useState("")
  const [label, setLabel] = useState("")
  const [gender, setGender] = useState<VoiceGender>("neutral")
  const [jsonText, setJsonText] = useState("")
  const [error, setError] = useState("")

  const exportJson = useMemo(() => JSON.stringify(props.voices, null, 2), [props.voices])

  function add() {
    setError("")
    const vid = id.trim()
    if (!vid) {
      setError("voice id 不能为空")
      return
    }
    const vlabel = (label.trim() || vid).slice(0, 48)
    const next = props.voices.filter((v) => v.id !== vid)
    next.unshift({ id: vid, label: vlabel, gender })
    props.onChange(next)
    setId("")
    setLabel("")
  }

  function remove(vid: string) {
    props.onChange(props.voices.filter((v) => v.id !== vid))
  }

  function doImport() {
    setError("")
    try {
      const parsed = JSON.parse(jsonText)
      if (!Array.isArray(parsed)) throw new Error("JSON 必须是数组")
      const next: VoicePreset[] = parsed
        .map((v) => ({
          id: String(v.id || "").trim(),
          label: String(v.label || v.id || "").trim(),
          gender: (v.gender === "male" || v.gender === "female" || v.gender === "neutral" ? v.gender : "neutral") as VoiceGender
        }))
        .filter((v) => v.id)
      props.onChange(next)
      setJsonText("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败")
    }
  }

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label="voice library">
      <div className="modal">
        <div className="modalHead">
          <div>
            <div className="modalTitle">声音库（{props.provider === "openai" ? "OpenAI" : "DashScope"}）</div>
            <div className="modalSub">这里维护“自定义 voices”，会保存在浏览器本地</div>
          </div>
          <button className="btnGhost" type="button" onClick={props.onClose}>
            关闭
          </button>
        </div>

        <div className="modalGrid">
          <label className="field">
            <div className="label">Voice ID</div>
            <input value={id} onChange={(e) => setId(e.target.value)} placeholder="例如：Cherry / Ethan / your-voice-id" />
          </label>
          <label className="field">
            <div className="label">显示名</div>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="可选" />
          </label>
          <label className="field">
            <div className="label">性别</div>
            <select value={gender} onChange={(e) => setGender(e.target.value as VoiceGender)}>
              <option value="female">female</option>
              <option value="male">male</option>
              <option value="neutral">neutral</option>
            </select>
          </label>
          <div className="field">
            <div className="label">操作</div>
            <div className="row">
              <button className="btn" type="button" onClick={add}>
                添加/更新
              </button>
            </div>
          </div>
        </div>

        {error ? <div className="error">{error}</div> : null}

        <div className="modalList">
          {props.voices.length ? (
            props.voices.map((v) => (
              <div key={v.id} className="voiceItem">
                <div className="voiceMain">
                  <div className="voiceId">{v.id}</div>
                  <div className="voiceMeta">{v.label} · {v.gender}</div>
                </div>
                <button className="btnDanger" type="button" onClick={() => remove(v.id)}>
                  删除
                </button>
              </div>
            ))
          ) : (
            <div className="hint">暂无自定义 voices</div>
          )}
        </div>

        <div className="modalGrid">
          <label className="field span2">
            <div className="label">导入（JSON 数组）</div>
            <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows={5} placeholder={exportJson} />
          </label>
          <div className="field">
            <div className="label">导入</div>
            <button className="btn" type="button" onClick={doImport} disabled={!jsonText.trim()}>
              导入覆盖
            </button>
          </div>
        </div>

        <label className="field">
          <div className="label">导出（复制下面 JSON）</div>
          <textarea value={exportJson} readOnly rows={6} />
        </label>
      </div>
    </div>
  )
}

