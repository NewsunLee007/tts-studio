import type { ProviderConfig } from "../types"

type Props = {
  workspaceView: "script" | "studio" | "export" | "services" | "settings" | "local"
  provider?: ProviderConfig
  bulkRunning: boolean
  bulkProgressText: string
  onGenerateAll: () => void
  onRetryFailed: () => void
  onStopGenerateAll: () => void
  hasPendingGeneration: boolean
  stats: {
    total: number
    tts: number
    generated: number
    errors: number
    queued: number
    silence: number
    totalTime: string
    progress: number
  }
}

export function TopBar(props: Props) {
  const providerLabel = props.provider?.label || "未选择服务商"
  const statusText = props.bulkRunning
    ? props.bulkProgressText || "正在生成语音"
    : props.stats.errors
      ? `${props.stats.errors} 项需要处理`
      : props.stats.tts && props.stats.generated === props.stats.tts
        ? "语音已全部就绪"
        : props.stats.total
          ? "文稿已拆分，可以生成"
          : "请先粘贴文稿"

  return (
    <header className="topbar">
      <div className="topbarRow">
        <div className="brand">
          <div className="brandMark" aria-hidden="true">听</div>
          <div className="brandCopy">
            <h1 className="brandTitle">听力音频工作台</h1>
          </div>
        </div>

        {props.workspaceView === "studio" || props.bulkRunning ? <div className="projectPulse" aria-live="polite">
          <div className="projectPulseHead">
            <span className="providerBadge">{providerLabel}</span>
            <strong>{statusText}</strong>
          </div>
          <div className="projectProgressTrack" aria-label={`生成进度 ${props.stats.progress}%`}>
            <span style={{ width: `${props.stats.progress}%` }} />
          </div>
        </div> : null}

        <div className="topbarActions">
          {props.workspaceView === "studio" ? <button className="btnPrimary topbarGenerate" type="button" onClick={props.onGenerateAll} disabled={props.bulkRunning || !props.hasPendingGeneration}>
            {props.bulkRunning ? "正在生成…" : props.hasPendingGeneration ? `生成剩余 ${Math.max(0, props.stats.tts - props.stats.generated)} 段` : props.stats.total ? "语音已就绪" : "等待文稿"}
          </button> : null}
          {props.workspaceView === "studio" && props.stats.errors ? (
            <button className="btn" type="button" onClick={props.onRetryFailed} disabled={props.bulkRunning}>
              重试失败项
            </button>
          ) : null}
          {props.bulkRunning ? <button className="btnGhost" type="button" onClick={props.onStopGenerateAll}>停止</button> : null}
        </div>
      </div>
    </header>
  )
}
