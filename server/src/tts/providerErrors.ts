export function explainProviderError(message: string) {
  if (/timeout|timed out|aborted|ETIMEDOUT/i.test(message)) return "语音服务响应超时。请先用短文测试；已完成的片段会保留，可稍后重试。"
  if (/401|invalid.*(?:key|token)|unauthorized|authentication/i.test(message)) return "密钥无效或与服务地域不匹配。请从当前服务的官方控制台重新复制 API Key。"
  if (/402|insufficient|balance|quota|余额|额度|1008/i.test(message)) return "服务额度或余额不足。请在官方控制台检查试用额度、余额及计费状态。"
  if (/429|rate.?limit|too many|限流/i.test(message)) return "服务商正在限流。已生成的音频会保留，请稍等片刻后重试失败片段。"
  if (/403|permission|not activated|未开通|无权限/i.test(message)) return "账号尚未开通该模型或音色。请先在官方控制台开通服务，再生成短样例验证。"
  if (/voice.*not.*support|InvalidParameter|voice.*invalid|411|speaker/i.test(message)) return "音色与模型不兼容或未开通。请选择该模型对应的音色，先试听验证。"
  if (/model.*not.*exist|not.?found|404/i.test(message)) return "模型不可用或接口地域错误。请检查模型名称；阿里新版模型需北京工作空间 ID。"
  return "生成失败。请检查密钥、模型和音色，并先测试短样例。"
}

export async function providerFetch(url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, signal: init.signal || AbortSignal.timeout(60000) })
}
