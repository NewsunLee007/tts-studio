import assert from "node:assert/strict"
import test from "node:test"
import { mergeAudioHistory, parseAudioHistory, remainingAudioTime, type AudioHistoryEntry } from "../src/lib/audioHistory"

test("history keeps one entry per recording and only accepts local audio download URLs", () => {
  const entry: AudioHistoryEntry = { url: "/exports/12345678-1234-1234-1234-123456789012.mp3", title: "考试录音", createdAt: new Date().toISOString(), kind: "export" }
  const first = mergeAudioHistory([], entry)
  assert.equal(mergeAudioHistory(first, { ...entry, title: "updated" }).length, 1)
  assert.deepEqual(mergeAudioHistory(first, { ...entry, url: "https://foreign.test/file" }), first)
  assert.deepEqual(parseAudioHistory([...first, { url: "javascript:alert(1)" }]), first)
})
test("expired recordings and unknown old timestamps are never shown with a new seven-day lifetime", () => {
  const now = Date.now()
  assert.equal(remainingAudioTime(new Date(now - 1).toISOString(), now), "已过期")
  assert.equal(remainingAudioTime(undefined, now), "下载时核验有效期")
  assert.equal(remainingAudioTime(new Date(now + 90 * 60000).toISOString(), now), "剩余 1 小时")
})
