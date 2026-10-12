import assert from "node:assert/strict"
import test from "node:test"

import { analyzeExamScript, analyzeGeneralScript, detectScriptDocumentType } from "./scriptAnalyzer.js"

const source = `第一节：听下面一段对话。
M: Good morning.
W: Good morning.`

test("does not add template audio when the teacher did not opt in", () => {
  const segments = analyzeExamScript(source, {})

  assert.equal(segments.some((item) => item.type === "music"), false)
  assert.equal(segments.some((item) => item.type === "tts" && item.groupId === "exam-intro"), false)
  assert.equal(segments.some((item) => item.type === "tts" && item.text.includes("2025 学年")), false)
  assert.equal(segments.find((item) => item.type === "tts")?.role, "narrator")
})

test("labels explicitly enabled template audio", () => {
  const segments = analyzeExamScript(source, {
    includeIntroMusic: true,
    includeExamIntro: true,
    schoolYear: "2026 学年",
    semester: "第一学期",
    examName: "期末考试",
    subject: "英语"
  })

  const music = segments.find((item) => item.type === "music")
  const intro = segments.find((item) => item.type === "tts" && item.groupId === "exam-intro")

  assert.equal(music?.label, "模板添加 · 导入音乐")
  assert.equal(intro?.label, "模板添加 · 考试介绍")
  assert.equal(intro?.type === "tts" ? intro.text : "", "这里是2026 学年第一学期期末考试英语听力测试。")
})

test("keeps exam instructions together and recognizes tilde ranges and fixed reading time", () => {
  const text = `第二节：听长对话，每段对话读两遍。听第一段对话，回答6~7小题。
W: Sam, you're late again.
M: I had an accident on the way.
听下面一段较长对话，回答8至10三个问题。听对话前，你将有15秒钟的时间阅读有关内容。
M: Hey, Amy, are you free?
W: Yes. What can I do for you?`
  const segments = analyzeExamScript(text, { includeQuestionNumbers: true })
  const spoken = segments.filter((item) => item.type === "tts")

  assert.equal(spoken.some((item) => item.role === "narrator" && item.text.includes("回答6~7小题")), true)
  assert.equal(spoken.some((item) => item.role === "female" && item.groupId === "q-6-7"), true)
  assert.equal(spoken.some((item) => item.role === "male" && item.groupId === "q-8-10"), true)
  assert.equal(segments.some((item) => item.type === "silence" && item.groupId === "q-8-10" && item.label === "读题时间" && item.durationMs === 15000), true)
})

test("keeps podcast paragraphs and speaker turns together", () => {
  const text = `Podcast Episode 3

Host: Welcome back to our show.
Guest: Thanks. It is great to be here.
This sentence continues the guest's thought.

Today we are talking about learning English.
One paragraph should remain one narration segment.`
  assert.equal(detectScriptDocumentType(text), "podcast")
  const segments = analyzeGeneralScript(text, "podcast")

  assert.equal(segments.filter((item) => item.type === "tts").length, 4)
  assert.equal(segments.some((item) => item.type === "tts" && item.role === "narrator" && item.text.includes("continues the guest")), true)
  assert.equal(segments.some((item) => item.type === "tts" && item.role === "narrator" && item.text.includes("\nOne paragraph")), true)
})
