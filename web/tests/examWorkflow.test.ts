import assert from "node:assert/strict"
import test from "node:test"
import { buildExamIntro, insertAfterSegment } from "../src/lib/examWorkflow"
import type { Segment, TtsSegment } from "../src/types"

test("exam title creates the requested introduction without repeated English/listening suffixes", () => {
  const name = "瑞安市新纪元实验学校 2025学年第一学期七年级 期中考试"
  assert.equal(buildExamIntro(name), `这里是${name}英语听力测试。`)
  assert.equal(buildExamIntro(`${name}英语`), `这里是${name}英语听力测试。`)
  assert.equal(buildExamIntro(`这里是${name}英语听力测试。`), `这里是${name}英语听力测试。`)
  assert.equal(buildExamIntro("  "), "")
})

function speech(uid: string, groupId = "group"): TtsSegment {
  return { uid, type: "tts", text: uid, voiceId: "Cherry", stylePresetId: "", stylePrompt: "", groupId, audioId: `${uid}-audio`, status: "done" }
}
const pause: Segment = { uid: "pause", type: "silence", durationMs: 3000 }

test("insertion uses exact selected position, separates generation groups and invalidates grouped recordings", () => {
  const input = [speech("first"), speech("second"), speech("other", "other")]
  const result = insertAfterSegment(input, "first", pause)
  assert.deepEqual(result.map(item => item.uid), ["first", "pause", "second", "other"])
  assert.equal((result[0] as TtsSegment).audioId, undefined)
  assert.notEqual((result[2] as TtsSegment).groupId, (result[0] as TtsSegment).groupId)
  assert.equal((result[3] as TtsSegment).audioId, "other-audio")
  assert.equal(input[0].audioId, "first-audio")
})

test("adding after an introduction preserves its recording and precedes the existing pause", () => {
  const input: Segment[] = [speech("intro"), { uid: "gap", type: "silence", durationMs: 1200, groupId: "group" }]
  const result = insertAfterSegment(input, "intro", pause)
  assert.deepEqual(result.map(item => item.uid), ["intro", "pause", "gap"])
  assert.equal((result[0] as TtsSegment).audioId, "intro-audio")
  assert.deepEqual(insertAfterSegment(input, null, pause).map(item => item.uid), ["intro", "gap", "pause"])
})
