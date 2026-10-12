export type SmartScriptAnalysis = {
  normalizedText: string
  documentType: "exam" | "podcast" | "news" | "general"
  summary: string
  model: string
}

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

type SmartScriptPayload = {
  documentType?: unknown
  normalizedText?: unknown
  summary?: unknown
}

const DEFAULT_MODEL = "deepseek-flash"
const retiredModels = new Set(["deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro"])

export function resolveDeepSeekModel(value = DEFAULT_MODEL) {
  const model = value.trim()
  if (!/^deepseek-[a-zA-Z0-9.-]{1,80}$/.test(model)) throw new Error("请选择有效的 DeepSeek 模型")
  return retiredModels.has(model) ? DEFAULT_MODEL : model
}

export async function listDeepSeekModels() {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error("DeepSeek 尚未由管理员配置")
  const response = await fetch("https://api.deepseek.com/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15000)
  })
  if (!response.ok) throw new Error(`获取 DeepSeek 模型失败（${response.status}）`)
  const json = await response.json() as { data?: Array<{ id: string; name?: string; input_modalities?: string[] }> }
  const models = (json.data || []).filter(item => /^deepseek-[a-zA-Z0-9.-]{1,80}$/.test(item.id) && !retiredModels.has(item.id) && (!item.input_modalities || item.input_modalities.includes("text")))
    .map(item => ({ id: item.id, label: item.id === DEFAULT_MODEL ? "DeepSeek V4.1 Flash（推荐）" : item.name || item.id }))
  if (!models.some(item => item.id === DEFAULT_MODEL)) models.unshift({ id: DEFAULT_MODEL, label: "DeepSeek V4.1 Flash（推荐）" })
  return models
}

function compactForComparison(value: string) {
  return value
    .replace(/^(?:M|W|A|B|N|NARRATOR|MAN|WOMAN|MALE|FEMALE|HOST|GUEST|男|女|旁白|主持人|嘉宾)\s*[:：]\s*/gim, "")
    .replace(/(?:-{3,}|={3,}|#{3,})/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase()
}

function characterOverlap(source: string, candidate: string) {
  const sourceCounts = new Map<string, number>()
  for (const char of source) sourceCounts.set(char, (sourceCounts.get(char) || 0) + 1)
  let overlap = 0
  for (const char of candidate) {
    const remaining = sourceCounts.get(char) || 0
    if (remaining > 0) {
      overlap += 1
      sourceCounts.set(char, remaining - 1)
    }
  }
  return overlap
}

export function verifySmartNormalization(source: string, normalizedText: string) {
  const sourceComparable = compactForComparison(source)
  const normalizedComparable = compactForComparison(normalizedText)
  if (!sourceComparable || !normalizedComparable) return false
  const coverage = characterOverlap(sourceComparable, normalizedComparable) / sourceComparable.length
  const lengthRatio = normalizedComparable.length / sourceComparable.length
  return coverage >= 0.9 && lengthRatio >= 0.82 && lengthRatio <= 1.18
}

export function smartScriptAssistStatus(env: NodeJS.ProcessEnv = process.env) {
  return {
    available: Boolean(env.DEEPSEEK_API_KEY),
    model: resolveDeepSeekModel(env.DEEPSEEK_MODEL || DEFAULT_MODEL),
    label: "DeepSeek V4.1 智能识别"
  }
}

function parseJsonContent(content: string) {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")
  return JSON.parse(trimmed) as SmartScriptPayload
}

function documentType(value: unknown): SmartScriptAnalysis["documentType"] {
  if (value === "exam" || value === "podcast" || value === "news" || value === "general") return value
  return "general"
}

export async function normalizeScriptWithDeepSeek(source: string, selectedModel?: string): Promise<SmartScriptAnalysis> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error("DeepSeek 智能拆分尚未由管理员配置")

  const model = resolveDeepSeekModel(selectedModel || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL)
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You normalize scripts for text-to-speech segmentation.",
            "Return one JSON object with exactly these fields:",
            '{"documentType":"exam|podcast|news|general","normalizedText":"string","summary":"short Chinese sentence"}',
            "Preserve every spoken source word and punctuation exactly. Never translate, correct grammar, summarize, add, or delete spoken content.",
            "You may only normalize speaker prefixes and insert a line containing --- between logical blocks.",
            "For explicit male/female turns, use M: and W:. For narration or an unknown speaker, use NARRATOR:.",
            "For listening exams, retain Chinese instructions, question numbers, repeat-count wording, timing wording, and the original dialogue order.",
            "For podcasts and news, keep complete paragraphs together. Do not split one sentence at every punctuation mark.",
            "Exclude nothing merely because it looks like a heading; the deterministic parser will decide what is spoken.",
            "The word json must appear in this instruction so JSON output mode remains active."
          ].join("\n")
        },
        {
          role: "user",
          content: source
        }
      ]
    })
  })

  const responseText = await response.text()
  const json = (() => {
    try {
      return JSON.parse(responseText) as DeepSeekResponse
    } catch {
      return null
    }
  })()
  if (!response.ok) {
    throw new Error(json?.error?.message || responseText || `DeepSeek 请求失败（${response.status}）`)
  }

  const content = json?.choices?.[0]?.message?.content
  if (!content) throw new Error("DeepSeek 未返回拆分结果")
  const payload = parseJsonContent(content)
  const normalizedText = typeof payload.normalizedText === "string" ? payload.normalizedText.trim() : ""
  if (!verifySmartNormalization(source, normalizedText)) {
    throw new Error("智能拆分未通过原文完整性检查")
  }

  return {
    normalizedText,
    documentType: documentType(payload.documentType),
    summary: typeof payload.summary === "string" ? payload.summary.trim().slice(0, 120) : "已识别文稿结构",
    model
  }
}
