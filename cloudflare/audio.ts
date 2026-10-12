// R2 serves persisted audio directly, including browser seeking and HEAD requests.
export const AUDIO_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export function audioLifetime(uploaded: Date) {
  return { createdAt: uploaded.toISOString(), expiresAt: new Date(uploaded.getTime() + AUDIO_RETENTION_MS).toISOString() }
}

export async function readAudio(request: Request, bucket: R2Bucket, key: string, extension?: string): Promise<Response> {
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } })
  const object = await bucket.head(key)
  if (!object) return new Response(null, { status: 404 })
  const lifetime = audioLifetime(object.uploaded)
  const remaining = Date.parse(lifetime.expiresAt) - Date.now()
  if (remaining <= 0) return new Response(null, { status: 410, headers: { "Cache-Control": "no-store", "X-Audio-Expires-At": lifetime.expiresAt } })
  const type = object.httpMetadata?.contentType || "audio/mpeg"
  if (extension && (extension === "wav") !== (type === "audio/wav")) return new Response(null, { status: 404 })
  const headers = new Headers({ "Content-Type": type, ETag: object.httpEtag, "Accept-Ranges": "bytes", "Cache-Control": `private, max-age=${Math.max(0, Math.min(3600, Math.floor(remaining / 1000)))}`, "X-Audio-Created-At": lifetime.createdAt, "X-Audio-Expires-At": lifetime.expiresAt })
  if (request.headers.get("If-None-Match") === object.httpEtag) return new Response(null, { status: 304, headers })
  let offset = 0, length = object.size, status = 200
  const range = request.headers.get("Range")
  const ifRange = request.headers.get("If-Range")
  if (range && (!ifRange || ifRange === object.httpEtag)) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (match && (match[1] || match[2])) {
      offset = match[1] ? Number(match[1]) : Math.max(0, object.size - Number(match[2]))
      const end = match[1] && match[2] ? Math.min(Number(match[2]), object.size - 1) : object.size - 1
      length = end - offset + 1
    } else length = 0
    if (offset >= object.size || length <= 0 || !Number.isSafeInteger(offset) || !Number.isSafeInteger(length)) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${object.size}` } })
    status = 206
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`)
  }
  headers.set("Content-Length", String(length))
  if (request.method === "HEAD") return new Response(null, { status, headers })
  const body = await bucket.get(key, status === 206 ? { range: { offset, length } } : undefined)
  if (!body) return new Response(null, { status: 404 })
  return new Response(body.body, { status, headers })
}
