import assert from "node:assert/strict"
import test from "node:test"

import { listDeepSeekModels, normalizeScriptWithDeepSeek, resolveDeepSeekModel, smartScriptAssistStatus, verifySmartNormalization } from "./smartScriptAnalyzer.js"

test("DeepSeek defaults to V4.1 and migrates retired model aliases", () => {
  assert.equal(smartScriptAssistStatus({ DEEPSEEK_API_KEY: "test" }).model, "deepseek-flash")
  assert.equal(resolveDeepSeekModel("deepseek-v4-flash"), "deepseek-flash")
  assert.equal(resolveDeepSeekModel("deepseek-v4-pro"), "deepseek-flash")
  assert.throws(() => resolveDeepSeekModel("other-provider"), /有效/)
})

test("selected DeepSeek model is sent to recognition and returned in metadata", async t => {
  const previous = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = "test"
  t.after(() => { if (previous === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previous })
  let sentModel = ""
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    sentModel = JSON.parse(String(init?.body)).model
    return Response.json({ choices: [{ message: { content: JSON.stringify({ normalizedText: "Good morning.", documentType: "general" }) } }] })
  })
  const result = await normalizeScriptWithDeepSeek("Good morning.", "deepseek-future")
  assert.equal(sentModel, "deepseek-future")
  assert.equal(result.model, sentModel)
})

test("official catalog retains new text models and removes retired aliases", async t => {
  const previous = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = "test"
  t.after(() => { if (previous === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previous })
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: [
    { id: "deepseek-flash", name: "DeepSeek V4.1 Flash" },
    { id: "deepseek-v4-pro" },
    { id: "deepseek-future", name: "Future", input_modalities: ["text"] },
    { id: "deepseek-image", input_modalities: ["image"] }
  ] }))
  assert.deepEqual((await listDeepSeekModels()).map(item => item.id), ["deepseek-flash", "deepseek-future"])
})

test("accepts speaker normalization and inserted boundaries without changing spoken text", () => {
  const source = "Host: Welcome to our show.\nGuest: Thank you.\n下一节：请听新闻。"
  const normalized = "NARRATOR: Welcome to our show.\nNARRATOR: Thank you.\n---\n下一节：请听新闻。"
  assert.equal(verifySmartNormalization(source, normalized), true)
})

test("rejects a smart split that drops a material part of the source", () => {
  const source = "M: Good morning. How are you today?\nW: I am fine. Thank you very much."
  const normalized = "M: Good morning."
  assert.equal(verifySmartNormalization(source, normalized), false)
})
