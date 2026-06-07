export type ProviderId = "openai" | "dashscope" | "google" | "google_gemini" | "volcengine" | "xfyun" | "tencent" | "baidu" | "huawei"

export type StylePresetId = "news_anchor" | "teacher" | "dialogue" | "slow_clear" | "exam_host" | "question_marker" | "phonics"

export type VoiceGender = "male" | "female" | "neutral"

export type CredentialField = {
  key: string
  label: string
  type: "text" | "password" | "url"
  required: boolean
  placeholder?: string
}

export type TtsModelPreset = {
  id: string
  label: string
  description: string
  supportsInstructions?: boolean
  supportsSsml?: boolean
  supportsEmotion?: boolean
  speedRange?: [number, number]
}

export type VoicePreset = {
  id: string
  label: string
  gender: VoiceGender
  locale?: string
  role?: "narrator" | "dialogue" | "question" | "general"
}

export type ProviderConfig = {
  id: ProviderId
  label: string
  region: "global" | "china"
  status: "ready" | "configured-only"
  description: string
  credentialFields: CredentialField[]
  models: TtsModelPreset[]
  voices: VoicePreset[]
  capabilities: string[]
  defaultModelId: string
  defaultVoiceId: string
  defaultBaseUrl?: string
}

export type PacePresetId = "exam_slow" | "exam_standard" | "dialogue_natural" | "quick_preview"

export const pacePresets: Array<{ id: PacePresetId; label: string; speed: number; description: string }> = [
  { id: "exam_slow", label: "中考慢速", speed: 0.76, description: "更慢、更清楚，适合初中听力" },
  { id: "exam_standard", label: "高考标准", speed: 0.86, description: "正式高考听力的稳健语速" },
  { id: "dialogue_natural", label: "自然对话", speed: 0.96, description: "接近日常交流但不过快" },
  { id: "quick_preview", label: "快速预览", speed: 1.08, description: "用于草稿试听" }
]

export const stylePresets: Array<{ id: StylePresetId; label: string; prompt: string }> = [
  {
    id: "news_anchor",
    label: "播音员",
    prompt: "Read in a confident, crisp announcer style with neutral emotion and steady pace."
  },
  {
    id: "teacher",
    label: "讲解",
    prompt: "Read like an English teacher for listening practice: clear, friendly, slightly slower, with helpful pauses."
  },
  {
    id: "dialogue",
    label: "对话",
    prompt: "Read as natural conversational English: warm, expressive but not exaggerated, medium pace."
  },
  {
    id: "slow_clear",
    label: "慢速清晰",
    prompt: "Read very clearly and slowly for language learners, with distinct word boundaries."
  },
  {
    id: "exam_host",
    label: "考试介绍",
    prompt: "Read as a formal English listening exam host: calm, clear, authoritative, with measured pauses."
  },
  {
    id: "question_marker",
    label: "题号提示",
    prompt: "Read only the question number marker clearly, for example Number 1, with short and neutral delivery."
  },
  {
    id: "phonics",
    label: "音标/自然拼读",
    prompt:
      "Read as an English phonics teacher. Treat slash-delimited items such as /sp/, /speɪ/, /speɪs/, /spei/, /speis/ as pronunciation tokens, not normal words. Say each token slowly and clearly, preserving the target sound, with a short pause between tokens. Read /ei/ as the long A sound /eɪ/."
  }
]

export const providerConfigs: ProviderConfig[] = [
  {
    id: "dashscope",
    label: "阿里云 DashScope",
    region: "china",
    status: "ready",
    description: "Qwen-TTS / CosyVoice，适合中文考试旁白和英文听力材料。",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/api/v1",
    credentialFields: [{ key: "apiKey", label: "API Key", type: "password", required: true, placeholder: "sk-..." }],
    models: [
      { id: "qwen3-tts-flash", label: "Qwen3-TTS Flash（快速草稿）", description: "低延迟、多语言，适合批量预览；不发送导演指令，主要靠音色和语速控制", supportsInstructions: false, supportsEmotion: true, speedRange: [0.5, 2] },
      { id: "qwen3-tts-instruct-flash", label: "Qwen3-TTS Instruct Flash（指令控制）", description: "支持自然语言风格指令，适合正式考试口吻、角色约束和一致性控制", supportsInstructions: true, supportsEmotion: true, speedRange: [0.5, 2] },
      { id: "cosyvoice-v3-flash", label: "CosyVoice v3 Flash（高质量）", description: "CosyVoice 系统音色路线，适合正式导出；使用音色、语速、音高、音量控制", supportsInstructions: false, supportsEmotion: true, speedRange: [0.5, 2] },
      { id: "cosyvoice-v3-plus", label: "CosyVoice v3 Plus（高质量）", description: "更偏正式质量路线，需账号和音色权限支持；使用 v3-plus 支持的系统音色", supportsInstructions: false, supportsEmotion: true, speedRange: [0.5, 2] },
      { id: "qwen-tts", label: "qwen-tts（旧版兼容）", description: "旧版兼容入口；建议只在账号暂未开通 Qwen3/CosyVoice 时使用", supportsInstructions: false, supportsEmotion: true, speedRange: [0.5, 2] },
      { id: "qwen-tts-latest", label: "qwen-tts-latest（旧版最新）", description: "旧版 latest 入口；能力随服务端变化，正式批量前建议先生成样例", supportsInstructions: false, supportsEmotion: true, speedRange: [0.5, 2] }
    ],
    voices: [
      { id: "Cherry", label: "Cherry 清晰女声", gender: "female", locale: "en-US", role: "narrator" },
      { id: "Serena", label: "Serena 自然女声", gender: "female", locale: "en-US", role: "dialogue" },
      { id: "Chelsie", label: "Chelsie 活泼女声", gender: "female", locale: "en-US", role: "dialogue" },
      { id: "Ethan", label: "Ethan 清晰男声", gender: "male", locale: "en-US", role: "dialogue" },
      { id: "longanyang", label: "CosyVoice 龙安洋 男声", gender: "male", locale: "zh-CN", role: "dialogue" },
      { id: "longanhuan_v3", label: "CosyVoice 龙安欢 v3 女声", gender: "female", locale: "zh-CN", role: "dialogue" },
      { id: "longanhuan", label: "CosyVoice 龙安欢 女声", gender: "female", locale: "zh-CN", role: "dialogue" },
      { id: "loongbella_v3", label: "CosyVoice Bella v3 女声", gender: "female", locale: "zh-CN", role: "narrator" },
      { id: "longshuo_v3", label: "CosyVoice 龙硕 v3 男声", gender: "male", locale: "zh-CN", role: "narrator" },
      { id: "longshu_v3", label: "CosyVoice 龙书 v3 男声", gender: "male", locale: "zh-CN", role: "dialogue" }
    ],
    capabilities: ["指令控制", "多模型", "中英双语", "适合考试旁白"],
    defaultModelId: "qwen3-tts-flash",
    defaultVoiceId: "Cherry"
  },
  {
    id: "google",
    label: "Google Cloud TTS",
    region: "global",
    status: "ready",
    description: "Google Cloud Text-to-Speech，Neural2/Wavenet 英语音色丰富，适合考试听力与旁白。",
    defaultBaseUrl: "https://texttospeech.googleapis.com/v1/text:synthesize",
    credentialFields: [
      { key: "apiKey", label: "API Key", type: "password", required: true, placeholder: "AIza..." },
      { key: "proxyUrl", label: "Proxy URL（可选）", type: "url", required: false, placeholder: "留空或填写本机代理地址" }
    ],
    models: [{ id: "google-tts", label: "Google TTS", description: "Cloud Text-to-Speech Synthesize，支持 SSML phoneme 音素控制", supportsSsml: true, supportsInstructions: false, speedRange: [0.25, 2] }],
    voices: [
      { id: "en-US-Neural2-F", label: "Neural2-F 英文女声", gender: "female", locale: "en-US", role: "narrator" },
      { id: "en-US-Neural2-D", label: "Neural2-D 英文男声", gender: "male", locale: "en-US", role: "dialogue" },
      { id: "en-GB-Neural2-F", label: "Neural2-F 英音女声", gender: "female", locale: "en-GB", role: "question" },
      { id: "en-GB-Neural2-D", label: "Neural2-D 英音男声", gender: "male", locale: "en-GB", role: "dialogue" }
    ],
    capabilities: ["Neural2", "Wavenet", "英语音色丰富", "语速音高可控"],
    defaultModelId: "google-tts",
    defaultVoiceId: "en-US-Neural2-F"
  },
  {
    id: "google_gemini",
    label: "Google Gemini TTS (AI Studio)",
    region: "global",
    status: "ready",
    description: "Gemini API 语音生成（Preview），支持可控式文本转语音与双人对话。",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    credentialFields: [
      { key: "apiKey", label: "Gemini API Key", type: "password", required: true, placeholder: "AIza..." },
      { key: "proxyUrl", label: "Proxy URL（可选）", type: "url", required: false, placeholder: "留空或填写本机代理地址" }
    ],
    models: [
      { id: "gemini-3.1-flash-tts-preview", label: "Gemini 3.1 Flash TTS Preview", description: "最新 Gemini Flash TTS Preview，适合快速可控语音生成", supportsInstructions: true, speedRange: [0.25, 2] },
      { id: "gemini-2.5-flash-preview-tts", label: "Gemini 2.5 Flash Preview TTS", description: "Gemini 2.5 低延迟 TTS Preview，支持单人和双人语音", supportsInstructions: true, speedRange: [0.25, 2] },
      { id: "gemini-2.5-pro-preview-tts", label: "Gemini 2.5 Pro Preview TTS", description: "Gemini 2.5 高质量 TTS Preview；如遇 Google 内部错误会自动回退到 Flash TTS", supportsInstructions: true, speedRange: [0.25, 2] }
    ],
    voices: [
      { id: "Puck", label: "Puck · Upbeat", gender: "male", locale: "en", role: "dialogue" },
      { id: "Kore", label: "Kore · Firm", gender: "female", locale: "en", role: "dialogue" },
      { id: "Orus", label: "Orus · Firm", gender: "male", locale: "en", role: "dialogue" },
      { id: "Charon", label: "Charon · Informative", gender: "male", locale: "en", role: "dialogue" },
      { id: "Iapetus", label: "Iapetus · Clear", gender: "male", locale: "en", role: "dialogue" },
      { id: "Algenib", label: "Algenib · Gravelly", gender: "male", locale: "en", role: "dialogue" },
      { id: "Rasalgethi", label: "Rasalgethi · Informative", gender: "male", locale: "en", role: "dialogue" },
      { id: "Gacrux", label: "Gacrux · Mature", gender: "female", locale: "en", role: "dialogue" },
      { id: "Sadaltager", label: "Sadaltager · Knowledgeable", gender: "male", locale: "en", role: "dialogue" },
      { id: "Zephyr", label: "Zephyr · Bright", gender: "female", locale: "en", role: "dialogue" },
      { id: "Leda", label: "Leda · Youthful", gender: "female", locale: "en", role: "dialogue" },
      { id: "Aoede", label: "Aoede · Breezy", gender: "female", locale: "en", role: "dialogue" },
      { id: "Callirrhoe", label: "Callirrhoe · Easy-going", gender: "female", locale: "en", role: "dialogue" },
      { id: "Autonoe", label: "Autonoe · Bright", gender: "female", locale: "en", role: "dialogue" },
      { id: "Laomedeia", label: "Laomedeia · Upbeat", gender: "female", locale: "en", role: "dialogue" },
      { id: "Achernar", label: "Achernar · Soft", gender: "female", locale: "en", role: "dialogue" },
      { id: "Pulcherrima", label: "Pulcherrima · Forward", gender: "female", locale: "en", role: "dialogue" },
      { id: "Vindemiatrix", label: "Vindemiatrix · Gentle", gender: "female", locale: "en", role: "dialogue" },
      { id: "Sulafat", label: "Sulafat · Warm", gender: "female", locale: "en", role: "dialogue" },
      { id: "Fenrir", label: "Fenrir · Excitable", gender: "neutral", locale: "en", role: "general" },
      { id: "Enceladus", label: "Enceladus · Breathy", gender: "neutral", locale: "en", role: "general" },
      { id: "Umbriel", label: "Umbriel · Easy-going", gender: "neutral", locale: "en", role: "general" },
      { id: "Algieba", label: "Algieba · Smooth", gender: "male", locale: "en", role: "dialogue" },
      { id: "Despina", label: "Despina · Smooth", gender: "female", locale: "en", role: "dialogue" },
      { id: "Erinome", label: "Erinome · Clear", gender: "female", locale: "en", role: "dialogue" },
      { id: "Alnilam", label: "Alnilam · Firm", gender: "male", locale: "en", role: "dialogue" },
      { id: "Schedar", label: "Schedar · Even", gender: "male", locale: "en", role: "dialogue" },
      { id: "Achird", label: "Achird · Friendly", gender: "male", locale: "en", role: "dialogue" },
      { id: "Zubenelgenubi", label: "Zubenelgenubi · Casual", gender: "male", locale: "en", role: "dialogue" },
      { id: "Sadachbia", label: "Sadachbia · Lively", gender: "male", locale: "en", role: "dialogue" }
    ],
    capabilities: ["Gemini TTS", "可控式 prompt", "双人对话", "AUDIO 输出"],
    defaultModelId: "gemini-3.1-flash-tts-preview",
    defaultVoiceId: "Iapetus"
  },
  {
    id: "volcengine",
    label: "火山引擎 / 豆包语音",
    region: "china",
    status: "ready",
    description: "火山 openspeech TTS，音色丰富，适合高质量中文与双语素材。",
    defaultBaseUrl: "https://openspeech.bytedance.com/api/v1/tts",
    credentialFields: [
      { key: "appId", label: "App ID", type: "text", required: true },
      { key: "accessToken", label: "Access Token", type: "password", required: true },
      { key: "cluster", label: "Cluster", type: "text", required: true, placeholder: "volcano_tts" }
    ],
    models: [
      { id: "volcano_tts", label: "Volcano TTS", description: "通用在线语音合成", supportsEmotion: true, speedRange: [0.5, 2] },
      { id: "volcano_mega", label: "Volcano Mega Voice", description: "高质量音色集群，需账号开通", supportsEmotion: true, speedRange: [0.5, 2] }
    ],
    voices: [
      { id: "BV001_streaming", label: "灿灿女声", gender: "female", locale: "zh-CN", role: "narrator" },
      { id: "BV002_streaming", label: "阳光男声", gender: "male", locale: "zh-CN", role: "dialogue" },
      { id: "BV700_streaming", label: "英文女声", gender: "female", locale: "en-US", role: "question" },
      { id: "BV701_streaming", label: "英文男声", gender: "male", locale: "en-US", role: "dialogue" }
    ],
    capabilities: ["音色丰富", "语速音量音高", "可接入情绪预测", "适合正式导出"],
    defaultModelId: "volcano_tts",
    defaultVoiceId: "BV700_streaming"
  },
  {
    id: "xfyun",
    label: "讯飞开放平台",
    region: "china",
    status: "ready",
    description: "讯飞在线语音合成 WebSocket，中文教育场景成熟。",
    defaultBaseUrl: "wss://tts-api.xfyun.cn/v2/tts",
    credentialFields: [
      { key: "appId", label: "App ID", type: "text", required: true },
      { key: "apiKey", label: "API Key", type: "password", required: true },
      { key: "apiSecret", label: "API Secret", type: "password", required: true }
    ],
    models: [
      { id: "standard", label: "在线语音合成", description: "讯飞 v2 在线合成", speedRange: [0.5, 2] },
      { id: "premium", label: "精品音库", description: "需在讯飞控制台开通精品发音人", speedRange: [0.5, 2] }
    ],
    voices: [
      { id: "xiaoyan", label: "小燕 女声", gender: "female", locale: "zh-CN", role: "narrator" },
      { id: "aisjiuxu", label: "许久 男声", gender: "male", locale: "zh-CN", role: "dialogue" },
      { id: "x4_enus_luna_assist", label: "Luna 英文女声", gender: "female", locale: "en-US", role: "question" },
      { id: "x4_enus_aaron_assist", label: "Aaron 英文男声", gender: "male", locale: "en-US", role: "dialogue" }
    ],
    capabilities: ["WebSocket", "教育场景", "多发音人", "语速音量音高"],
    defaultModelId: "standard",
    defaultVoiceId: "xiaoyan"
  },
  {
    id: "tencent",
    label: "腾讯云 TTS",
    region: "china",
    status: "ready",
    description: "腾讯云 TextToVoice，稳定的云 API，适合批量生成。",
    defaultBaseUrl: "https://tts.tencentcloudapi.com",
    credentialFields: [
      { key: "secretId", label: "SecretId", type: "text", required: true },
      { key: "secretKey", label: "SecretKey", type: "password", required: true },
      { key: "appId", label: "AppID", type: "text", required: false },
      { key: "region", label: "Region", type: "text", required: false, placeholder: "ap-guangzhou" }
    ],
    models: [
      { id: "TextToVoice", label: "TextToVoice", description: "短文本同步合成", speedRange: [0.6, 1.5] },
      { id: "CreateTtsTask", label: "长文本任务", description: "长文本任务入口，后续版本扩展", speedRange: [0.6, 1.5] }
    ],
    voices: [
      { id: "101001", label: "智瑜 女声", gender: "female", locale: "zh-CN", role: "narrator" },
      { id: "101002", label: "智聆 男声", gender: "male", locale: "zh-CN", role: "dialogue" },
      { id: "10510000", label: "英文女声", gender: "female", locale: "en-US", role: "question" },
      { id: "10510001", label: "英文男声", gender: "male", locale: "en-US", role: "dialogue" }
    ],
    capabilities: ["TC3 签名", "短文本", "长文本适配位", "MP3/WAV"],
    defaultModelId: "TextToVoice",
    defaultVoiceId: "10510000"
  },
  {
    id: "openai",
    label: "OpenAI",
    region: "global",
    status: "ready",
    description: "全球模型，适合英文自然对话和指令化风格。",
    defaultBaseUrl: "https://api.openai.com",
    credentialFields: [{ key: "apiKey", label: "API Key", type: "password", required: true, placeholder: "sk-..." }],
    models: [
      { id: "gpt-4o-mini-tts", label: "gpt-4o-mini-tts", description: "低成本指令化 TTS", supportsInstructions: true, speedRange: [0.25, 4] },
      { id: "tts-1", label: "tts-1", description: "传统 TTS 模型", speedRange: [0.25, 4] },
      { id: "tts-1-hd", label: "tts-1-hd", description: "高质量传统 TTS", speedRange: [0.25, 4] }
    ],
    voices: [
      { id: "alloy", label: "Alloy", gender: "neutral", locale: "en-US", role: "question" },
      { id: "ash", label: "Ash", gender: "male", locale: "en-US", role: "dialogue" },
      { id: "ballad", label: "Ballad", gender: "neutral", locale: "en-US", role: "general" },
      { id: "coral", label: "Coral", gender: "female", locale: "en-US", role: "narrator" },
      { id: "echo", label: "Echo", gender: "male", locale: "en-US", role: "dialogue" },
      { id: "fable", label: "Fable", gender: "neutral", locale: "en-US", role: "general" },
      { id: "onyx", label: "Onyx", gender: "male", locale: "en-US", role: "dialogue" },
      { id: "nova", label: "Nova", gender: "female", locale: "en-US", role: "narrator" },
      { id: "sage", label: "Sage", gender: "neutral", locale: "en-US", role: "question" },
      { id: "shimmer", label: "Shimmer", gender: "female", locale: "en-US", role: "general" }
    ],
    capabilities: ["指令控制", "英文自然度", "多音色"],
    defaultModelId: "gpt-4o-mini-tts",
    defaultVoiceId: "coral"
  },
  {
    id: "baidu",
    label: "百度智能云",
    region: "china",
    status: "configured-only",
    description: "保留短文本/长文本合成适配位，本阶段只提供配置入口。",
    credentialFields: [
      { key: "apiKey", label: "API Key", type: "password", required: true },
      { key: "secretKey", label: "Secret Key", type: "password", required: true }
    ],
    models: [{ id: "short_text", label: "短文本在线合成", description: "后续版本打通" }],
    voices: [{ id: "0", label: "百度默认女声", gender: "female", role: "narrator" }],
    capabilities: ["配置入口", "短文本适配位", "长文本适配位"],
    defaultModelId: "short_text",
    defaultVoiceId: "0"
  },
  {
    id: "huawei",
    label: "华为云 SIS",
    region: "china",
    status: "configured-only",
    description: "保留华为云语音合成适配位，本阶段只提供配置入口。",
    credentialFields: [
      { key: "ak", label: "Access Key", type: "text", required: true },
      { key: "sk", label: "Secret Key", type: "password", required: true },
      { key: "region", label: "Region", type: "text", required: true, placeholder: "cn-north-4" }
    ],
    models: [{ id: "sis_tts", label: "SIS TTS", description: "后续版本打通" }],
    voices: [{ id: "xiaoqi", label: "华为默认女声", gender: "female", role: "narrator" }],
    capabilities: ["配置入口", "SIS 适配位"],
    defaultModelId: "sis_tts",
    defaultVoiceId: "xiaoqi"
  }
]
