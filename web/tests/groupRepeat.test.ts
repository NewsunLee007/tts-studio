import assert from "node:assert/strict"
import { test } from "node:test"
import { configureGroupRepeat, groupRepeatMode, repeatGroupLeader } from "../src/lib/groupRepeat.ts"
import type { Segment, TtsSegment } from "../src/types"

function fixture(): Segment[] {
  const speech = (uid: string, role: TtsSegment["role"]): TtsSegment => ({ uid, type: "tts", groupId: "q1", role, text: uid, voiceId: role === "female" ? "old-female" : "old-male", status: "done", audioId: uid, audioUrl: `/audio/${uid}`, stylePresetId: "neutral", stylePrompt: "" })
  return [speech("title", "question"), speech("a", "male"), { uid: "pause", type: "silence", groupId: "q1", durationMs: 800 }, speech("b", "female"), { uid: "answer", type: "silence", groupId: "q1", durationMs: 5000 }]
}
let next = 0
const uid = () => `repeat-${next++}`
const voices = { first: "new-male", second: "new-female" }

test("repeat controls belong to the question start and exclude introductions", () => {
  assert.equal(repeatGroupLeader(fixture(), "q1")?.uid, "title")
  assert.equal(repeatGroupLeader(fixture(), "exam-intro"), undefined)
})

test("Chinese instructions are read once even when mixed into a repeated English question", () => {
  const input = fixture()
  const instruction: TtsSegment = { ...(input[1] as TtsSegment), uid: "instruction", role: "narrator", text: "听下面一段对话，回答第一题。" }
  input.splice(1, 0, instruction)
  const result = configureGroupRepeat(input, "q1", "male-female", voices, uid)
  assert.equal(result.filter(item => item.type === "tts" && /听下面/.test(item.text)).length, 1)
  assert.equal((result.find(item => item.uid === "instruction") as TtsSegment).audioId, instruction.audioId)
  assert.equal(repeatGroupLeader([instruction], "q1"), undefined)
})

test("original repeats reuse speech, retain internal pauses and leave answer time at the end", () => {
  const result = configureGroupRepeat(fixture(), "q1", "original", voices, uid)
  assert.equal(groupRepeatMode(result, "q1"), "original")
  assert.equal(result.filter(item => item.type === "tts" && item.role === "question").length, 1)
  assert.deepEqual(result.filter((item): item is TtsSegment => item.type === "tts" && Boolean(item.repeatOfUid)).map(item => [item.repeatOfUid, item.audioId]), [["a", "a"], ["b", "b"]])
  assert.equal(result.filter(item => item.type === "silence" && item.durationMs === 800).length, 2)
  assert.equal(result.at(-1)?.uid, "answer")
  assert.deepEqual(configureGroupRepeat(result, "q1", "once", voices, uid), fixture())
})

test("different voices invalidate only changed speech and never reuse the first recording", () => {
  const result = configureGroupRepeat(fixture(), "q1", "male-female", voices, uid)
  const speech = result.filter((item): item is TtsSegment => item.type === "tts")
  assert.equal(speech[0].audioId, "title")
  assert.deepEqual(speech.slice(1).map(item => item.voiceId), ["new-male", "new-male", "new-female", "new-female"])
  assert.ok(speech.slice(1).every(item => !item.audioId && !item.repeatOfUid && item.status === "idle"))
  assert.deepEqual(speech.slice(3).map(item => item.repeatSourceUid), ["a", "b"])
  const changed = configureGroupRepeat(result, "q1", "male-female", { ...voices, second: "another-female" }, uid)
  assert.equal(changed.filter(item => item.type === "tts").length, 5)
  assert.equal(changed.filter(item => item.type === "silence").length, 4)
  assert.equal(groupRepeatMode(configureGroupRepeat(changed, "q1", "once", voices, uid), "q1"), "once")
})
