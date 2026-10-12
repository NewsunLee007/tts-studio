import { Container, getContainer } from "@cloudflare/containers"
import { readAudio } from "./audio"
import { providerConfigs, stylePresets, pacePresets } from "../server/src/presets"
import { hasServerCredentials } from "../server/src/tts/credentials"
import { smartScriptAssistStatus } from "../server/src/smartScriptAnalyzer"

type Env = {
  TTS_API: DurableObjectNamespace<TtsApi>
  ASSETS: Fetcher
  AUDIO: R2Bucket
  AUDIO_STORAGE_TOKEN?: string
  [key: string]: unknown
}

export class TtsApi extends Container<Env> {
  defaultPort = 8080
  sleepAfter = "5m"
  enableInternet = true
  envVars = {
    ...Object.fromEntries(Object.entries(this.env).filter(([key, value]) =>
      typeof value === "string" && /^(AUDIO_STORAGE_TOKEN$|DEEPSEEK_|DASHSCOPE_|MINIMAX_|SILICONFLOW_|DOUBAO_|GOOGLE_|GEMINI_|VOLCENGINE_|XFYUN_|TENCENT_|OPENAI_)/.test(key)
    )) as Record<string, string>,
    AUDIO_STORAGE_URL: "https://tts-studio.317792050.workers.dev/_storage"
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    // Opening the workspace should not wait for an idle audio container to wake.
    if (path === "/api/providers" && request.method === "GET") {
      const values = Object.fromEntries(Object.entries(env).filter(([, value]) => typeof value === "string")) as Record<string, string>
      return Response.json({
        providers: providerConfigs.map(provider => ({ ...provider, serverConfigured: hasServerCredentials(provider.id, provider.credentialFields.filter(field => field.required).map(field => field.key), values) })),
        styles: stylePresets.map(({ id, label }) => ({ id, label })), paces: pacePresets,
        scriptAssist: smartScriptAssistStatus(values)
      }, { headers: { "Cache-Control": "no-store", "X-TTS-Platform": "cloudflare-workers" } })
    }
    if (path.startsWith("/_storage/")) {
      if (!env.AUDIO_STORAGE_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.AUDIO_STORAGE_TOKEN}`) return new Response(null, { status: 401 })
      const match = /^\/_storage\/(segment|export)\/([0-9a-f-]{36})$/.exec(path)
      if (!match) return new Response(null, { status: 404 })
      const key = `${match[1]}/${match[2]}`
      const uploadId = url.searchParams.get("uploadId")
      if (uploadId) {
        const upload = env.AUDIO.resumeMultipartUpload(key, uploadId)
        if (request.method === "DELETE") { await upload.abort(); return new Response(null, { status: 204 }) }
        if (request.method === "POST") {
          const parts = await request.json() as R2UploadedPart[]
          if (!Array.isArray(parts) || !parts.length || parts.length > 10000) return new Response(null, { status: 400 })
          const object = await upload.complete(parts)
          return Response.json({ size: object.size })
        }
        const partNumber = Number(url.searchParams.get("partNumber"))
        if (request.method !== "PUT" || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) return new Response(null, { status: 400 })
        const bytes = await request.arrayBuffer()
        if (bytes.byteLength > 32 * 1024 * 1024) return new Response(null, { status: 413 })
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("")
        if (digest !== request.headers.get("X-Content-SHA256")) return new Response(null, { status: 400 })
        return Response.json(await upload.uploadPart(partNumber, bytes))
      }
      if (request.method === "POST") {
        const contentType = request.headers.get("Content-Type") || ""
        const checksum = request.headers.get("X-Content-SHA256") || ""
        if (!/^audio\/(mpeg|wav)$/.test(contentType) || !/^[0-9a-f]{64}$/.test(checksum)) return new Response(null, { status: 400 })
        const upload = await env.AUDIO.createMultipartUpload(key, { httpMetadata: { contentType }, customMetadata: { sha256: checksum } })
        return Response.json({ uploadId: upload.uploadId })
      }
      if (request.method === "PUT") {
        const contentType = request.headers.get("Content-Type") || ""
        const checksum = request.headers.get("X-Content-SHA256") || ""
        if (!/^audio\/(mpeg|wav)$/.test(contentType) || !/^[0-9a-f]{64}$/.test(checksum) || !request.body) return new Response(null, { status: 400 })
        await env.AUDIO.put(key, request.body, { sha256: checksum, httpMetadata: { contentType }, customMetadata: { sha256: checksum } })
        return new Response(null, { status: 204 })
      }
      return readAudio(request, env.AUDIO, key)
    }
    const audio = /^\/(?:api\/)?(audio|exports)\/([0-9a-f-]{36})\.(mp3|wav)$/.exec(path)
    if (audio) return readAudio(request, env.AUDIO, `${audio[1] === "audio" ? "segment" : "export"}/${audio[2]}`, audio[3])
    if (/^\/(audio|exports)(\/|$)/.test(path)) return new Response(null, { status: 404 })
    if (/^\/api(\/|$)/.test(path)) {
      if (!env.AUDIO_STORAGE_TOKEN) return Response.json({ error: "音频存储尚未配置，请管理员完成 R2 设置。" }, { status: 503 })
      try {
        const response = await getContainer(env.TTS_API, "studio").fetch(request)
        const headers = new Headers(response.headers)
        headers.set("X-TTS-Platform", "cloudflare-containers")
        return new Response(response.body, { status: response.status, headers })
      } catch {
        return Response.json({ error: "音频服务正在启动或暂时不可用，请稍后重试。" }, { status: 503, headers: { "Retry-After": "10" } })
      }
    }
    return env.ASSETS.fetch(request)
  }
}
