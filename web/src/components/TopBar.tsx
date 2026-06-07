import type { ProviderConfig } from "../types"

type Props = {
  provider?: ProviderConfig
  bulkRunning: boolean
  bulkProgressText: string
  onGenerateAll: () => void
  onGenerateSelected: () => void
  onRetryFailed: () => void
  onStopGenerateAll: () => void
  hasPendingGeneration: boolean
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
          <div className="brandLayout">
            <div className="brandCopy">
              <div className="brandTitle">听力音频制作台</div>
              <div className="brandSub">脚本拆分 · 逐句配音 · 合成导出</div>
            </div>
            <div className="providerBadge">
              <span>当前服务商</span>
              <strong>{providerLabel}</strong>
            </div>
          </div>
        </div>

        <div className="topbarActions">
          <div className="actionCluster">
            <button className="btnPrimary" type="button" onClick={props.onGenerateAll} disabled={props.bulkRunning || !props.hasPendingGeneration}>
              {props.bulkRunning ? "队列中…" : props.hasPendingGeneration ? "生成未完成" : "全部已生成"}
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
            <select className="formatSelect" aria-label="导出格式" value={props.exportFormat} onChange={(e) => props.onExportFormatChange(e.target.value === "wav" ? "wav" : "mp3")}>
              <option value="mp3">MP3</option>
              <option value="wav">WAV</option>
            </select>
            <button className="btnAccent" type="button" onClick={props.onCompose} disabled={!props.canCompose || props.composeRunning}>
              {props.composeRunning ? "合成中…" : "合成"}
            </button>
            <button className="btn" type="button" onClick={props.onDownloadLast} disabled={!props.lastExportUrl || props.composeRunning}>
              下载
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
