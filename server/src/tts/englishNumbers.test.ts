import assert from "node:assert/strict"
import test from "node:test"
import { prepareEnglishNumbers } from "./englishNumbers.js"

test("English numbers stay English without altering the editable source", () => {
  const source = "There are 25 students. The ticket costs $12.50. Meet at 8:05 on the 21st."
  const result = prepareEnglishNumbers(source, "Auto")
  assert.equal(result.text, "There are twenty-five students. The ticket costs twelve dollars and fifty cents. Meet at eight oh five on the twenty-first.")
  assert.equal(result.languageType, "English")
  assert.ok(source.includes("25"))
})
test("decimals, percentages, thousands and telephone digits are spoken explicitly", () => {
  assert.equal(prepareEnglishNumbers("It is 3.14, up 20%, with 1,200 people. Call 138-1234-5678.").text, "It is three point one four, up twenty percent, with one thousand two hundred people. Call one three eight one two three four five six seven eight.")
})
test("Chinese instructions and other explicitly selected languages are preserved", () => {
  assert.deepEqual(prepareEnglishNumbers("听第2段对话。", "Chinese"), { text: "听第2段对话。", languageType: "Chinese" })
  assert.deepEqual(prepareEnglishNumbers("Bonjour 25", "French"), { text: "Bonjour 25", languageType: "French" })
  assert.equal(prepareEnglishNumbers("Flight A320 leaves at 10:00.").text, "Flight A320 leaves at ten o'clock.")
})
