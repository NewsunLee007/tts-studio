import { useEffect, useMemo, useState } from "react"
import type { EnglishAccentId, ExamTemplate, PacePreset, ProviderConfig, ProviderId, VoiceGender } from "../types"

type Props = {
  providers: ProviderConfig[]
  provider: ProviderId
  onOpenServices: () => void
  smartModel: string
  onSmartModelChange: (value: string) => void
  smartAvailable: boolean
  modelId: string
  onModelIdChange: (value: string) => void
  voiceId: string
  onVoiceIdChange: (value: string) => void
  geminiMaleVoiceId: string
  onGeminiMaleVoiceIdChange: (value: string) => void
  geminiFemaleVoiceId: string
  onGeminiFemaleVoiceIdChange: (value: string) => void
  voiceGender: VoiceGender | "all"
  onVoiceGenderChange: (value: VoiceGender | "all") => void
  catalogState: "idle" | "loading" | "done" | "error"
  catalogMessage: string
  onRefreshCatalog: () => void
  baseUrl: string
  onBaseUrlChange: (value: string) => void
  languageType: string
  onLanguageTypeChange: (value: string) => void
  template: ExamTemplate
  onTemplateChange: (patch: Partial<ExamTemplate>) => void
  onApplyBreakDurations: (majorBreakMs: number, minorBreakMs: number, questionNumberGapMs: number) => void
  pacePreset: string
  onPacePresetChange: (value: string) => void
  paceOptions: PacePreset[]
  speedMultiplier: number
  effectiveSpeed: number
  englishAccent: EnglishAccentId
  englishAccentOptions: Array<{ id: EnglishAccentId; label: string; locale: "en-GB" | "en-US" | "en"; description: string; instruction: string }>
  onEnglishAccentChange: (value: EnglishAccentId) => void
  speedSampleUrl: string
  speedSampleState: "idle" | "generating" | "done" | "error"
  speedSampleError: string
  onGenerateSpeedSample: (multiplier: number, sampleText: string) => void
  onApplySpeedCalibration: (multiplier: number) => void
  onApplyTargetSpeakingRates: (englishWordsPerMinute: number, chineseCharsPerMinute: number) => void
  stylePrompt: string
  onStylePromptChange: (value: string) => void
}

type TabId = "voice" | "exam" | "strategy" | "smart" | "advanced"

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "voice", label: "声音" },
  { id: "strategy", label: "发音与语速" },
  { id: "exam", label: "停顿与题号" },
  { id: "smart", label: "智能识别" },
  { id: "advanced", label: "高级" }
]

function secondsFromMs(value: number | undefined, fallback: number) {
  const ms = typeof value === "number" && Number.isFinite(value) ? value : fallback
  return Math.max(0, Number((ms / 1000).toFixed(1)))
}

export function SettingsPage(props: Props) {
  const [active, setActive] = useState<TabId>("voice")
  const [smartModels, setSmartModels] = useState([{ id: "deepseek-flash", label: "DeepSeek V4.1 Flash（推荐）" }])
  const [smartCatalogState, setSmartCatalogState] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [smartCatalogMessage, setSmartCatalogMessage] = useState("")
  async function refreshSmartModels() {
    setSmartCatalogState("loading")
    setSmartCatalogMessage("")
    try {
      const response = await fetch("/api/script/models", { signal: AbortSignal.timeout(30000) })
      const json = await response.json() as { models?: Array<{ id: string; label: string }>; error?: string }
      if (!response.ok || !json.models?.length) throw new Error(json.error || "暂无可用模型")
      setSmartModels(json.models)
      setSmartCatalogState("done")
      setSmartCatalogMessage("已更新官方可用模型。")
    } catch (error) {
      setSmartCatalogState("error")
      setSmartCatalogMessage(error instanceof Error ? error.message : "更新失败，请稍后重试。")
    }
  }
  const [draftSpeedMultiplier, setDraftSpeedMultiplier] = useState(props.speedMultiplier)
  const [englishWordsPerMinute, setEnglishWordsPerMinute] = useState(props.template.englishWordsPerMinute || 118)
  const [chineseCharsPerMinute, setChineseCharsPerMinute] = useState(props.template.chineseCharsPerMinute || 230)
  const [majorBreakSeconds, setMajorBreakSeconds] = useState(() => secondsFromMs(props.template.majorBreakMs, 10000))
  const [minorBreakSeconds, setMinorBreakSeconds] = useState(() => secondsFromMs(props.template.minorBreakMs, 5000))
  const [questionNumberGapSeconds, setQuestionNumberGapSeconds] = useState(() => secondsFromMs(props.template.questionNumberGapMs, 1000))
  const [applyNotice, setApplyNotice] = useState("")
  const [sampleText, setSampleText] = useState(
    "This is the English listening test. Number 1. Listen to the dialogue and choose the best answer. You will hear the conversation twice."
  )
  const provider = props.providers.find((item) => item.id === props.provider) || props.providers[0]
  const voiceOptions = useMemo(() => {
    const allVoices = provider?.voices || []
    const list =
      provider?.id === "dashscope"
        ? allVoices.filter((voice) => {
            if (voice.modelIds) return voice.modelIds.includes(props.modelId)
            if (props.modelId.startsWith("qwen-audio-")) return false
            const cosyVoice = /^loo?ng/i.test(voice.id)
            return props.modelId.startsWith("cosyvoice-") ? cosyVoice : !cosyVoice
          })
        : allVoices
    const filtered = props.voiceGender === "all" ? list : list.filter((voice) => voice.gender === props.voiceGender)
    return Array.from(new Map(filtered.map((voice) => [voice.id, voice])).values())
  }, [provider, props.modelId, props.voiceGender])
  const geminiMaleVoices = useMemo(() => (provider?.voices || []).filter((voice) => voice.gender === "male"), [provider])
  const geminiFemaleVoices = useMemo(() => (provider?.voices || []).filter((voice) => voice.gender === "female"), [provider])


  useEffect(() => {
    setDraftSpeedMultiplier(props.speedMultiplier)
  }, [props.speedMultiplier])

  useEffect(() => {
    setEnglishWordsPerMinute(props.template.englishWordsPerMinute || 118)
    setChineseCharsPerMinute(props.template.chineseCharsPerMinute || 230)
  }, [props.template.englishWordsPerMinute, props.template.chineseCharsPerMinute])

  useEffect(() => {
    setMajorBreakSeconds(secondsFromMs(props.template.majorBreakMs, 10000))
    setMinorBreakSeconds(secondsFromMs(props.template.minorBreakMs, 5000))
    setQuestionNumberGapSeconds(secondsFromMs(props.template.questionNumberGapMs, 1000))
  }, [props.template.majorBreakMs, props.template.minorBreakMs, props.template.questionNumberGapMs])

  useEffect(() => {
    if (!applyNotice) return
    const timer = window.setTimeout(() => setApplyNotice(""), 4200)
    return () => window.clearTimeout(timer)
  }, [applyNotice])

  if (!provider) return <p className="settingsLoading" role="status">正在加载设置…</p>

  return (
    <section className="settingsPage" aria-label="制作设置">
        <div className="settingsTabs" role="tablist" aria-label="设置分类" onKeyDown={event => {
          const index = tabs.findIndex(tab => tab.id === active)
          const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1
          if (next < 0) return
          event.preventDefault()
          setActive(tabs[next].id)
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
        }}>
          {tabs.map((tab) => (
            <button key={tab.id} type="button" role="tab" id={`settings-tab-${tab.id}`} aria-selected={active === tab.id} aria-controls="settings-panel" tabIndex={active === tab.id ? 0 : -1} className={active === tab.id ? "settingsTab settingsTabActive" : "settingsTab"} onClick={() => setActive(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="settingsBody" id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${active}`}>
          {active === "smart" ? <div className="settingsForm">
            <div className="settingsServiceRow"><span><small>文稿拆分</small><strong>DeepSeek 智能识别</strong></span><button className="textButton" type="button" disabled={!props.smartAvailable || smartCatalogState === "loading"} onClick={() => void refreshSmartModels()}>{smartCatalogState === "loading" ? "正在更新…" : "刷新模型"}</button></div>
            <label className="field"><span className="label">识别模型</span><select aria-label="DeepSeek 识别模型" value={props.smartModel} onChange={event => props.onSmartModelChange(event.target.value)}>
              {!smartModels.some(item => item.id === props.smartModel) ? <option value={props.smartModel}>{props.smartModel}</option> : null}
              {smartModels.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select></label>
            <p className="settingsHelp">用于“智能识别并拆分”。下次识别生效，选择保存在此浏览器。</p>
            {!props.smartAvailable ? <p className="inlineError">管理员尚未配置 DeepSeek 密钥。</p> : null}
            {smartCatalogMessage ? <p className={smartCatalogState === "error" ? "inlineError" : "settingsHelp"} role="status">{smartCatalogMessage}</p> : null}
            <details className="serviceDetails"><summary>模型说明</summary><p>V4.1 Flash 使用 deepseek-flash。旧 V4 Flash / Pro 接口目前也转到 V4.1 Flash，因此不重复列出。</p><a href="https://www.deepseek.com/news/deepseek-v4-1-flash/" target="_blank" rel="noreferrer">官方模型说明 ↗</a></details>
          </div> : null}
          {active === "voice" ? (
            <div className="settingsForm">
              <div className="settingsServiceRow">
                <span><small>当前服务</small><strong>{provider.label}</strong></span>
                <button className="textButton" type="button" onClick={props.onOpenServices}>连接与更换 ↗</button>
              </div>
              {props.catalogMessage ? <div className={props.catalogState === "error" ? "inlineError" : "settingsHelp"} role="status">{props.catalogMessage}</div> : null}
              <label className="field">
                <div className="label">模型</div>
                <select aria-label="模型" value={props.modelId} onChange={(event) => props.onModelIdChange(event.target.value)}>
                  {provider.models.map((model) => (
                    <option key={model.id} value={model.id}>{model.label}</option>
                  ))}
                </select>
              </label>

              <div className="field settingsVoiceFilter">
                <div className="label">音色</div>
                <div className="segmented">
                  {(["all", "female", "male", "neutral"] as const).map((gender) => (
                    <button key={gender} type="button" className={props.voiceGender === gender ? "segBtn segBtnActive" : "segBtn"} onClick={() => props.onVoiceGenderChange(gender)}>
                      {gender === "all" ? "全部" : gender === "female" ? "女声" : gender === "male" ? "男声" : "中性"}
                    </button>
                  ))}
                </div>
              </div>

              <label className="field">
                <div className="label">默认朗读声音</div>
                <select aria-label="默认音色" value={props.voiceId} onChange={(event) => props.onVoiceIdChange(event.target.value)}>
                  {voiceOptions.map((voice) => (
                    <option key={voice.id} value={voice.id}>{voice.label}</option>
                  ))}
                </select>
              </label>
              <button className="textButton settingsRefresh" type="button" onClick={props.onRefreshCatalog} disabled={props.catalogState === "loading"}>{props.catalogState === "loading" ? "更新中…" : "更新模型与音色 ↻"}</button>
              {props.provider === "google_gemini" ? (
                <div className="settingsTwoCol">
                  <label className="field">
                    <div className="label">对话男声（M/A）</div>
                    <select aria-label="对话男声" value={props.geminiMaleVoiceId} onChange={(event) => props.onGeminiMaleVoiceIdChange(event.target.value)}>
                      {geminiMaleVoices.map((voice) => (
                        <option key={voice.id} value={voice.id}>{voice.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <div className="label">对话女声（W/B）</div>
                    <select aria-label="对话女声" value={props.geminiFemaleVoiceId} onChange={(event) => props.onGeminiFemaleVoiceIdChange(event.target.value)}>
                      {geminiFemaleVoices.map((voice) => (
                        <option key={voice.id} value={voice.id}>{voice.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}

          {active === "exam" ? (
            <div className="settingsForm">
              <p className="settingsHelp">考试名称与开场播报在“准备文稿”中填写。</p>
              <label className="checkRow">
                <input type="checkbox" checked={props.template.includeIntroMusic} onChange={(event) => props.onTemplateChange({ includeIntroMusic: event.target.checked })} />
                <span>导入音乐</span>
              </label>
              <label className="checkRow">
                <input type="checkbox" checked={props.template.includeQuestionNumbers} onChange={(event) => props.onTemplateChange({ includeQuestionNumbers: event.target.checked })} />
                <span>自动插入题号语音和提示音</span>
              </label>
              <label className="field">
                <div className="label">题号播报格式</div>
                <select aria-label="题号播报格式" value={props.template.questionNumberStyle} onChange={(event) => props.onTemplateChange({ questionNumberStyle: event.target.value === "test" ? "test" : "number" })}>
                  <option value="number">Number 1 / Number 2</option>
                  <option value="test">Test 1 / Test 2</option>
                </select>
              </label>
              <label className="field">
                <div className="label">导入音乐</div>
                <select aria-label="导入音乐" value={props.template.introMusicPreset} onChange={(event) => props.onTemplateChange({ introMusicPreset: event.target.value as ExamTemplate["introMusicPreset"] })}>
                  <option value="warmup">Warmup 电子提示音</option>
                  <option value="bell">Bell 考试铃声</option>
                  <option value="soft">Soft 柔和提示音</option>
                  <option value="piano">Piano 钢琴曲导入</option>
                </select>
              </label>
              <div className="speedCalibrator">
                <div className="speedCalibratorHead">
                  <div>
                    <div className="label">全局停顿间隔</div>
                    <p>应用到当前片段和后续文稿。</p>
                  </div>
                </div>
                <div className="settingsTwoCol">
                  <label className="field">
                    <div className="label">大题间隔（秒）</div>
                    <input type="number" min={0} step={0.1} value={majorBreakSeconds} onChange={(event) => setMajorBreakSeconds(Number(event.target.value))} />
                  </label>
                  <label className="field">
                    <div className="label">小题间隔（秒）</div>
                    <input type="number" min={0} step={0.1} value={minorBreakSeconds} onChange={(event) => setMinorBreakSeconds(Number(event.target.value))} />
                  </label>
                  <label className="field">
                    <div className="label">题号后间隔（秒）</div>
                    <input type="number" min={0} step={0.1} value={questionNumberGapSeconds} onChange={(event) => setQuestionNumberGapSeconds(Number(event.target.value))} />
                  </label>
                </div>
                <div className="calibrationActions">
                  <button
                    className="btnPrimary"
                    type="button"
                    onClick={() => {
                      const majorMs = Math.round(Math.max(0, majorBreakSeconds) * 1000)
                      const minorMs = Math.round(Math.max(0, minorBreakSeconds) * 1000)
                      const questionGapMs = Math.round(Math.max(0, questionNumberGapSeconds) * 1000)
                      props.onApplyBreakDurations(majorMs, minorMs, questionGapMs)
                      setApplyNotice(`已应用停顿：大题 ${majorBreakSeconds.toFixed(1)} 秒，小题 ${minorBreakSeconds.toFixed(1)} 秒，题号后 ${questionNumberGapSeconds.toFixed(1)} 秒。`)
                    }}
                  >
                    应用停顿
                  </button>
                </div>
                {applyNotice ? <div className="inlineSuccess" role="status">{applyNotice}</div> : null}
              </div>
            </div>
          ) : null}

          {active === "strategy" ? (
            <div className="settingsForm">
              <label className="field">
                <div className="label">英语发音标准</div>
                <select
                  aria-label="英语发音标准"
                  value={props.englishAccent}
                  onChange={(event) => {
                    props.onEnglishAccentChange(event.target.value as EnglishAccentId)
                    const next = props.englishAccentOptions.find((item) => item.id === event.target.value)
                    setApplyNotice(`已切换为${next?.label || "新的发音标准"}。已有音频需要重新生成后才会更新。`)
                  }}
                >
                  {props.englishAccentOptions.map((accent) => (
                    <option key={accent.id} value={accent.id}>{accent.label}</option>
                  ))}
                </select>
              </label>
              <div className="strategyNote">
                优先匹配口音音色；支持朗读指令的模型会同时接收发音要求。
              </div>
              <div className="speedCalibrator">
                <div className="speedCalibratorHead">
                  <div>
                    <div className="label">目标语速控制</div>
                    <p>每分钟朗读的英文单词数 / 中文字数。</p>
                  </div>
                  <strong>{englishWordsPerMinute} WPM / {chineseCharsPerMinute} CPM</strong>
                </div>
                <div className="settingsTwoCol">
                  <label className="field">
                    <div className="label">英语 WPM</div>
                    <input type="number" min={80} max={180} step={1} value={englishWordsPerMinute} onChange={(event) => setEnglishWordsPerMinute(Number(event.target.value))} />
                  </label>
                  <label className="field">
                    <div className="label">中文 CPM</div>
                    <input type="number" min={140} max={320} step={1} value={chineseCharsPerMinute} onChange={(event) => setChineseCharsPerMinute(Number(event.target.value))} />
                  </label>
                </div>
                <label className="field">
                  <div className="label">示例文字</div>
                  <textarea value={sampleText} onChange={(event) => setSampleText(event.target.value)} rows={3} />
                </label>
                <div className="calibrationActions">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => props.onGenerateSpeedSample(draftSpeedMultiplier, sampleText)}
                    disabled={props.speedSampleState === "generating" || !sampleText.trim()}
                  >
                    {props.speedSampleState === "generating" ? "生成中…" : "生成示例音频"}
                  </button>
                  <button
                    className="btnPrimary"
                    type="button"
                    onClick={() => {
                      props.onApplyTargetSpeakingRates(englishWordsPerMinute, chineseCharsPerMinute)
                      setApplyNotice(`已应用目标语速：英语 ${englishWordsPerMinute} WPM，中文 ${chineseCharsPerMinute} CPM。已有音频需要重新生成后才会更新。`)
                    }}
                  >
                    应用到全局
                  </button>
                </div>
                {props.speedSampleUrl ? <audio className="samplePlayer" controls src={props.speedSampleUrl} /> : null}
                {applyNotice ? <div className="inlineSuccess" role="status">{applyNotice}</div> : null}
                {props.speedSampleError ? <div className="inlineError">{props.speedSampleError}</div> : null}
              </div>
              <details className="settingsDetails"><summary>朗读风格</summary><label className="field">
                <div className="label">全局朗读指令</div>
                <textarea value={props.stylePrompt} onChange={(event) => props.onStylePromptChange(event.target.value)} rows={5} placeholder="例如：整体像正式高考英语听力，旁白清楚，对话自然，题号短促。" />
              </label>
              <div className="strategyNote">
                仅支持朗读指令的模型会使用此设置。
              </div></details>
            </div>
          ) : null}

          {active === "advanced" ? (
            <div className="settingsForm">
              <label className="field">
                <div className="label">Base URL</div>
                <input value={props.baseUrl} onChange={(event) => props.onBaseUrlChange(event.target.value)} placeholder={provider.defaultBaseUrl} />
              </label>
              {props.provider === "dashscope" ? (
                <>
                  <div className="strategyNote">
                    DashScope 的 API Key 分“北京/国际”区域：如果你使用国际（新加坡）Key，请把 Base URL 改为 https://dashscope-intl.aliyuncs.com/api/v1；否则会出现 Model not exist。
                  </div>
                  <label className="field">
                    <div className="label">DashScope Language</div>
                    <select aria-label="DashScope Language" value={props.languageType} onChange={(event) => props.onLanguageTypeChange(event.target.value)}>
                      {["Auto", "Chinese", "English", "German", "Italian", "Portuguese", "Spanish", "Japanese", "Korean", "French", "Russian"].map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
              {props.provider === "google" ? <div className="strategyNote">Google TTS 需要能访问 texttospeech.googleapis.com；如在网络受限环境，请在 Base URL 填写你自己的代理/网关地址。</div> : null}
              <p className="settingsHelp">默认配置通常无需修改。</p>
            </div>
          ) : null}
        </div>
        <div className="settingsFooter"><span>已有音频需重新生成才会应用新设置。</span></div>
    </section>
  )
}
