import type { ProviderId, Segment, SegmentPatch, TtsSegment, VoiceGender, VoicePreset } from "../types"

type Props = {
  provider: ProviderId
  voiceOptions: VoicePreset[]
  voiceGender: VoiceGender | "all"
  globalVoiceId: string
  stylePresetId: string
  styleOptions: Array<{ id: string; label: string }>
  stylePrompt: string

  contextPreview?: string
  groupSegments?: TtsSegment[]
  segment: Segment | null
  onUpdate: (uid: string, patch: SegmentPatch) => void
  onDelete: (uid: string) => void
  onGenerate: (uid: string) => void
  onClearAudio: (uid: string) => void
  repeatControl?: { canUse: boolean; enabled: boolean }
  onToggleRepeat?: (uid: string) => void
}

function filterVoices(list: VoicePreset[], gender: VoiceGender | "all") {
  const filtered = gender === "all" ? list : list.filter((v) => v.gender === gender)
  return Array.from(new Map(filtered.map((voice) => [voice.id, voice])).values())
}

function splitDuration(durationMs: number) {
  const totalSeconds = Math.max(0, durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Number((totalSeconds - minutes * 60).toFixed(3))
  return {
    minutes,
    seconds
  }
}

function toDurationMs(minutes: number, seconds: number) {
  const safeMinutes = Number.isFinite(minutes) ? Math.max(0, minutes) : 0
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  return Math.round((safeMinutes * 60 + safeSeconds) * 1000)
}

function roleLabel(segment: TtsSegment) {
  if (segment.role === "female") return "Female / W"
  if (segment.role === "male") return "Male / M"
  if (segment.role === "question") return "Number"
  return "Narrator"
}

function roleClass(segment: TtsSegment) {
  if (segment.role === "female") return "turnBadgeFemale"
  if (segment.role === "male") return "turnBadgeMale"
  if (segment.role === "question") return "turnBadgeQuestion"
  return "turnBadgeNarrator"
}

export function SegmentEditor(props: Props) {
  const seg = props.segment
  const voices = filterVoices(props.voiceOptions, props.voiceGender)
  const voiceNameById = new Map(props.voiceOptions.map((voice) => [voice.id, voice.label]))

  if (!seg) {
    return (
      <section className="rightPane">
        <div className="rightEmpty">
          <div className="emptyTitle">片段修改生成</div>
        </div>
      </section>
    )
  }

  if (seg.type === "silence") {
    const duration = splitDuration(seg.durationMs)
    return (
      <section className="rightPane">
        <div className="rightCard">
          <div className="cardHead">
            <div className="cardTitle">无声片段</div>
            <div className="cardSub">用于控制停顿</div>
          </div>

          <div className="durationGrid">
            <label className="field">
              <div className="label">分钟</div>
              <input
                type="number"
                min={0}
                step={1}
                value={duration.minutes}
                onChange={(e) => props.onUpdate(seg.uid, { durationMs: toDurationMs(Number(e.target.value), duration.seconds) })}
              />
            </label>
            <label className="field">
              <div className="label">秒</div>
              <input
                type="number"
                min={0}
                step={0.1}
                value={duration.seconds}
                onChange={(e) => props.onUpdate(seg.uid, { durationMs: toDurationMs(duration.minutes, Number(e.target.value)) })}
              />
            </label>
          </div>

          <div className="cardActions">
            <button className="btnDanger" type="button" onClick={() => props.onDelete(seg.uid)}>
              删除
            </button>
          </div>
        </div>
      </section>
    )
  }

  if (seg.type === "music") {
    const duration = splitDuration(seg.durationMs)
    return (
      <section className="rightPane">
        <div className="rightCard inspectorCard">
          <div className="cardHead">
            <div className="cardTitle">导入音乐</div>
            <div className="cardSub">当前版本使用内置提示音生成，可在合成时自动混入开头</div>
          </div>
          <div className="cardGrid">
            <label className="field">
              <div className="label">音乐类型</div>
              <select value={seg.presetId} onChange={(e) => props.onUpdate(seg.uid, { presetId: e.target.value as "warmup" | "bell" | "soft" })}>
                <option value="warmup">Warmup</option>
                <option value="bell">Bell</option>
                <option value="soft">Soft</option>
              </select>
            </label>
            <div className="durationGrid">
              <label className="field">
                <div className="label">分钟</div>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={duration.minutes}
                  onChange={(e) => props.onUpdate(seg.uid, { durationMs: toDurationMs(Number(e.target.value), duration.seconds) })}
                />
              </label>
              <label className="field">
                <div className="label">秒</div>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={duration.seconds}
                  onChange={(e) => props.onUpdate(seg.uid, { durationMs: toDurationMs(duration.minutes, Number(e.target.value)) })}
                />
              </label>
            </div>
          </div>
          <div className="cardActions">
            <button className="btnDanger" type="button" onClick={() => props.onDelete(seg.uid)}>
              删除
            </button>
          </div>
        </div>
      </section>
    )
  }

  const isAudioReuse = Boolean(seg.repeatOfUid)
  const isGeminiGroup = Boolean(props.contextPreview) && Boolean(seg.groupId)
  const groupSegments = (props.groupSegments || []).filter((item) => !item.repeatOfUid && item.role !== "question" && item.stylePresetId !== "question_marker")
  const isTurnByTurnGroup = !isGeminiGroup && groupSegments.length > 1
  const groupText =
    isGeminiGroup && typeof seg.providerOverrides?.geminiGroupText === "string" && seg.providerOverrides.geminiGroupText.trim()
      ? seg.providerOverrides.geminiGroupText
      : props.contextPreview || ""
  const generateLabel = seg.status === "generating"
    ? "生成中…"
    : isAudioReuse
      ? "生成第 1 遍"
      : isTurnByTurnGroup
        ? `生成整题 ${groupSegments.length} 句`
        : seg.audioId
          ? "重新生成"
          : "生成"
  const generatedTurns = groupSegments.filter((item) => Boolean(item.audioId && item.audioUrl)).length
  const turnGroupHasAudio = isTurnByTurnGroup && generatedTurns > 0
  const turnGroupComplete = isTurnByTurnGroup && generatedTurns === groupSegments.length
  const clearDisabled = isTurnByTurnGroup ? !turnGroupHasAudio : !seg.audioId
  const clearLabel = isTurnByTurnGroup ? "清除整题音频" : "清除音频"
  const clearCurrentAudio = () => {
    if (isTurnByTurnGroup) {
      groupSegments.forEach((item) => props.onClearAudio(item.uid))
      return
    }
    props.onClearAudio(seg.uid)
  }

  return (
    <section className="rightPane">
      <div className="rightCard inspectorCard">
        <div className="cardHead">
          <div className="cardTitle">TTS 片段</div>
          <div className="cardSub">{seg.role ? `角色：${seg.role}` : seg.label ? `Speaker: ${seg.label}` : "可逐段覆盖 voice / 风格"}</div>
        </div>

        {isGeminiGroup ? (
          <label className="field">
            <div className="label">本题实际送入 TTS 的文本（可编辑）</div>
            <textarea
              value={groupText}
              onChange={(e) =>
                props.onUpdate(seg.uid, {
                  providerOverrides: { ...(seg.providerOverrides || {}), geminiGroupText: e.target.value }
                })
              }
              rows={8}
            />
          </label>
        ) : null}

        {!isGeminiGroup && !isTurnByTurnGroup ? (
          <label className="field">
            <div className="label">文本</div>
            <textarea value={seg.text} onChange={(e) => props.onUpdate(seg.uid, { text: e.target.value })} rows={6} />
          </label>
        ) : null}

        {isTurnByTurnGroup ? (
          <div className="turnList">
            <div className="turnListHead">
              <div>
                <div className="label">本题实际逐句送入 TTS 的内容</div>
                <div className="turnListSub">国内单角色模型会按下面顺序逐条生成，每条使用对应男女声。</div>
              </div>
              <span>{groupSegments.length} 句</span>
            </div>
            {groupSegments.map((item, index) => (
              <div className="turnRow" key={item.uid}>
                <div className="turnMeta">
                  <span className={`turnBadge ${roleClass(item)}`}>{roleLabel(item)}</span>
                  <span>第 {index + 1} 句</span>
                  <span>{voiceNameById.get(item.voiceId || "") || voiceNameById.get(props.globalVoiceId) || "使用全局音色"}</span>
                  {item.audioId ? <span className="turnReady">已生成</span> : null}
                </div>
                <textarea
                  className="turnTextarea"
                  value={item.text}
                  onChange={(e) => props.onUpdate(item.uid, { text: e.target.value })}
                  rows={2}
                />
                <div className="turnPreview">
                  <div>
                    <div className="label">本句音频预览</div>
                    {item.audioUrl ? <audio className="audio" controls src={item.audioUrl} /> : <div className="hint">本句尚未生成</div>}
                  </div>
                  <div className={item.audioId ? "readyDot readyDotOn" : "readyDot"} aria-hidden="true" />
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="cardGrid">
          <label className="field">
            <div className="label">Voice（留空使用全局默认）</div>
            <select
              value={seg.voiceId || props.globalVoiceId}
              onChange={(e) => props.onUpdate(seg.uid, { voiceId: e.target.value })}
            >
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <div className="label">风格预设</div>
            <select
              value={seg.stylePresetId || ""}
              onChange={(e) => props.onUpdate(seg.uid, { stylePresetId: e.target.value })}
            >
              <option value="">（使用全局）</option>
              {props.styleOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <div className="label">音高 {((seg.pitch || 1) * 100).toFixed(0)}%</div>
            <input className="rangeInput" type="range" min={0.8} max={1.2} step={0.02} value={seg.pitch || 1} onChange={(e) => props.onUpdate(seg.uid, { pitch: Number(e.target.value) })} />
          </label>

          <label className="field">
            <div className="label">音量 {((seg.volume || 1) * 100).toFixed(0)}%</div>
            <input className="rangeInput" type="range" min={0.6} max={1.4} step={0.05} value={seg.volume || 1} onChange={(e) => props.onUpdate(seg.uid, { volume: Number(e.target.value) })} />
          </label>
        </div>

        {seg.directorNote ? (
          <div className="directorNote">
            <strong>导演提示</strong>
            <span>{seg.directorNote}</span>
          </div>
        ) : null}

        {isAudioReuse ? (
          <div className="directorNote reuseNote">
            <strong>音频复用</strong>
            <span>这一遍不会再次调用 TTS，会在生成第 1 遍后复用同一段音频，保证两遍声音完全一致。</span>
          </div>
        ) : null}

        {props.repeatControl?.canUse ? (
          <div className="directorNote reuseNote">
            <strong>重复播放</strong>
            <span>{props.repeatControl.enabled ? "当前题组会播放两遍；第 2 遍复用第 1 遍音频。" : "当前题组只播放一遍，可一键添加第 2 遍和重读间隔。"}</span>
            <button className="btn" type="button" onClick={() => props.onToggleRepeat?.(seg.uid)}>
              {props.repeatControl.enabled ? "取消第二遍" : "添加第二遍"}
            </button>
          </div>
        ) : null}

        <div className="previewStrip">
          <div>
            <div className="label">音频预览</div>
            {isTurnByTurnGroup ? (
              <div className="hint">{turnGroupComplete ? "本题所有句子已生成，可在上方分别试听。" : `已生成 ${generatedTurns}/${groupSegments.length} 句，请在上方逐句试听。`}</div>
            ) : seg.audioUrl ? <audio className="audio" controls src={seg.audioUrl} /> : <div className="hint">尚未生成音频</div>}
          </div>
          <div className={(isTurnByTurnGroup ? turnGroupComplete : seg.audioId) ? "readyDot readyDotOn" : "readyDot"} aria-hidden="true" />
        </div>
        {seg.status === "error" ? <div className="error">{seg.error}</div> : null}

        <div className="cardActions">
          <button className="btn" type="button" onClick={() => props.onGenerate(seg.uid)} disabled={seg.status === "generating"}>
            {generateLabel}
          </button>
          <button className="btnGhost" type="button" onClick={clearCurrentAudio} disabled={clearDisabled}>
            {clearLabel}
          </button>
          <button className="btnDanger" type="button" onClick={() => props.onDelete(seg.uid)}>
            删除
          </button>
        </div>
      </div>
    </section>
  )
}
