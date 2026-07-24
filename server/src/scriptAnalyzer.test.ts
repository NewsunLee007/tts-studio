import assert from "node:assert/strict"
import test from "node:test"

import { analyzeExamScript } from "./scriptAnalyzer.js"

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
