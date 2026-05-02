import path from "node:path"
import { promises as fs } from "node:fs"

export const dataDir = path.join(process.cwd(), "data")
export const segmentsDir = path.join(dataDir, "segments")
export const exportsDir = path.join(dataDir, "exports")
export const jobsDir = path.join(dataDir, "jobs")

export async function ensureStorageDirs() {
  await fs.mkdir(segmentsDir, { recursive: true })
  await fs.mkdir(exportsDir, { recursive: true })
  await fs.mkdir(jobsDir, { recursive: true })
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
