import { useEffect, useRef, useState } from "react"
import type { ProviderConfig, ProviderId, VoicePreset } from "../types"
import { providerGuides } from "../lib/providerGuides"

type Props = {
  providers: ProviderConfig[]
  provider?: ProviderConfig
  onProviderChange: (id: ProviderId) => void
  credentials: Record<string, string>
  onCredentialsChange: (value: Record<string, string>) => void
  modelId: string
  onModelChange: (value: string) => void
  voiceId: string
  voices: VoicePreset[]
  onVoiceChange: (value: string) => void
  baseUrl: string
  onContinue: () => void
  onAdvanced: () => void
}

export function ServiceHub(props: Props) {
  const [filter, setFilter] = useState<"china" | "all">("china")
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string; url?: string; detail?: string } | null>(null)
  const controller = useRef<AbortController | null>(null)
  const provider = props.provider
  const guide = provider && providerGuides[provider.id]
  useEffect(() => {
    controller.current?.abort()
    setTesting(false)
    setResult(null)
    return () => controller.current?.abort()
  }, [provider?.id, props.modelId, props.voiceId, props.credentials, props.baseUrl])

  async function testConnection() {
    if (!provider) return
    const current = new AbortController()
    controller.current = current
    setTesting(true)
    setResult(null)
    try {
      const res = await fetch(`/api/providers/${provider.id}/test`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        signal: AbortSignal.any([current.signal, AbortSignal.timeout(90000)]),
        body: JSON.stringify({ credentials: props.credentials, model: props.modelId, voice: props.voiceId, baseUrl: props.baseUrl })
      })
      const data = await res.json() as { error?: string; detail?: string; url?: string }
      if (!res.ok || !data.url) { setResult({ ok: false, message: data.error || "测试失败，请稍后重试。", detail: data.detail }); return }
      setResult({ ok: true, message: "连接成功，短样例已生成。试听满意后即可开始制作。", url: data.url })
    } catch (err) {
      if (!current.signal.aborted) setResult({ ok: false, message: err instanceof Error && err.name === "TimeoutError" ? "服务响应超时，请稍后重试。" : "连接中断，请检查网络并重试。" })
    } finally { if (controller.current === current) setTesting(false) }
  }

  const missing = provider?.credentialFields.filter(field => field.required && !props.credentials[field.key]?.trim()) || []
  const ready = provider?.serverConfigured || !missing.length
  return <section className="serviceHub">
    <div className="sectionHeading"><div><h2>选好声音，制作更顺手。</h2><p>先试听，再开始制作。</p></div><div className="hubFilters"><button className={filter === "china" ? "active" : ""} onClick={() => setFilter("china")}>国内服务</button><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部服务</button></div></div>
    <button className="btn mobileConnectionJump" onClick={() => document.getElementById("service-connection")?.scrollIntoView({ block: "start" })}>连接当前服务 ↓</button>
    <div className="hubLayout"><div className="serviceCards">
      {props.providers.filter(item => item.status === "ready" && (filter === "all" || item.region === "china")).map(item => {
        const info = providerGuides[item.id]
        return <button key={item.id} className={`serviceCard ${item.id === provider?.id ? "selected" : ""}`} onClick={() => {
          props.onProviderChange(item.id)
          if (window.matchMedia("(max-width: 1000px)").matches) requestAnimationFrame(() => document.getElementById("service-connection")?.scrollIntoView({ block: "start" }))
        }}>
          <div className="serviceCardHead"><span className={`serviceMonogram service-${item.id}`}>{item.label.slice(0, 1)}</span><span className="serviceTag">{info?.badge || (item.id === "volcengine" ? "旧版兼容" : "全球服务")}</span><span className="serviceRadio" aria-hidden="true" /></div>
          <h3>{item.label}</h3><p>{info?.bestFor || item.description}</p><span className="serviceStatus">{item.serverConfigured ? "● 服务器已配置" : "○ 需要连接账号"}</span>
        </button>
      })}
      <div className="freePreviewCard"><span className="serviceTag">免费 · 无需注册</span><h3>系统声音快速试听</h3><p>使用电脑／手机自带的朗读声音预览一句英文。音色取决于设备，仅供试听，不能导出音频文件。</p><button className="btn" onClick={() => {
        if (!("speechSynthesis" in window)) { setResult({ ok: false, message: "当前浏览器不支持系统朗读。" }); return }
        speechSynthesis.cancel()
        const utterance = new SpeechSynthesisUtterance("Good morning. Welcome to our English listening practice.")
        utterance.lang = "en-GB"; utterance.rate = 0.85; speechSynthesis.speak(utterance)
      }}>▷ 免费试听一句</button><a href="https://github.com/QwenLM/Qwen3-TTS" target="_blank" rel="noreferrer">开源自部署选项 ↗</a></div>
    </div>
    {provider ? <aside className="connectionPanel" id="service-connection" key={provider.id}>
      <h3>连接 {provider.label}</h3>
      {guide ? <><div className="officialLinks"><a href={guide.signup} target="_blank" rel="noreferrer">注册 / 开通 ↗</a><a href={guide.keys} target="_blank" rel="noreferrer">获取密钥 ↗</a><a href={guide.pricing} target="_blank" rel="noreferrer">官方价格 ↗</a></div><details className="serviceDetails"><summary>接入说明与计费</summary><p>{guide.cost}</p><ol className="connectSteps">{guide.steps.map(step => <li key={step}>{step}</li>)}</ol></details></> : <p>{provider.description}</p>}
      {provider.serverConfigured && <p className="inlineSuccess">服务器已配置密钥，可以直接测试。</p>}
      {provider.credentialFields.filter(field => (!provider.serverConfigured || field.type !== "password") && (field.key !== "workspaceId" || props.modelId.startsWith("qwen-audio-"))).map(field => <label className="field" key={field.key}><span className="label">{field.label}{field.required ? " *" : ""}</span><input type={field.type === "password" ? "password" : "text"} autoComplete="off" value={props.credentials[field.key] || ""} placeholder={field.placeholder} onChange={e => props.onCredentialsChange({ ...props.credentials, [field.key]: e.target.value })} /></label>)}
      <label className="field"><span className="label">模型</span><select value={props.modelId} onChange={e => props.onModelChange(e.target.value)}>{provider.models.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="field"><span className="label">试听音色</span><select value={props.voiceId} onChange={e => props.onVoiceChange(e.target.value)}>{props.voices.map(voice => <option key={voice.id} value={voice.id}>{voice.label}</option>)}</select></label>
      <button className="btnPrimary connectionTest" disabled={!ready || testing || !props.modelId} onClick={() => void testConnection()}>{testing ? "正在测试并生成短样例…" : "测试连接并试听"}</button><small>短句试听按服务商计费。密钥仅保存在当前会话。</small>
      {result ? <div className={result.ok ? "connectionResult success" : "connectionResult error"} role="status"><p>{result.message}</p>{result.url ? <audio controls src={result.url} /> : null}{result.detail ? <details><summary>查看服务商返回信息</summary><p>{result.detail}</p></details> : null}</div> : null}
      <button className="btn connectionContinue" onClick={props.onContinue}>返回文稿制作 →</button><button className="textButton" onClick={props.onAdvanced}>制作设置 →</button>
      <p className="catalogDate">资料核对：2026-10-12 · 价格与权益以官方控制台为准。{guide ? <a href={guide.docs} target="_blank" rel="noreferrer">接口文档 ↗</a> : null}</p>
    </aside> : null}</div>
  </section>
}
