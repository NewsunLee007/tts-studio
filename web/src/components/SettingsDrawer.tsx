import { useEffect, useMemo, useState } from "react"
import type { EnglishAccentId, ExamTemplate, PacePreset, ProviderConfig, ProviderId, VoiceGender } from "../types"

type Props = {
  open: boolean
  providers: ProviderConfig[]
  provider: ProviderId
  onProviderChange: (provider: ProviderId) => void
  credentials: Record<string, string>
  onCredentialsChange: (value: Record<string, string>) => void
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
  onClose: () => void
}

type TabId = "providers" | "voice" | "exam" | "strategy" | "advanced"

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "providers", label: "服务商" },
  { id: "voice", label: "模型与音色" },
  { id: "exam", label: "考试模板" },
  { id: "strategy", label: "生成策略" },
  { id: "advanced", label: "高级参数" }
]

const providerSetupGuide: Partial<Record<ProviderId, { title: string; steps: string[]; links: Array<{ label: string; url: string }> }>> = {
  google: {
    title: "Google Cloud TTS 接入",
    steps: ["创建或选择 Google Cloud 项目。", "启用 Cloud Text-to-Speech API，并确认项目已绑定结算账号。", "在 APIs & Services → Credentials 创建 API key。", "中国大陆网络通常无法直连 Google API，需要把 Base URL 配置为可访问的代理网关。"],
    links: [
      { label: "Google TTS 开始使用", url: "https://cloud.google.com/text-to-speech/docs/before-you-begin" },
      { label: "Google API 密钥", url: "https://console.cloud.google.com/apis/credentials" },
      { label: "启用 Text-to-Speech API", url: "https://console.cloud.google.com/apis/library/texttospeech.googleapis.com" }
    ]
  },
  dashscope: {
    title: "阿里云 DashScope / 百炼接入",
    steps: ["登录阿里云百炼控制台。", "创建或复制 API Key。", "确认账号地域与 Base URL 一致：国内默认 dashscope.aliyuncs.com，国际账号使用 dashscope-intl.aliyuncs.com。", "优先尝试 CosyVoice 模型，Qwen-TTS 作为兼容回退。"],
    links: [
      { label: "获取 DashScope API Key", url: "https://help.aliyun.com/zh/model-studio/get-api-key" },
      { label: "CosyVoice API", url: "https://help.aliyun.com/zh/model-studio/non-realtime-cosyvoice-api" },
      { label: "TTS 模型列表", url: "https://help.aliyun.com/zh/model-studio/tts-model" }
    ]
  },
  volcengine: {
    title: "火山引擎语音接入",
    steps: ["开通火山引擎语音合成服务。", "在控制台获取 App ID、Access Token 和可用 cluster。", "确认音色 voice_type 已在账号中开通。"],
    links: [
      { label: "火山引擎语音技术控制台", url: "https://console.volcengine.com/speech" },
      { label: "火山引擎文档中心", url: "https://www.volcengine.com/docs" }
    ]
  },
  xfyun: {
    title: "讯飞在线语音合成接入",
    steps: ["在讯飞开放平台创建在线语音合成应用。", "复制 AppID、APIKey、APISecret。", "如果使用精品发音人，需要在控制台确认发音人已开通。"],
    links: [
      { label: "讯飞在线语音合成 API", url: "https://www.xfyun.cn/doc/tts/online_tts/API.html" },
      { label: "讯飞开放平台控制台", url: "https://console.xfyun.cn/" }
    ]
  },
  tencent: {
    title: "腾讯云 TTS 接入",
    steps: ["开通腾讯云文本转语音服务。", "在访问管理中获取 SecretId 和 SecretKey。", "Region 默认可用 ap-guangzhou；英文音色需确认账号支持对应 VoiceType。"],
    links: [
      { label: "腾讯云文本转语音文档", url: "https://cloud.tencent.com/document/product/1073" },
      { label: "腾讯云 API 密钥", url: "https://console.cloud.tencent.com/cam/capi" }
    ]
  },
  openai: {
    title: "OpenAI TTS 接入",
    steps: ["登录 OpenAI Platform。", "创建 API key。", "确认项目额度和模型权限。"],
    links: [
      { label: "OpenAI API Keys", url: "https://platform.openai.com/api-keys" },
      { label: "OpenAI Text to Speech 文档", url: "https://platform.openai.com/docs/guides/text-to-speech" }
    ]
  }
}

function credentialState(provider: ProviderConfig, credentials: Record<string, string>) {
  const missing = provider.credentialFields.filter((field) => field.required && !credentials[field.key]?.trim())
  if (provider.status !== "ready") return { label: "预留入口", className: "providerStateMuted" }
  if (missing.length) return { label: `缺少 ${missing.length} 项`, className: "providerStateWarn" }
  return { label: "已配置", className: "providerStateReady" }
}

function secondsFromMs(value: number | undefined, fallback: number) {
  const ms = typeof value === "number" && Number.isFinite(value) ? value : fallback
  return Math.max(0, Number((ms / 1000).toFixed(1)))
}

export function SettingsDrawer(props: Props) {
  const [active, setActive] = useState<TabId>("providers")
  const [showReserved, setShowReserved] = useState(false)
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
  const setupGuide = providerSetupGuide[props.provider]
  const voiceOptions = useMemo(() => {
    const list = provider?.voices || []
    const filtered = props.voiceGender === "all" ? list : list.filter((voice) => voice.gender === props.voiceGender)
    return Array.from(new Map(filtered.map((voice) => [voice.id, voice])).values())
  }, [provider, props.voiceGender])
  const geminiMaleVoices = useMemo(() => (provider?.voices || []).filter((voice) => voice.gender === "male"), [provider])
  const geminiFemaleVoices = useMemo(() => (provider?.voices || []).filter((voice) => voice.gender === "female"), [provider])

  const providerCards = useMemo(() => {
    const list = showReserved ? props.providers : props.providers.filter((item) => item.status === "ready" || item.id === props.provider)
    return [...list].sort((a, b) => (a.status === b.status ? 0 : a.status === "ready" ? -1 : 1))
  }, [props.providers, props.provider, showReserved])

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

  if (!props.open || !provider) return null

  return (
    <div className="settingsLayer" role="dialog" aria-modal="true" aria-label="settings">
      <button className="settingsScrim" type="button" onClick={props.onClose} aria-label="关闭设置背景" />
      <aside className="settingsDrawer">
        <div className="settingsHead">
          <div>
            <div className="settingsEyebrow">Production Settings</div>
            <div className="settingsTitle">听力制作设置</div>
          </div>
          <button className="iconButton" type="button" onClick={props.onClose} aria-label="关闭设置">
            ×
          </button>
        </div>

        <div className="settingsTabs" role="tablist">
          {tabs.map((tab) => (
            <button key={tab.id} type="button" className={active === tab.id ? "settingsTab settingsTabActive" : "settingsTab"} onClick={() => setActive(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="settingsBody">
          {active === "providers" ? (
            <>
              <label className="checkRow" style={{ marginBottom: 12 }}>
                <input type="checkbox" checked={showReserved} onChange={(event) => setShowReserved(event.target.checked)} />
                <span>显示预留入口</span>
              </label>
              <div className="providerGrid">
                {providerCards.map((item) => {
                const state = credentialState(item, item.id === props.provider ? props.credentials : {})
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={item.id === props.provider ? "providerCard providerCardActive" : "providerCard"}
                    onClick={() => props.onProviderChange(item.id)}
                  >
                    <div className="providerTop">
                      <span>{item.label}</span>
                      <em className={state.className}>{state.label}</em>
                    </div>
                    <p>{item.description}</p>
                    <div className="providerMeta">{item.models.length} 模型 · {item.voices.length} 音色 · {item.region === "china" ? "中国服务商" : "全球服务"}</div>
                    <div className="capList">
                      {item.capabilities.slice(0, 4).map((cap) => (
                        <span key={cap}>{cap}</span>
                      ))}
                    </div>
                  </button>
                )
                })}
              </div>
            </>
          ) : null}

          {active === "voice" ? (
            <div className="settingsForm">
              <div className="settingsSectionRow">
                <div>
                  <div className="settingsSectionTitle">{provider.label}</div>
                  <div className="modalSub">可先填写密钥，再从服务端尝试刷新该服务商的模型/音色列表。</div>
                </div>
                <button className="btn" type="button" onClick={props.onRefreshCatalog} disabled={props.catalogState === "loading"}>
                  {props.catalogState === "loading" ? "刷新中…" : "刷新模型/音色"}
                </button>
              </div>
              {setupGuide ? (
                <div className="setupGuide">
                  <div className="setupGuideTitle">{setupGuide.title}</div>
                  <ol>
                    {setupGuide.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  <div className="setupLinks">
                    {setupGuide.links.map((link) => (
                      <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                        {link.label}
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
              {props.catalogMessage ? <div className={props.catalogState === "error" ? "inlineError" : "inlineSuccess"}>{props.catalogMessage}</div> : null}
              {provider.credentialFields.map((field) => (
                <label className="field" key={field.key}>
                  <div className="label">{field.label}{field.required ? " *" : ""}</div>
                  <input
                    type={field.type === "password" || field.key === "proxyUrl" ? "password" : "text"}
                    value={props.credentials[field.key] || ""}
                    placeholder={field.placeholder}
                    autoComplete="off"
                    onChange={(event) => props.onCredentialsChange({ ...props.credentials, [field.key]: event.target.value })}
                  />
                </label>
              ))}

              <label className="field">
                <div className="label">模型</div>
                <select value={props.modelId} onChange={(event) => props.onModelIdChange(event.target.value)}>
                  {provider.models.map((model) => (
                    <option key={model.id} value={model.id}>{model.label}</option>
                  ))}
                </select>
              </label>

              <div className="field">
                <div className="label">音色筛选</div>
                <div className="segmented">
                  {(["all", "female", "male", "neutral"] as const).map((gender) => (
                    <button key={gender} type="button" className={props.voiceGender === gender ? "segBtn segBtnActive" : "segBtn"} onClick={() => props.onVoiceGenderChange(gender)}>
                      {gender === "all" ? "全部" : gender === "female" ? "女声" : gender === "male" ? "男声" : "中性"}
                    </button>
                  ))}
                </div>
              </div>

              <label className="field">
                <div className="label">默认音色</div>
                <select value={props.voiceId} onChange={(event) => props.onVoiceIdChange(event.target.value)}>
                  {voiceOptions.map((voice) => (
                    <option key={voice.id} value={voice.id}>{voice.label}</option>
                  ))}
                </select>
              </label>
              {props.provider === "google_gemini" ? (
                <div className="settingsTwoCol">
                  <label className="field">
                    <div className="label">对话男声（M/A）</div>
                    <select value={props.geminiMaleVoiceId} onChange={(event) => props.onGeminiMaleVoiceIdChange(event.target.value)}>
                      {geminiMaleVoices.map((voice) => (
                        <option key={voice.id} value={voice.id}>{voice.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <div className="label">对话女声（W/B）</div>
                    <select value={props.geminiFemaleVoiceId} onChange={(event) => props.onGeminiFemaleVoiceIdChange(event.target.value)}>
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
              <div className="settingsTwoCol">
                <label className="field">
                  <div className="label">学校</div>
                  <input value={props.template.school} onChange={(event) => props.onTemplateChange({ school: event.target.value })} />
                </label>
                <label className="field">
                  <div className="label">年级</div>
                  <input value={props.template.grade} onChange={(event) => props.onTemplateChange({ grade: event.target.value })} placeholder="高二" />
                </label>
                <label className="field">
                  <div className="label">学年</div>
                  <input value={props.template.schoolYear} onChange={(event) => props.onTemplateChange({ schoolYear: event.target.value })} />
                </label>
                <label className="field">
                  <div className="label">学期</div>
                  <input value={props.template.semester} onChange={(event) => props.onTemplateChange({ semester: event.target.value })} />
                </label>
                <label className="field">
                  <div className="label">考试名称</div>
                  <input value={props.template.examName} onChange={(event) => props.onTemplateChange({ examName: event.target.value })} />
                </label>
                <label className="field">
                  <div className="label">科目</div>
                  <input value={props.template.subject} onChange={(event) => props.onTemplateChange({ subject: event.target.value })} />
                </label>
              </div>
              <label className="checkRow">
                <input type="checkbox" checked={props.template.includeIntroMusic} onChange={(event) => props.onTemplateChange({ includeIntroMusic: event.target.checked })} />
                <span>导入音乐</span>
              </label>
              <label className="checkRow">
                <input type="checkbox" checked={props.template.includeExamIntro} onChange={(event) => props.onTemplateChange({ includeExamIntro: event.target.checked })} />
                <span>生成考试介绍音频</span>
              </label>
              <label className="checkRow">
                <input type="checkbox" checked={props.template.includeQuestionNumbers} onChange={(event) => props.onTemplateChange({ includeQuestionNumbers: event.target.checked })} />
                <span>自动插入题号语音和提示音</span>
              </label>
              <label className="field">
                <div className="label">题号播报格式</div>
                <select value={props.template.questionNumberStyle} onChange={(event) => props.onTemplateChange({ questionNumberStyle: event.target.value === "test" ? "test" : "number" })}>
                  <option value="number">Number 1 / Number 2</option>
                  <option value="test">Test 1 / Test 2</option>
                </select>
              </label>
              <label className="field">
                <div className="label">导入音乐</div>
                <select value={props.template.introMusicPreset} onChange={(event) => props.onTemplateChange({ introMusicPreset: event.target.value as ExamTemplate["introMusicPreset"] })}>
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
                    <p>用于新拆分的考试脚本，也可一键更新当前片段中的大题/小题间隔。</p>
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
                    一键应用间隔
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
                  value={props.englishAccent}
                  onChange={(event) => {
                    props.onEnglishAccentChange(event.target.value as EnglishAccentId)
                    const next = props.englishAccentOptions.find((item) => item.id === event.target.value)
                    setApplyNotice(`已切换为${next?.label || "新的发音标准"}。已有音频需要重新生成后才会更新。`)
                  }}
                >
                  {props.englishAccentOptions.map((accent) => (
                    <option key={accent.id} value={accent.id}>{accent.label} · {accent.description}</option>
                  ))}
                </select>
              </label>
              <div className="strategyNote">
                当前默认使用英式标准。Google 等具备英音音色的服务商会优先使用 en-GB 音色；阿里等不区分英美音色的服务商会通过导演提示约束发音。
              </div>
              <div className="speedCalibrator">
                <div className="speedCalibratorHead">
                  <div>
                    <div className="label">目标语速控制</div>
                    <p>英语按每分钟单词数控制，中文按每分钟汉字数控制；系统会自动换算到底层服务商的倍率参数。</p>
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
              <label className="field">
                <div className="label">全局导演提示</div>
                <textarea value={props.stylePrompt} onChange={(event) => props.onStylePromptChange(event.target.value)} rows={5} placeholder="例如：整体像正式高考英语听力，旁白清楚，对话自然，题号短促。" />
              </label>
              <div className="strategyNote">
                脚本导演会先根据全文分配角色、题号、停顿和语气，再逐段调用 TTS。支持指令的服务商会收到导演提示；不支持的服务商会降级到音色、语速和停顿。
              </div>
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
                    <select value={props.languageType} onChange={(event) => props.onLanguageTypeChange(event.target.value)}>
                      {["Auto", "Chinese", "English", "German", "Italian", "Portuguese", "Spanish", "Japanese", "Korean", "French", "Russian"].map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
              {props.provider === "google" ? <div className="strategyNote">Google TTS 需要能访问 texttospeech.googleapis.com；如在网络受限环境，请在 Base URL 填写你自己的代理/网关地址。</div> : null}
              <div className="strategyNote">高级参数用于兼容私有网关或服务商代理。一般不需要修改。</div>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  )
}
