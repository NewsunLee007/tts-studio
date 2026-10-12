import assert from "node:assert/strict"
import test from "node:test"
import { dashscopeTts } from "./dashscope.js"
import { doubaoTts } from "./doubao.js"
import { siliconflowTts } from "./siliconflow.js"
import { explainProviderError } from "../providerErrors.js"

test("SiliconFlow prefixes the model voice and accepts binary audio", async (t) => {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    return new Response(new Uint8Array([73, 68, 51]), { headers: { "Content-Type": "audio/mpeg" } })
  })
  const audio = await siliconflowTts({ credentials: { apiKey: "test" }, text: "Hello", voice: "anna", speed: 1.2 })
  assert.equal(calls[0].url, "https://api.siliconflow.cn/v1/audio/speech")
  assert.equal(calls[0].body.voice, "FunAudioLLM/CosyVoice2-0.5B:anna")
  assert.equal(calls[0].body.speed, 1.2)
  assert.equal(audio.bytes.toString(), "ID3")
})

test("Doubao assembles NDJSON split across arbitrary stream boundaries", async (t) => {
  let headers: Headers | undefined
  const payload = JSON.stringify({ code: 0, data: Buffer.from("first").toString("base64") }) + "\n" + JSON.stringify({ code: 0, data: Buffer.from("second").toString("base64") }) + "\n" + JSON.stringify({ code: 20000000 })
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    headers = new Headers(init?.headers)
    return new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < payload.length; i += 7) controller.enqueue(new TextEncoder().encode(payload.slice(i, i + 7)))
      controller.close()
    } }))
  })
  const audio = await doubaoTts({ credentials: { apiKey: "test" }, text: "Hello" })
  assert.equal(headers?.get("X-Api-Resource-Id"), "seed-tts-2.0")
  assert.equal(headers?.get("X-Api-Key"), "test")
  assert.equal(audio.bytes.toString(), "firstsecond")
})

test("Doubao rejects truncated audio and provider errors", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ code: 0, data: "aGk=" })))
  const request = { credentials: { apiKey: "test" }, text: "Hello" }
  await assert.rejects(doubaoTts(request), /incomplete/)
  fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify({ code: 45000000, message: "permission denied" })))
  await assert.rejects(doubaoTts(request), /permission denied/)
})

test("Qwen-Audio 3.1 requires a workspace and its own voice family", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response())
  await assert.rejects(dashscopeTts({ credentials: { apiKey: "test" }, text: "Hello", model: "qwen-audio-3.1-tts-flash" }), /工作空间/)
  await assert.rejects(dashscopeTts({ credentials: { apiKey: "test", workspaceId: "workspace1" }, text: "Hello", model: "qwen-audio-3.1-tts-flash", voice: "Cherry" }), /v3.1/)
  assert.equal(fetchMock.mock.callCount(), 0)
})

test("Qwen-Audio 3.1 sends the documented workspace URL and singular instruction", async (t) => {
  let request: { url: string; body: Record<string, any> } | undefined
  t.mock.method(globalThis, "fetch", async (url, init) => {
    request = { url: String(url), body: JSON.parse(String(init?.body)) }
    return Response.json({ output: { audio: { data: "aGk=" } } })
  })
  const audio = await dashscopeTts({ credentials: { apiKey: "test", workspaceId: "workspace1" }, text: "Hello", model: "qwen-audio-3.1-tts-flash", voice: "Emily_v3.1", stylePrompt: "Read clearly." })
  assert.match(request!.url, /^https:\/\/workspace1\.cn-beijing\.maas\.aliyuncs\.com\//)
  assert.equal(request!.body.input.instruction, "Read clearly.")
  assert.equal(request!.body.input.instructions, undefined)
  assert.equal(audio.bytes.toString(), "hi")
})

for (const status of [400, 404]) test(`Qwen unsupported model (${status}) moves directly to the next model`, async (t) => {
  const models: string[] = []
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    models.push(body.model)
    return models.length === 1 ? new Response('{"code":"InvalidParameter","message":"Model not exist."}', { status }) : Response.json({ output: { audio: { data: "aGk=" } } })
  })
  const audio = await dashscopeTts({ credentials: { apiKey: "test" }, text: "Hello", model: "qwen3-tts-instruct-flash", voice: "Neil" })
  assert.deepEqual(models, ["qwen3-tts-instruct-flash", "qwen3-tts-flash"])
  assert.equal(audio.meta?.usedModel, "qwen3-tts-flash")
})

test("provider failures include an actionable explanation", () => {
  assert.match(explainProviderError('DashScope TTS error (404): {"code":"InvalidParameter","message":"Model not exist."}'), /模型不可用|地域/)
  assert.doesNotMatch(explainProviderError('InvalidParameter: Model not exist.'), /音色与模型不兼容/)
  assert.match(explainProviderError("HTTP 401 invalid API key"), /密钥|Key/)
  assert.match(explainProviderError("HTTP 429 rate limit"), /频率|稍后|限流/)
  assert.match(explainProviderError("TimeoutError"), /超时/)
})
