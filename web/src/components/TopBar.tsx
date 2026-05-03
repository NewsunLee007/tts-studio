import type { ProviderConfig } from "../types"

type Props = {
  provider?: ProviderConfig
  bulkRunning: boolean
  bulkProgressText: string
  onGenerateAll: () => void
  onGenerateSelected: () => void
  onRetryFailed: () => void
  onStopGenerateAll: () => void
  canCompose: boolean
  composeRunning: boolean
  onCompose: () => void
  lastExportUrl: string
  onDownloadLast: () => void
  exportFormat: "mp3" | "wav"
  onExportFormatChange: (value: "mp3" | "wav") => void
  onOpenSettings: () => void
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

  return (
    <header className="topbar">
      <div className="topbarRow">
        <div className="brand">
          <div className="brandMark" aria-hidden="true">听</div>
          <div>
            <div className="brandTitleRow">
              <div className="brandTitle">听力音频制作台</div>
              <div className="providerBadge">{providerLabel}</div>
            </div>
            <div className="brandSub">脚本拆分 · 逐句配音 · 合成导出</div>
          </div>
        </div>

        <div className="topbarStats" aria-label="project stats">
          <div>
            <strong>{props.stats.total}</strong>
            <span>片段</span>
          </div>
          <div>
            <strong>{props.stats.generated}/{props.stats.tts}</strong>
            <span>已生成</span>
          </div>
          <div>
            <strong>{props.stats.totalTime}</strong>
            <span>预计时长</span>
          </div>
          {props.stats.errors ? (
            <div className="statError">
              <strong>{props.stats.errors}</strong>
              <span>错误</span>
            </div>
          ) : null}
        </div>

        <div className="topbarActions">
          <div className="actionCluster">
            <span className="clusterLabel">生成</span>
            <button className="btnPrimary" type="button" onClick={props.onGenerateAll} disabled={props.bulkRunning}>
              {props.bulkRunning ? "队列中…" : "生成未完成"}
            </button>
            <button className="btn" type="button" onClick={props.onGenerateSelected} disabled={props.bulkRunning}>
              生成选中
            </button>
            <button className="btn" type="button" onClick={props.onRetryFailed} disabled={props.bulkRunning || !props.stats.errors}>
              重试失败
            </button>
            <button className="btnGhost" type="button" onClick={props.onStopGenerateAll} disabled={!props.bulkRunning}>
              停止
            </button>
          </div>

          <div className="actionCluster actionClusterExport">
            <span className="clusterLabel">导出</span>
            <select className="formatSelect" value={props.exportFormat} onChange={(e) => props.onExportFormatChange(e.target.value === "wav" ? "wav" : "mp3")}>
              <option value="mp3">MP3</option>
              <option value="wav">WAV</option>
            </select>
            <button className="btnAccent" type="button" onClick={props.onCompose} disabled={!props.canCompose || props.composeRunning}>
              {props.composeRunning ? "合成中…" : `合成并下载`}
            </button>
            <button className="btn" type="button" onClick={props.onDownloadLast} disabled={!props.lastExportUrl || props.composeRunning}>
              下载成品
            </button>
          </div>

          <div className="actionCluster actionClusterUtility">
            <button className="settingsButton" type="button" onClick={props.onOpenSettings}>
              <span aria-hidden="true">⌘</span>
              <span>设置</span>
            </button>
            <div className="bulkHint" aria-live="polite">
              {props.bulkProgressText || (props.stats.queued ? `${props.stats.queued} 等待` : "")}
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
