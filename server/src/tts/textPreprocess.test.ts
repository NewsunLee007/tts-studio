import assert from "node:assert/strict"
import test from "node:test"

import { normalizeTextForTts } from "./textPreprocess.js"

test("replaces English and Chinese exclamation marks before TTS", () => {
  assert.equal(
    normalizeTextForTts("Look！The moon is bright! Really!!"),
    "Look.The moon is bright. Really."
  )
})

test("keeps the rest of the script unchanged", () => {
  assert.equal(
    normalizeTextForTts("M: Hello?\nW: Yes, I am."),
    "M: Hello?\nW: Yes, I am."
  )
})
