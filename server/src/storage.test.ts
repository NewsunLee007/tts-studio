import test from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readAudio } from "../../cloudflare/audio.js"

test("R2 audio preserves byte ranges, HEAD, cache validation and format", async () => {
  const data = new TextEncoder().encode("0123456789")
  const bucket = {
    head: async () => ({ size: data.length, httpEtag: '"test"', httpMetadata: { contentType: "audio/mpeg" } }),
    get: async (_key: string, options?: { range: { offset: number; length: number } }) => ({ body: options ? data.slice(options.range.offset, options.range.offset + options.range.length) : data })
  } as unknown as Parameters<typeof readAudio>[1]
  const request = (headers = {}, method = "GET") => new Request("https://example.test/audio", { headers, method })
  const partial = await readAudio(request({ Range: "bytes=2-5" }), bucket, "segment/id")
  assert.equal(partial.status, 206)
  assert.equal(partial.headers.get("Content-Range"), "bytes 2-5/10")
  assert.equal(await partial.text(), "2345")
  assert.equal(await (await readAudio(request({ Range: "bytes=-3" }), bucket, "segment/id")).text(), "789")
  assert.equal((await readAudio(request({ Range: "bytes=20-" }), bucket, "segment/id")).status, 416)
  assert.equal((await readAudio(request({ "If-None-Match": '"test"' }), bucket, "segment/id")).status, 304)
  const head = await readAudio(request({}, "HEAD"), bucket, "segment/id")
  assert.equal(head.headers.get("Content-Length"), "10")
  assert.equal(await head.text(), "")
  assert.equal((await readAudio(request(), bucket, "segment/id", "wav")).status, 404)
})

test("R2 persistence authenticates and verifies uploads; missing audio stays missing", async () => {
  process.env.AUDIO_STORAGE_URL = "https://storage.test/_storage"
  process.env.AUDIO_STORAGE_TOKEN = "test-token"
  const originalFetch = globalThis.fetch
  const bytes = Buffer.from("audio bytes")
  let reads = 0
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://storage.test/_storage/segment/test-id")
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token")
    if (init?.method === "PUT") {
      assert.equal(new Headers(init.headers).get("X-Content-SHA256"), createHash("sha256").update(bytes).digest("hex"))
      assert.deepEqual(Buffer.from(init.body as Uint8Array), bytes)
      return new Response(null, { status: 204 })
    }
    return ++reads === 1 ? new Response(bytes, { headers: { "Content-Type": "audio/mpeg" } }) : new Response(null, { status: 404 })
  }
  try {
    const storage = await import("./storage.js")
    assert.equal(storage.storageBackend(), "r2")
    await storage.saveAudioBlob("segment", "test-id", bytes, "audio/mpeg")
    assert.deepEqual((await storage.readAudioBlob("segment", "test-id"))?.bytes, bytes)
    assert.equal(await storage.readAudioBlob("segment", "test-id"), null)
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.AUDIO_STORAGE_URL
    delete process.env.AUDIO_STORAGE_TOKEN
  }
})

test("large WAV uses ordered checksum-verified parts below the request limit", async () => {
  process.env.AUDIO_STORAGE_URL = "https://storage.test/_storage"
  process.env.AUDIO_STORAGE_TOKEN = "test-token"
  const originalFetch = globalThis.fetch
  const bytes = Buffer.alloc(64 * 1024 * 1024 + 1, 65)
  let size = 0, parts = 0
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token")
    if (init?.method === "POST" && !url.search) return Response.json({ uploadId: "upload" })
    assert.equal(url.searchParams.get("uploadId"), "upload")
    if (init?.method === "PUT") {
      const data = Buffer.from(init.body as Uint8Array)
      assert.ok(data.length <= 32 * 1024 * 1024)
      assert.equal(new Headers(init.headers).get("X-Content-SHA256"), createHash("sha256").update(data).digest("hex"))
      size += data.length; parts++
      assert.equal(url.searchParams.get("partNumber"), String(parts))
      return Response.json({ partNumber: parts, etag: `part-${parts}` })
    }
    assert.deepEqual(JSON.parse(String(init?.body)), [1,2,3].map(partNumber => ({ partNumber, etag: `part-${partNumber}` })))
    return Response.json({ size })
  }
  try {
    const storage = await import("./storage.js")
    await storage.saveAudioBlob("export", "test-id", bytes, "audio/wav")
    assert.equal(size, bytes.length)
    assert.equal(parts, 3)
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.AUDIO_STORAGE_URL
    delete process.env.AUDIO_STORAGE_TOKEN
  }
})
