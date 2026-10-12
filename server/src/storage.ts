import path from "node:path"
import { promises as fs } from "node:fs"
import { createHash } from "node:crypto"

type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>

export type AudioBlobKind = "segment" | "export"
export type AudioBlobRecord = {
  id: string
  kind: AudioBlobKind
  contentType: string
  bytes: Buffer
}

const useObjectStorage = Boolean(process.env.AUDIO_STORAGE_URL && process.env.AUDIO_STORAGE_TOKEN)
const useDatabaseStorage = !useObjectStorage && Boolean(process.env.DATABASE_URL)
let sqlClientPromise: Promise<SqlClient> | undefined
let storageReadyPromise: Promise<void> | undefined

export const dataDir = useDatabaseStorage || useObjectStorage ? path.join("/tmp", "text-to-speech-data") : path.join(process.cwd(), "data")
export const segmentsDir = path.join(dataDir, "segments")
export const exportsDir = path.join(dataDir, "exports")
export const jobsDir = path.join(dataDir, "jobs")

export async function ensureStorageDirs() {
  await fs.mkdir(segmentsDir, { recursive: true })
  await fs.mkdir(exportsDir, { recursive: true })
  await fs.mkdir(jobsDir, { recursive: true })
}

async function getSqlClient(): Promise<SqlClient> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for database audio storage")
  }
  sqlClientPromise ||= import("@neondatabase/serverless").then(({ neon }) => neon(process.env.DATABASE_URL || "") as SqlClient)
  return sqlClientPromise
}

async function ensureDatabaseStorage() {
  if (!useDatabaseStorage) return
  const sql = await getSqlClient()
  await sql`
    create table if not exists audio_blobs (
      id text not null,
      kind text not null,
      content_type text not null,
      bytes bytea not null,
      created_at timestamptz not null default now(),
      primary key (id, kind)
    )
  `
}

export async function ensureStorage() {
  storageReadyPromise ||= (async () => {
    await ensureStorageDirs()
    await ensureDatabaseStorage()
  })()
  await storageReadyPromise
}

export function isDurableStorageEnabled() {
  return useDatabaseStorage || useObjectStorage
}

export function storageBackend() { return useObjectStorage ? "r2" : useDatabaseStorage ? "neon" : "local" }

async function objectStorageFetch(kind: AudioBlobKind, id: string, init: RequestInit = {}, query = "") {
  const url = `${process.env.AUDIO_STORAGE_URL!.replace(/\/+$/, "")}/${kind}/${encodeURIComponent(id)}${query}`
  const headers = new Headers(init.headers)
  headers.set("Authorization", `Bearer ${process.env.AUDIO_STORAGE_TOKEN}`)
  return fetch(url, { ...init, headers, signal: AbortSignal.timeout(60000) })
}

export async function saveAudioBlob(kind: AudioBlobKind, id: string, bytes: Buffer, contentType: string) {
  if (useObjectStorage) {
    // Long WAV exports exceed Cloudflare's request-body limit; send verified 32 MiB parts.
    if (bytes.length > 64 * 1024 * 1024) {
      const started = await objectStorageFetch(kind, id, { method: "POST", headers: { "Content-Type": contentType, "X-Content-SHA256": createHash("sha256").update(bytes).digest("hex") } })
      if (!started.ok) throw new Error(`R2 分块上传初始化失败 (${started.status})`)
      const { uploadId } = await started.json() as { uploadId: string }
      const query = `?${new URLSearchParams({ uploadId })}`
      try {
        const parts: Array<{ partNumber: number; etag: string }> = []
        for (let offset = 0; offset < bytes.length; offset += 32 * 1024 * 1024) {
          const chunk = bytes.subarray(offset, Math.min(offset + 32 * 1024 * 1024, bytes.length))
          const part = await objectStorageFetch(kind, id, { method: "PUT", body: new Uint8Array(chunk), headers: { "X-Content-SHA256": createHash("sha256").update(chunk).digest("hex") } }, `${query}&partNumber=${parts.length + 1}`)
          if (!part.ok) throw new Error(`R2 音频分块保存失败 (${part.status})`)
          parts.push(await part.json() as { partNumber: number; etag: string })
        }
        const completed = await objectStorageFetch(kind, id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parts) }, query)
        if (!completed.ok || (await completed.json() as { size: number }).size !== bytes.length) throw new Error("R2 音频分块合并校验失败")
      } catch (error) {
        await objectStorageFetch(kind, id, { method: "DELETE" }, query).catch(() => {})
        throw error
      }
      return
    }
    const response = await objectStorageFetch(kind, id, { method: "PUT", body: new Uint8Array(bytes), headers: {
      "Content-Type": contentType,
      "X-Content-SHA256": createHash("sha256").update(bytes).digest("hex")
    } })
    if (!response.ok) throw new Error(`R2 音频保存失败 (${response.status})`)
    return
  }
  if (!useDatabaseStorage) return
  const sql = await getSqlClient()
  await sql`
    insert into audio_blobs (id, kind, content_type, bytes)
    values (${id}, ${kind}, ${contentType}, ${bytes})
    on conflict (id, kind)
    do update set content_type = excluded.content_type, bytes = excluded.bytes, created_at = now()
  `
}

export async function readAudioBlob(kind: AudioBlobKind, id: string): Promise<AudioBlobRecord | null> {
  if (useObjectStorage) {
    const response = await objectStorageFetch(kind, id)
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`R2 音频读取失败 (${response.status})`)
    return { id, kind, contentType: response.headers.get("Content-Type") || "audio/mpeg", bytes: Buffer.from(await response.arrayBuffer()) }
  }
  if (!useDatabaseStorage) return null
  const sql = await getSqlClient()
  const rows = (await sql`
    select id, kind, content_type, bytes
    from audio_blobs
    where id = ${id} and kind = ${kind}
    limit 1
  `) as Array<{ id: string; kind: AudioBlobKind; content_type: string; bytes: Buffer | Uint8Array | string }>
  const row = rows[0]
  if (!row) return null
  const bytes = Buffer.isBuffer(row.bytes) ? row.bytes : typeof row.bytes === "string" ? Buffer.from(row.bytes, "base64") : Buffer.from(row.bytes)
  return { id: row.id, kind: row.kind, contentType: row.content_type, bytes }
}

export async function materializeSegment(id: string, dir: string) {
  if (!isDurableStorageEnabled()) return segmentPath(id)
  const record = await readAudioBlob("segment", id)
  if (!record) throw new Error(`音频片段不存在或已过期: ${id}`)
  const filePath = path.join(dir, `${id}.mp3`)
  await fs.writeFile(filePath, record.bytes)
  return filePath
}

export function segmentPath(id: string) {
  return path.join(segmentsDir, `${id}.mp3`)
}

export function exportPath(id: string) {
  return path.join(exportsDir, `${id}.mp3`)
}

export function exportPathWithExt(id: string, ext: "mp3" | "wav") {
  return path.join(exportsDir, `${id}.${ext}`)
}

export function jobDir(id: string) {
  return path.join(jobsDir, id)
}
