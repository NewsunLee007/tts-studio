import type { ProviderConfig } from "../types"

type Props = {
  provider?: ProviderConfig
  bulkRunning: boolean
  bulkProgressText: string
  onGenerateAll: () => void
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
              <h1 className="brandTitle">英语听力音频制作</h1>
              <div className="brandSub">粘贴文稿，检查顺序，生成并下载</div>
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
              {props.bulkRunning ? "正在生成…" : props.hasPendingGeneration ? "生成全部语音" : "语音已全部生成"}
            </button>
            {props.stats.errors ? (
              <button className="btn" type="button" onClick={props.onRetryFailed} disabled={props.bulkRunning}>
                重试失败项
              </button>
            ) : null}
            {props.bulkRunning ? (
              <button className="btnGhost" type="button" onClick={props.onStopGenerateAll}>
                停止
              </button>
            ) : null}
          </div>

          <div className="actionCluster actionClusterExport">
            <select className="formatSelect" aria-label="导出格式" value={props.exportFormat} onChange={(e) => props.onExportFormatChange(e.target.value === "wav" ? "wav" : "mp3")}>
              <option value="mp3">MP3</option>
              <option value="wav">WAV</option>
            </select>
            <button className="btnAccent" type="button" onClick={props.onCompose} disabled={!props.canCompose || props.composeRunning}>
              {props.composeRunning ? "正在合成…" : "合成并下载"}
            </button>
            {props.lastExportUrl ? (
              <button className="btn" type="button" onClick={props.onDownloadLast} disabled={props.composeRunning}>
                再次下载
              </button>
            ) : null}
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
      <nav className="teacherSteps" aria-label="制作步骤">
        <span className={props.stats.total ? "teacherStep teacherStepDone" : "teacherStep teacherStepActive"}><b>1</b> 粘贴文稿</span>
        <span className={props.stats.total && !props.stats.generated ? "teacherStep teacherStepActive" : "teacherStep"}><b>2</b> 检查片段</span>
        <span className={props.stats.generated && props.stats.generated < props.stats.tts ? "teacherStep teacherStepActive" : props.stats.generated ? "teacherStep teacherStepDone" : "teacherStep"}><b>3</b> 生成语音</span>
        <span className={props.canCompose ? "teacherStep teacherStepActive" : "teacherStep"}><b>4</b> 合并下载</span>
      </nav>
    </header>
  )
}
