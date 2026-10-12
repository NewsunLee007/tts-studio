import assert from "node:assert/strict"
import test from "node:test"

import { dashscopeTts } from "./dashscope.js"

test("sends and optimizes director instructions for Qwen3 Instruct", async () => {
  const originalFetch = globalThis.fetch
  let requestBody: Record<string, any> | null = null
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body || "{}")) as Record<string, any>
    return new Response(JSON.stringify({ output: { audio: { data: Buffer.from("audio").toString("base64") } } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  }

  try {
    const result = await dashscopeTts({
      credentials: { apiKey: "test-key" },
      text: "Good morning.",
      model: "qwen3-tts-instruct-flash",
      voice: "Neil",
      languageType: "English",
      stylePrompt: "Use a natural British English listening-test delivery."
    })

    assert.equal(requestBody?.model, "qwen3-tts-instruct-flash")
    assert.equal(requestBody?.input?.voice, "Neil")
    assert.equal(requestBody?.input?.language_type, "English")
    assert.equal(requestBody?.input?.instructions, "Use a natural British English listening-test delivery.")
    assert.equal(requestBody?.input?.optimize_instructions, true)
    assert.equal(result.meta?.instructionMode, "sent")
    assert.equal(result.meta?.requestSummary?.some((item) => item.value === "已发送并优化"), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})
