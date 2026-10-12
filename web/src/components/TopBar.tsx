import type { ProviderConfig } from "../types"

type Props = {
  workspaceView: "script" | "studio" | "export" | "services" | "settings" | "local"
  provider?: ProviderConfig
  bulkRunning: boolean
  bulkProgressText: string
  onStopGenerateAll: () => void
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

        {props.bulkRunning && props.workspaceView !== "studio" ? <div className="projectPulse" aria-live="polite">
          <div className="projectPulseHead">
            <span className="providerBadge">{providerLabel}</span>
            <strong>{statusText}</strong>
          </div>
          <div className="projectProgressTrack" aria-label={`生成进度 ${props.stats.progress}%`}>
            <span style={{ width: `${props.stats.progress}%` }} />
          </div>
        </div> : null}

        <div className="topbarActions">
          {props.bulkRunning && props.workspaceView !== "studio" ? <button className="btnGhost" type="button" onClick={props.onStopGenerateAll}>停止</button> : null}
        </div>
      </div>
    </header>
  )
}
