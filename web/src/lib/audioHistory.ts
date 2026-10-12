export type AudioHistoryEntry = {
  url: string
  title: string
  kind: "segment" | "export"
  createdAt: string
  expiresAt?: string
}

export function parseAudioHistory(value: unknown): AudioHistoryEntry[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is AudioHistoryEntry => item && typeof item.url === "string" && /^\/(audio|exports)\/[0-9a-f-]{36}\.(mp3|wav)$/.test(item.url) && typeof item.title === "string" && typeof item.createdAt === "string" && (item.kind === "export" || item.kind === "segment") && (item.expiresAt === undefined || typeof item.expiresAt === "string"))
}

export function mergeAudioHistory(history: AudioHistoryEntry[], entry: AudioHistoryEntry) {
  // No credentials or full manuscripts belong in the download ledger.
  if (!/^\/(?:audio|exports)\/[0-9a-f-]{36}\.(?:mp3|wav)$/.test(entry.url)) return history
  return [{ ...entry, title: entry.title.slice(0, 100) }, ...history.filter(item => item.url !== entry.url)].slice(0, 1000)
}

export function remainingAudioTime(expiresAt: string | undefined, now: number) {
  if (!expiresAt || !Number.isFinite(Date.parse(expiresAt))) return "下载时核验有效期"
  const ms = Date.parse(expiresAt) - now
  if (ms <= 0) return "已过期"
  const minutes = Math.ceil(ms / 60000)
  if (minutes < 60) return `剩余 ${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `剩余 ${hours} 小时` : `剩余 ${Math.floor(hours / 24)} 天 ${hours % 24} 小时`
}
