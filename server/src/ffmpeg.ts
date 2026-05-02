import { spawn } from "node:child_process"

let ffmpegPathPromise: Promise<string> | undefined

async function getFfmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  ffmpegPathPromise ||= import("@ffmpeg-installer/ffmpeg")
    .then((mod) => (mod.default as { path?: string } | undefined)?.path || (mod as { path?: string }).path || "ffmpeg")
    .catch(() => "ffmpeg")
  return ffmpegPathPromise
}

export function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    void getFfmpegPath().then((ffmpegPath) => {
      const child = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", ...args], {
      stdio: ["ignore", "pipe", "pipe"]
    })

      let stderr = ""
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8")
      })

      child.on("error", reject)
      child.on("close", (code) => {
        if (code === 0) resolve()
        else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`))
      })
    }, reject)
  })
}
