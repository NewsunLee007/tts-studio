import type { ProviderId } from "../presets.js"
import type { TtsCredentials } from "./types.js"

const credentialEnvNames: Partial<Record<ProviderId, Record<string, string>>> = {
  dashscope: { apiKey: "DASHSCOPE_API_KEY", workspaceId: "DASHSCOPE_WORKSPACE_ID" },
  siliconflow: { apiKey: "SILICONFLOW_API_KEY" },
  doubao: { apiKey: "DOUBAO_API_KEY" },
  minimax: { apiKey: "MINIMAX_API_KEY" },
  google: { apiKey: "GOOGLE_TTS_API_KEY", proxyUrl: "GOOGLE_TTS_PROXY_URL" },
  google_gemini: { apiKey: "GEMINI_API_KEY", proxyUrl: "GOOGLE_TTS_PROXY_URL" },
  volcengine: {
    appId: "VOLCENGINE_APP_ID",
    accessToken: "VOLCENGINE_ACCESS_TOKEN",
    cluster: "VOLCENGINE_CLUSTER"
  },
  xfyun: {
    appId: "XFYUN_APP_ID",
    apiKey: "XFYUN_API_KEY",
    apiSecret: "XFYUN_API_SECRET"
  },
  tencent: {
    secretId: "TENCENT_SECRET_ID",
    secretKey: "TENCENT_SECRET_KEY",
    appId: "TENCENT_APP_ID",
    region: "TENCENT_REGION"
  },
  openai: { apiKey: "OPENAI_API_KEY" }
}

export function resolveProviderCredentials(
  provider: ProviderId,
  incoming: TtsCredentials = {},
  env: NodeJS.ProcessEnv = process.env
): TtsCredentials {
  const resolved: TtsCredentials = {}
  for (const [key, envName] of Object.entries(credentialEnvNames[provider] || {})) {
    const value = env[envName]?.trim()
    if (value) resolved[key] = value
  }
  for (const [key, value] of Object.entries(incoming)) {
    if (value?.trim()) resolved[key] = value.trim()
  }
  return resolved
}

export function hasServerCredentials(
  provider: ProviderId,
  requiredKeys: string[],
  env: NodeJS.ProcessEnv = process.env
) {
  const resolved = resolveProviderCredentials(provider, {}, env)
  return requiredKeys.every((key) => Boolean(resolved[key]))
}
