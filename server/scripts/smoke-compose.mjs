import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"

const root = path.join(import.meta.dirname, "..")
const dataDir = path.join(root, "data")
const segmentsDir = path.join(dataDir, "segments")
const exportsDir = path.join(dataDir, "exports")

await fs.mkdir(segmentsDir, { recursive: true })
await fs.mkdir(exportsDir, { recursive: true })

async function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...options })
    let out = ""
    let err = ""
    child.stdout.on("data", (c) => (out += c.toString("utf8")))
    child.stderr.on("data", (c) => (err += c.toString("utf8")))
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) resolve({ out, err })
      else reject(new Error(err || out || `Command failed: ${cmd} ${args.join(" ")}`))
    })
  })
}

const seg1 = path.join(segmentsDir, "seg1.mp3")
const seg2 = path.join(segmentsDir, "seg2.mp3")

await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100:duration=0.4", "-q:a", "2", seg1])
await run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=44100:duration=0.4", "-q:a", "2", seg2])

const port = "8090"
const server = spawn("npx", ["tsx", "src/index.ts"], {
  cwd: root,
  env: { ...process.env, PORT: port },
  stdio: ["ignore", "pipe", "pipe"]
})

let ready = false
server.stdout.on("data", (c) => {
  const t = c.toString("utf8")
  process.stdout.write(t)
  if (t.includes("server listening")) ready = true
})
server.stderr.on("data", (c) => process.stderr.write(c.toString("utf8")))

for (let i = 0; i < 40; i++) {
  if (ready) break
  await new Promise((r) => setTimeout(r, 100))
}

if (!ready) {
  server.kill("SIGTERM")
  throw new Error("Server not ready")
}

const res = await fetch(`http://localhost:${port}/api/compose`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    segments: [
      { type: "tts", id: "seg1" },
      { type: "silence", durationMs: 300 },
      { type: "tts", id: "seg2" }
    ]
  })
})

const json = await res.json().catch(() => ({}))
if (!res.ok) {
  server.kill("SIGTERM")
  throw new Error(JSON.stringify(json))
}

const url = json.url
if (!url || typeof url !== "string") {
  server.kill("SIGTERM")
  throw new Error("Missing url")
}

const rel = url.replace(/^\//, "")
const filePath = path.join(root, "data", rel)
await fs.stat(filePath)

server.kill("SIGTERM")
process.stdout.write(`OK: ${url}\n`)
