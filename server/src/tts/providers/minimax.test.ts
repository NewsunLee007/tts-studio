import assert from "node:assert/strict"
import test from "node:test"

import { minimaxTts } from "./minimax.js"

test("sends the current MiniMax T2A v2 contract and decodes hex audio", async () => {
  const originalFetch = globalThis.fetch
  let requestBody: Record<string, unknown> | undefined
  let authorization = ""
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    authorization = new Headers(init?.headers).get("Authorization") || ""
    return new Response(
      JSON.stringify({
        data: { audio: "494433", status: 2 },
        extra_info: { usage_characters: 12 },
        base_resp: { status_code: 0, status_msg: "success" }
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  }

  try {
    const result = await minimaxTts({
      credentials: { apiKey: "temporary-key" },
      text: "This is a test.",
      model: "speech-2.8-hd",
      voice: "English_Graceful_Lady",
      speed: 0.9
    })

    assert.equal(authorization, "Bearer temporary-key")
    assert.equal(requestBody?.model, "speech-2.8-hd")
    assert.equal(requestBody?.output_format, "hex")
    assert.equal(requestBody?.language_boost, "English")
    assert.equal(result.bytes.toString("hex"), "494433")
    assert.equal(result.format, "mp3")
  } finally {
    globalThis.fetch = originalFetch
  }
})
