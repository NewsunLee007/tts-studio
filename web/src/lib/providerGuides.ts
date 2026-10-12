import type { ProviderId } from "../types"

export type ProviderGuide = {
  badge: string
  cost: string
  bestFor: string
  steps: string[]
  signup: string
  keys: string
  pricing: string
  docs: string
}

export const providerGuides: Partial<Record<ProviderId, ProviderGuide>> = {
  dashscope: {
    badge: "英音听力优先",
    cost: "Qwen3 约 ¥0.8／万字符；北京地域部分模型有 90 天限额试用。Qwen-Audio 3.1 单独计价，以控制台为准。",
    bestFor: "Qwen-Audio 3.1 的英式男女声；Qwen3 的中英教学旁白。",
    steps: ["注册阿里云并开通北京地域百炼，创建 API Key。", "先选 Qwen3 Instruct 测试；使用 Qwen-Audio 3.1 时再填写北京工作空间 ID。", "选择对应模型音色，生成短样例，确认发音与额度后再批量制作。"],
    signup: "https://bailian.console.aliyun.com/",
    keys: "https://help.aliyun.com/zh/model-studio/get-api-key",
    pricing: "https://help.aliyun.com/zh/model-studio/model-pricing",
    docs: "https://help.aliyun.com/zh/model-studio/tts-model"
  },
  minimax: {
    badge: "自然对话",
    cost: "按字符付费；Speech 2.8 Turbo 与 HD 分档计价，试用权益以账号控制台为准。",
    bestFor: "较自然的英文对话；Turbo 先试听，HD 做正式成品。",
    steps: ["注册 MiniMax 开放平台并创建接口密钥。", "确认账户余额和 Speech 服务权限。", "选择英文系统音色，先生成短样例。"],
    signup: "https://platform.minimax.cn/",
    keys: "https://platform.minimax.cn/user-center/basic-information/interface-key",
    pricing: "https://platform.minimax.cn/docs/guides/pricing-paygo",
    docs: "https://platform.minimax.cn/docs/api-reference/speech-t2a-http"
  },
  doubao: {
    badge: "新版单密钥",
    cost: "新用户首次开通有试用礼包；额度用完后按量付费，查看控制台余量。",
    bestFor: "中英混合内容、口语素材；需要豆包语音 2.0 对应音色。",
    steps: ["注册火山引擎并完成实名认证。", "进入新版豆包语音控制台，开通语音合成 2.0。", "在 API Key 管理复制新版密钥；旧版 App ID／Token 请使用旧版火山入口。"],
    signup: "https://console.volcengine.com/speech",
    keys: "https://console.volcengine.com/speech",
    pricing: "https://www.volcengine.com/docs/6561",
    docs: "https://docs.volcengine.com/docs/DoubaoVoice/QuickStartNewConsole?lang=zh"
  },
  siliconflow: {
    badge: "接入简单",
    cost: "CosyVoice2 与 MOSS-TTSD 托管 API 按 UTF-8 字节计费；试用赠金以账号为准，并非永久免费。",
    bestFor: "一个 API Key 开始制作；适合日常中英朗读与教学素材。",
    steps: ["注册硅基流动，进入账户的 API 密钥页面。", "创建 API Key 并检查可用余额／试用赠金。", "选择 CosyVoice2 与内置音色，生成短样例。"],
    signup: "https://cloud.siliconflow.cn/",
    keys: "https://cloud.siliconflow.cn/account/ak",
    pricing: "https://siliconflow.cn/pricing",
    docs: "https://docs.siliconflow.cn/docs/userguide/capabilities/text-to-speech"
  },
  tencent: {
    badge: "传统云服务",
    cost: "按音色档位和字符量付费；免费额度与有效期以账号控制台为准。",
    bestFor: "稳定的中文播报和标准朗读。",
    steps: ["注册腾讯云并开通文本转语音。", "从访问管理创建 SecretId 与 SecretKey。", "确认目标 VoiceType 权限后测试。"],
    signup: "https://console.cloud.tencent.com/tts",
    keys: "https://console.cloud.tencent.com/cam/capi",
    pricing: "https://cloud.tencent.com/document/product/1073/34112",
    docs: "https://cloud.tencent.com/document/product/1073"
  },
  xfyun: {
    badge: "中文教育",
    cost: "限额试用与付费套餐，精品音色可能需要单独开通。",
    bestFor: "中文教育旁白、课堂讲解。",
    steps: ["注册讯飞开放平台并创建在线语音合成应用。", "复制 AppID、APIKey、APISecret。", "确认发音人权限并生成短样例。"],
    signup: "https://console.xfyun.cn/",
    keys: "https://console.xfyun.cn/",
    pricing: "https://www.xfyun.cn/services/online_tts",
    docs: "https://www.xfyun.cn/doc/tts/online_tts/API.html"
  }
}
