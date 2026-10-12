import assert from "node:assert/strict"
import test from "node:test"

import { verifySmartNormalization } from "./smartScriptAnalyzer.js"

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
