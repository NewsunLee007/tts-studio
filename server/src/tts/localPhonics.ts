import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { runFfmpeg } from "../ffmpeg.js"
import type { TtsAudio } from "./types.js"

function runSay(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("/usr/bin/say", args, { stdio: ["ignore", "pipe", "pipe"] })
    let stderr = ""
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8")
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `say exited with code ${code}`))
    })
  })
}

export async function localPhonicsTts(text: string): Promise<TtsAudio> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tts-phonics-"))
  const aiffPath = path.join(dir, "phonics.aiff")
  const mp3Path = path.join(dir, "phonics.mp3")

  try {
    await runSay(["-v", "Daniel", "-r", "130", "-o", aiffPath, text])
    await runFfmpeg(["-y", "-i", aiffPath, "-c:a", "libmp3lame", "-q:a", "2", mp3Path])
    const bytes = await fs.readFile(mp3Path)
    return { bytes, format: "mp3" }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
