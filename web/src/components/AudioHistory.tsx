import { useEffect, useState } from "react"
import { remainingAudioTime, type AudioHistoryEntry } from "../lib/audioHistory"

export function AudioHistory({ entries, onMetadata }: { entries: AudioHistoryEntry[]; onMetadata: (items: Array<{ url: string; createdAt?: string; expiresAt?: string }>) => void }) {
  const [now, setNow] = useState(Date.now)
  const [message, setMessage] = useState("")
  const [downloading, setDownloading] = useState("")
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer) }, [])
  const unknownUrls = JSON.stringify(entries.filter(item => !item.expiresAt).map(item => item.url).slice(0, 100))
  useEffect(() => {
    const urls = JSON.parse(unknownUrls) as string[]
    if (!urls.length) return
    const controller = new AbortController()
    void fetch("/api/audio-metadata", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls }), signal: controller.signal })
      .then(async response => { if (response.ok) onMetadata(await response.json()) })
      .catch(() => { /* Keep older records available for an explicit download retry. */ })
    return () => controller.abort()
  }, [unknownUrls, onMetadata])
  async function download(entry: AudioHistoryEntry) {
    setMessage(""); setDownloading(entry.url)
    try {
      const response = await fetch(entry.url, { method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(20000) })
      if (response.status === 404 || response.status === 410) throw new Error("这份录音已过期或已清理，请使用本地保存的文件。")
      if (!response.ok) throw new Error("暂时无法下载，请稍后重试。")
      const link = document.createElement("a")
      link.href = entry.url
      link.download = `${entry.title.replace(/[\\/:*?"<>|]/g, "-")}.${entry.url.endsWith(".wav") ? "wav" : "mp3"}`
      document.body.appendChild(link); link.click(); link.remove()
    } catch (error) { setMessage(error instanceof Error ? error.message : "下载失败，请重试。") }
    finally { setDownloading("") }
  }
  function rows(items: AudioHistoryEntry[]) {
    return <div className="audioHistoryList">{items.map(entry => {
      const expired = Boolean(entry.expiresAt && Date.parse(entry.expiresAt) <= now)
      return <div className="audioHistoryRow" key={entry.url}><div><strong>{entry.title}</strong><small>{entry.createdAt ? new Date(entry.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "较早生成"} · {remainingAudioTime(entry.expiresAt, now)}</small></div><button className="btn" disabled={expired || Boolean(downloading)} onClick={() => void download(entry)}>{expired ? "已过期" : downloading === entry.url ? "检查中…" : "下载"}</button></div>
    })}</div>
  }
  const exports = entries.filter(item => item.kind === "export")
  const segments = entries.filter(item => item.kind === "segment")
  return <section className="audioHistory"><h2>本机历史记录</h2><p>云端保留 7 天，请及时下载保存。记录保存在当前浏览器，清除浏览器数据后会丢失。</p>{exports.length ? rows(exports) : <p>合成后的成品会显示在这里。</p>}{segments.length ? <details><summary>片段录音 · {segments.length}</summary>{rows(segments)}</details> : null}{message ? <p role="status">{message}</p> : null}</section>
}
