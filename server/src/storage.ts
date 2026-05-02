import path from "node:path"
import { promises as fs } from "node:fs"

type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>

export type AudioBlobKind = "segment" | "export"
export type AudioBlobRecord = {
  id: string
  kind: AudioBlobKind
  contentType: string
  bytes: Buffer
}

const useDatabaseStorage = Boolean(process.env.DATABASE_URL)
let sqlClientPromise: Promise<SqlClient> | undefined
let storageReadyPromise: Promise<void> | undefined

export const dataDir = useDatabaseStorage ? path.join("/tmp", "text-to-speech-data") : path.join(process.cwd(), "data")
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

export function isDatabaseStorageEnabled() {
  return useDatabaseStorage
}

export async function saveAudioBlob(kind: AudioBlobKind, id: string, bytes: Buffer, contentType: string) {
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
  if (!useDatabaseStorage) return segmentPath(id)
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
