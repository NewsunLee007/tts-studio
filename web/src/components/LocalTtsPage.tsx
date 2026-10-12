import { useState } from "react"

type Device = "all" | "mac" | "nvidia"
type LocalModel = {
  name: string; tag: string; description: string; devices: Device[]
  hardware: string; license: string; licenseUrl: string; repo: string; guide: string
  weights: string; notes: string
}

const models: LocalModel[] = [
  {
    name: "Qwen3-TTS", tag: "中英教学首选", devices: ["mac", "nvidia"],
    description: "0.6B / 1.7B，支持中英等 10 种语言、预设音色与声音克隆。",
    hardware: "NVIDIA 使用官方 PyTorch 方案；Apple Silicon 使用 MLX 转换版。先试 0.6B，再按内存升级。",
    license: "Apache-2.0", licenseUrl: "https://github.com/QwenLM/Qwen3-TTS/blob/main/LICENSE",
    repo: "https://github.com/QwenLM/Qwen3-TTS", guide: "https://github.com/QwenLM/Qwen3-TTS#quickstart",
    weights: "https://modelscope.cn/organization/Qwen", notes: "CustomVoice 用预设音色；Base 用参考音频克隆；VoiceDesign 用文字设计声音。云端百炼密钥与本地权重是两套使用方式。"
  },
  {
    name: "Fun-CosyVoice 3.0", tag: "发音可控", devices: ["nvidia"],
    description: "0.5B，支持中英朗读、方言、跨语言克隆与发音修正。",
    hardware: "优先 Linux + NVIDIA CUDA；官方提供 WebUI、FastAPI 与加速部署说明。",
    license: "Apache-2.0", licenseUrl: "https://github.com/QwenAudio/CosyVoice/blob/main/LICENSE",
    repo: "https://github.com/QwenAudio/CosyVoice", guide: "https://github.com/QwenAudio/CosyVoice#install",
    weights: "https://modelscope.cn/models/FunAudioLLM/Fun-CosyVoice3-0.5B-2512", notes: "当前公开权重为 Fun-CosyVoice3-0.5B-2512。下载完整模型和子模块后，使用官方 WebUI 检查样例。"
  },
  {
    name: "VoxCPM2", tag: "2026 新版", devices: ["mac", "nvidia"],
    description: "2B，支持 30 种语言、声音设计与克隆，输出 48 kHz 音频。",
    hardware: "官方列出约 8 GB 显存占用；WebUI 支持 CUDA、CPU、Apple MPS。长文本仍需额外内存余量。",
    license: "Apache-2.0", licenseUrl: "https://github.com/OpenBMB/VoxCPM/blob/main/LICENSE",
    repo: "https://github.com/OpenBMB/VoxCPM", guide: "https://github.com/OpenBMB/VoxCPM#quick-start",
    weights: "https://modelscope.cn/models/OpenBMB/VoxCPM2", notes: "2026 年 4 月发布。可先用官方 WebUI；需要服务接口时，再看 Nano-vLLM / vLLM-Omni 部署。"
  },
  {
    name: "IndexTTS 2.5", tag: "语速与情绪", devices: ["nvidia"],
    description: "2026 年 8 月新版，支持中英等 5 种语言、语速与音素控制。",
    hardware: "官方 uv / PyTorch 方案，CUDA 路径优先；BF16、加速选项按显卡兼容性开启。",
    license: "项目自定义许可", licenseUrl: "https://github.com/index-tts/index-tts/blob/main/LICENSE",
    repo: "https://github.com/index-tts/index-tts", guide: "https://github.com/index-tts/index-tts#getting-started",
    weights: "https://modelscope.cn/models/IndexTeam/IndexTTS-2.5", notes: "适合需要控制英语音素、中文多音字及情绪的配音。使用前查看项目与下载权重的许可条款。"
  },
  {
    name: "MOSS-TTSD v1.0", tag: "多角色长对话", devices: ["nvidia"],
    description: "支持 1—5 个角色、20 种语言，面向长对话与播客。",
    hardware: "官方 PyTorch / SGLang 部署；长对话需要更多 GPU 内存，先用短对话评估。",
    license: "Apache-2.0", licenseUrl: "https://github.com/OpenMOSS/MOSS-TTSD/blob/main/LICENSE",
    repo: "https://github.com/OpenMOSS/MOSS-TTSD", guide: "https://github.com/OpenMOSS/MOSS-TTSD#installation",
    weights: "https://huggingface.co/OpenMOSS-Team/MOSS-TTSD-v1.0", notes: "2026 年 2 月发布 v1.0。按角色准备参考音频及对应文字，再生成对话；比普通单句朗读的部署更复杂。"
  },
  {
    name: "Fish Audio S2 Pro", tag: "自然表达", devices: ["nvidia"],
    description: "4B，多语言、多角色，支持句内情绪与语气标签。",
    hardware: "优先 NVIDIA GPU；官方提供 WebUI、Docker 和 HTTP 服务，硬件占用按运行方式评估。",
    license: "Fish Audio Research License", licenseUrl: "https://github.com/fishaudio/fish-speech/blob/main/LICENSE",
    repo: "https://github.com/fishaudio/fish-speech", guide: "https://speech.fish.audio/install/",
    weights: "https://huggingface.co/fishaudio/s2-pro", notes: "属于公开权重方案，采用研究许可；不要按 Apache / MIT 的商用权限理解，商用须另行核对授权。"
  },
  {
    name: "GPT-SoVITS v2Pro / v4", tag: "可视化训练", devices: ["nvidia"],
    description: "支持中英等语言、少样本克隆与微调，有成熟的 WebUI 工作流。",
    hardware: "Windows 可从官方说明获取整合包；训练优先使用 NVIDIA。按任务选择 v2Pro 或 v4。",
    license: "代码 MIT；权重另核对", licenseUrl: "https://github.com/RVC-Boss/GPT-SoVITS/blob/main/LICENSE",
    repo: "https://github.com/RVC-Boss/GPT-SoVITS", guide: "https://github.com/RVC-Boss/GPT-SoVITS#installation",
    weights: "https://huggingface.co/lj1995/GPT-SoVITS", notes: "适合愿意整理参考音频、制作固定角色声音的人。代码许可不替代所用权重和参考素材的许可。"
  },
  {
    name: "F5-TTS", tag: "克隆与研究", devices: ["mac", "nvidia"],
    description: "支持中英声音克隆，提供 WebUI、命令行和推理接口。",
    hardware: "官方安装覆盖 NVIDIA、AMD、Intel GPU 与 Apple Silicon；各平台速度需实测。",
    license: "代码 MIT；预训练权重 CC-BY-NC", licenseUrl: "https://github.com/SWivid/F5-TTS#license",
    repo: "https://github.com/SWivid/F5-TTS", guide: "https://github.com/SWivid/F5-TTS#installation",
    weights: "https://huggingface.co/SWivid/F5-TTS", notes: "官方预训练权重限定非商业用途；适合研究与个人实验，不能把代码 MIT 等同于权重可免费商用。"
  }
]

const macCommand = `python3 -m venv .venv
source .venv/bin/activate
pip install "mlx-audio[tts]"
mlx_audio.tts.generate --model mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit --text "Welcome to our English listening practice." --voice Ryan --lang_code English --output_path ./audio`
const cudaCommand = `conda create -n qwen-local python=3.12 -y
conda activate qwen-local
pip install -U qwen-tts
qwen-tts-demo Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice --ip 127.0.0.1 --port 8000`

export function LocalTtsPage({ onBack }: { onBack: () => void }) {
  const [device, setDevice] = useState<Device>("all")
  const [setup, setSetup] = useState<"mac" | "nvidia">("mac")
  const [copyStatus, setCopyStatus] = useState("")
  const filtered = models.filter(model => device === "all" || model.devices.includes(device))
  return <main className="localTtsPage">
    <button className="textButton localBack" onClick={onBack}>← 声音服务</button>
    <header className="localHeading"><h1>本地语音模型</h1><p>下载到自己的电脑，按硬件选择。资料核对：2026-10-12。</p></header>
    <div className="localToolbar"><div className="hubFilters" aria-label="部署设备">{(["all", "mac", "nvidia"] as const).map(value => <button key={value} aria-pressed={device === value} className={device === value ? "active" : ""} onClick={() => { setDevice(value); if (value !== "all") setSetup(value); setCopyStatus("") }}>{value === "all" ? "全部" : value === "mac" ? "Apple Silicon Mac" : "NVIDIA 显卡"}</button>)}</div><span>{filtered.length} 个选择</span></div>
    <section className="localQuickStart" aria-label="快速开始">
      <div className="localQuickHead"><div><h2>先跑通一个短句</h2><p>{setup === "mac" ? "Mac 推荐先试 MLX Audio + Qwen3-TTS 0.6B。" : "NVIDIA 电脑推荐先试 Qwen3-TTS 官方 WebUI。"}</p></div><div className="hubFilters"><button aria-pressed={setup === "mac"} className={setup === "mac" ? "active" : ""} onClick={() => { setSetup("mac"); setCopyStatus("") }}>Mac</button><button aria-pressed={setup === "nvidia"} className={setup === "nvidia" ? "active" : ""} onClick={() => { setSetup("nvidia"); setCopyStatus("") }}>NVIDIA</button></div></div>
      <details className="localInstall"><summary>安装与启动</summary><p>{setup === "mac" ? "仅适用于 Apple Silicon，先安装 Python；首次运行会下载模型，内存不足时关闭其他大程序。MLX Audio 是社区推理工具。" : "先安装 Conda、兼容的 NVIDIA 驱动及 PyTorch / CUDA 环境；启动后打开 http://127.0.0.1:8000。"}</p><pre><code>{setup === "mac" ? macCommand : cudaCommand}</code></pre><div className="localCommandActions"><button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(setup === "mac" ? macCommand : cudaCommand); setCopyStatus("已复制") } catch { setCopyStatus("复制失败，请手动选择命令") } }}>复制命令</button><span role="status">{copyStatus}</span><a href={setup === "mac" ? "https://blaizzy.github.io/mlx-audio/getting-started/installation/" : "https://github.com/QwenLM/Qwen3-TTS#quickstart"} target="_blank" rel="noreferrer">完整安装说明 ↗</a></div></details>
    </section>
    <div className="localModelGrid">{filtered.map(model => <article className="localModelCard" key={model.name}><span className="serviceTag">{model.tag}</span><h2>{model.name}</h2><p>{model.description}</p><div className="localModelLinks"><a href={model.guide} target="_blank" rel="noreferrer">部署指南 ↗</a><a href={model.weights} target="_blank" rel="noreferrer">模型下载 ↗</a></div><details><summary>硬件与许可</summary><p>{model.hardware}</p><p>{model.notes}</p><a href={model.licenseUrl} target="_blank" rel="noreferrer">{model.license} ↗</a><a className="localRepo" href={model.repo} target="_blank" rel="noreferrer">源码与更新 ↗</a></details></article>)}</div>
    <details className="localUsage"><summary>下载、离线使用与工作台接入</summary><p>开源模型无需按字符支付 API 费用，电脑、显卡和电费由自己承担。首次下载依赖及权重需要联网，完整下载后才能离线使用；国内优先选择项目提供的 ModelScope 下载入口。</p><p>本页提供本地部署指南，尚未把你的本地服务连接到在线工作台。先在模型自带 WebUI 生成短句；在线工作台仍使用“声音服务”里连接的账号，不能把云端 API 密钥直接当作本地模型配置。</p><p>硬件支持依据项目文档整理，未在你的设备上逐一安装实测。显存、统一内存和速度随模型精度、文本长度与推理工具变化。</p></details>
  </main>
}
