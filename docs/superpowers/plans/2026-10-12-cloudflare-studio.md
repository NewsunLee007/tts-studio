# Cloudflare 与听力工作台改造

目标：保留 https://tts.newsunenglish.com/，完善国内语音服务接入，将制作流程改成文稿、配音、下载三步。

## 实现顺序

- [x] 更新国内模型目录：Qwen-Audio 3.x、Qwen3、MiniMax 2.8、豆包 2.0、硅基流动 CosyVoice2。记录官方文档、价格入口和核对日期，区分试用额度、付费 API 与免费浏览器试听。
- [x] 修正模型与音色兼容、请求协议、超时和错误提示；连接测试必须实际生成短音频，不能把本地目录刷新算作测试成功。
- [x] 重做首页：左侧工作区导航、分步骤主区、明确的语音服务卡片、首次使用指引、可折叠高级选项、移动端适配。保留原文、片段编辑、重复音频复用和已有浏览器数据。
- [x] Cloudflare Worker 托管静态资源与 R2 音频，Containers 运行 Express 与 FFmpeg。密钥使用 Worker secrets 注入容器，镜像不得包含密钥。用户已确认 Workers Paid，413 个音频已复制并校验，原域名的 Worker 路由和代理 DNS 已设置。
- [x] 原 DNS 缓存窗口结束，413 个音频再次校验后从 Neon 删除；独立查询为 0 个对象、0 字节。临时部署、环境变量与绕过令牌已移除，Vercel 旧项目已暂停。
- [x] 根据实际页面反馈精简文案、重做设置分类与配音控件、缩短导出流程；取消常驻播放器，保留配音页全篇试听。
- [x] 通过 23 项测试、lint、生产构建、Worker 类型检查、浏览器桌面及手机检查；临时地址与原域名 HTTPS 验证健康检查、合成音频往返、MP3/WAV 拼接与 Range。106 MB 长 WAV 分块上传实测通过。没有用户 TTS 密钥，实际付费 TTS 留待网页短句测试。

## 发布条件

Cloudflare Containers 需 Workers Paid 与相应账号权限。未获费用授权或账号权限不足时，完成本地实现与验证，不把只代理 Vercel 的入口称为完成迁移。不能保证 Cloudflare 国际网络在中国大陆的速度，需实际测量。

## 参考

- https://developers.cloudflare.com/containers/guides/deploy/
- https://developers.cloudflare.com/containers/platform/pricing/
- https://help.aliyun.com/zh/model-studio/tts-model
- https://help.aliyun.com/zh/model-studio/qwen-audio-tts-http-api
- https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http?lang=zh
- https://platform.minimax.cn/docs/api-reference/speech-t2a-http
- https://docs.siliconflow.cn/docs/api/audio-speech-post
- https://elevenlabs.io/docs/eleven-creative/products/studio
