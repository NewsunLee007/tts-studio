import type { ProviderId, Segment, SegmentPatch, TtsGenerationMeta, TtsSegment, VoiceGender, VoicePreset } from "../types"

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
  onGenerateSingle: (uid: string) => void
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

function musicPresetDurationMs(presetId: "warmup" | "bell" | "soft" | "piano" | "ding", fallbackMs: number) {
  if (presetId === "ding") return 1730
  if (presetId === "piano") return 13720
  return fallbackMs
}

function roleLabel(segment: TtsSegment) {
  if (segment.role === "female") return "女声（W/B）"
  if (segment.role === "male") return "男声（M/A）"
  if (segment.role === "question") return "题号"
  return "旁白"
}

function segmentRoleLabel(segment: TtsSegment) {
  if (segment.role === "female") return "女声"
  if (segment.role === "male") return "男声"
  if (segment.role === "question") return "题号"
  if (segment.role === "intro") return "考试介绍"
  if (segment.role === "narrator") return "旁白"
  return "普通朗读"
}

function roleClass(segment: TtsSegment) {
  if (segment.role === "female") return "turnBadgeFemale"
  if (segment.role === "male") return "turnBadgeMale"
  if (segment.role === "question") return "turnBadgeQuestion"
  return "turnBadgeNarrator"
}

function instructionLabel(mode?: TtsGenerationMeta["instructionMode"]) {
  if (mode === "sent") return "导演指令已发送"
  if (mode === "suppressed") return "导演指令未发送"
  return "无导演指令"
}

export function SegmentEditor(props: Props) {
  const seg = props.segment
  const voices = filterVoices(props.voiceOptions, props.voiceGender)
  const voiceNameById = new Map(props.voiceOptions.map((voice) => [voice.id, voice.label]))

  if (!seg) {
    return (
      <section className="rightPane">
        <div className="rightEmpty">
          <h2 className="emptyTitle">编辑片段</h2>
          <div className="emptySub">先拆分文稿，再点选一个片段进行调整。</div>
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
            <h2 className="cardTitle">停顿</h2>
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

          <div className="durationPresets">{[1, 3, 5, 10].map(seconds => <button type="button" key={seconds} aria-pressed={seg.durationMs === seconds * 1000} onClick={() => props.onUpdate(seg.uid, { durationMs: seconds * 1000 })}>{seconds} 秒</button>)}</div>
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
    const fixedDuration = seg.presetId === "ding" || seg.presetId === "piano"
    const duration = splitDuration(musicPresetDurationMs(seg.presetId, seg.durationMs))
    return (
      <section className="rightPane">
        <div className="rightCard inspectorCard">
          <div className="cardHead">
            <h2 className="cardTitle">提示音</h2>
            <div className="cardSub">随文稿顺序合成。</div>
          </div>
          <div className="cardGrid">
            <label className="field">
              <div className="label">音乐类型</div>
              <select
                aria-label="音乐类型"
                value={seg.presetId}
                onChange={(e) => {
                  const presetId = e.target.value as "warmup" | "bell" | "soft" | "piano" | "ding"
                  props.onUpdate(seg.uid, { presetId, durationMs: musicPresetDurationMs(presetId, seg.durationMs) })
                }}
              >
                <option value="warmup">Warmup</option>
                <option value="bell">Bell</option>
                <option value="soft">Soft</option>
                <option value="piano">Piano</option>
                <option value="ding">Ding</option>
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
                  disabled={fixedDuration}
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
                  disabled={fixedDuration}
                  onChange={(e) => props.onUpdate(seg.uid, { durationMs: toDurationMs(duration.minutes, Number(e.target.value)) })}
                />
              </label>
            </div>
            {fixedDuration ? <p className="fieldHint">该音乐使用上传文件的原始时长，不再手动裁短。</p> : null}
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
          <h2 className="cardTitle">{segmentRoleLabel(seg)}</h2>
          <div className="cardSub">{seg.role ? `朗读角色：${segmentRoleLabel(seg)}` : seg.label ? `朗读人：${seg.label}` : "可单独调整本片段的音色和风格"}</div>
        </div>

        {isGeminiGroup ? (
          <label className="field">
            <div className="label">朗读文本</div>
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
                <div className="label">对话内容</div>
                <div className="turnListSub">逐句编辑、试听或重新生成。</div>
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
                    <div className="label">试听</div>
                    {item.audioUrl ? <audio className="audio" controls src={item.audioUrl} /> : <div className="hint">本句尚未生成</div>}
                  </div>
                  <div className="turnPreviewActions">
                    <button className="btn turnGenerateButton" type="button" onClick={() => props.onGenerateSingle(item.uid)} disabled={item.status === "generating"}>
                      {item.status === "generating" ? "生成中…" : item.audioId ? "重新生成本句" : "生成本句"}
                    </button>
                    <div className={item.audioId ? "readyDot readyDotOn" : "readyDot"} aria-hidden="true" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="segmentVoiceChoice">
            <label className="field">
            <div className="label">本片段音色</div>
            <select
              aria-label="本片段音色"
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
        </div>
        <details className="segmentAdvanced">
          <summary>高级调整</summary>
          <div className="cardGrid">
            <label className="field">
            <div className="label">风格预设</div>
            <select
              aria-label="风格预设"
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
        </details>

        {seg.directorNote ? (
          <details className="segmentNote"><summary>朗读提示</summary><p>{seg.directorNote}</p></details>
        ) : null}

        {seg.generationMeta ? (
          <details className="generationMeta">
            <summary className="generationMetaHead">
              <strong>实际生成参数</strong>
              <span>{instructionLabel(seg.generationMeta.instructionMode)}</span>
            </summary>
            <div className="generationMetaGrid">
              <div>
                <span>模型</span>
                <strong>{seg.generationMeta.usedModel || seg.modelId || "默认"}</strong>
              </div>
              <div>
                <span>音色</span>
                <strong>{seg.generationMeta.usedVoice || seg.voiceId || props.globalVoiceId || "默认"}</strong>
              </div>
              <div>
                <span>语言</span>
                <strong>{seg.generationMeta.languageType || "自动"}</strong>
              </div>
            </div>
            {seg.generationMeta.requestSummary?.length ? (
              <div className="generationMetaSummary">
                {seg.generationMeta.requestSummary.map((item) => (
                  <span key={`${item.label}-${item.value}`}>{item.label}: {item.value}</span>
                ))}
              </div>
            ) : null}
            {seg.generationMeta.warnings?.length ? (
              <div className="generationWarnings">
                {seg.generationMeta.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            ) : null}
          </details>
        ) : null}

        {isAudioReuse ? (
          <p className="settingsHelp">第二遍复用首遍音频，不重复计费。</p>
        ) : null}

        {props.repeatControl?.canUse ? (
          <label className="repeatToggle"><input type="checkbox" checked={props.repeatControl.enabled} onChange={() => props.onToggleRepeat?.(seg.uid)} />本题读两遍</label>
        ) : null}

        {!isTurnByTurnGroup && seg.audioUrl ? <div className="previewStrip"><audio className="audio" controls src={seg.audioUrl} /></div> : null}
        {seg.status === "error" ? <div className="error">{seg.error}</div> : null}

        <div className="cardActions">
          <button className="btnPrimary" type="button" onClick={() => props.onGenerate(seg.uid)} disabled={seg.status === "generating"}>
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
