export type PreviewClip =
  | { kind: "audio"; url: string }
  | { kind: "silence"; durationMs: number }
  | { kind: "music"; presetId: string; durationMs: number }

type Callbacks = {
  progress: (index: number, fraction: number) => void
  buffering: (value: boolean) => void
  duration: (index: number, seconds: number) => void
  ended: () => void
  error: (message: string) => void
}
type BufferEntry = { buffer?: AudioBuffer; error?: Error; promise: Promise<void> }
type ScheduledClip = { index: number; start: number; duration: number }

class AudioLoadError extends Error {
  readonly retryable: boolean
  constructor(message: string, retryable: boolean) { super(message); this.retryable = retryable }
}

function retryDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve() }, ms)
    if (signal.aborted) abort()
    else signal.addEventListener("abort", abort, { once: true })
  })
}

function audioUrl(clip: PreviewClip) {
  if (clip.kind === "audio") return clip.url
  if (clip.kind !== "music") return ""
  return clip.presetId === "ding" ? "/media/ding.mp3" : clip.presetId === "piano" ? "/media/piano-intro.mp3" : ""
}

// Fetch/decode ahead, then schedule boundaries on the audio clock. UI timers never
// decide when one clip ends and the next starts.
export class PreviewPlayer {
  private context: AudioContext
  private callbacks: Callbacks
  private fetchAudio: typeof fetch
  private buffers = new Map<string, BufferEntry>()
  private sources = new Set<AudioScheduledSourceNode>()
  private controller = new AbortController()
  private timer?: ReturnType<typeof setInterval>
  private run = 0
  private clips: PreviewClip[] = []
  private queue: ScheduledClip[] = []
  private nextIndex = 0
  private nextTime = 0

  constructor(context: AudioContext, callbacks: Callbacks, fetchAudio = fetch) {
    this.context = context
    this.callbacks = callbacks
    this.fetchAudio = fetchAudio
  }

  private async fetchBuffer(url: string, signal: AbortSignal) {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted()
      try {
        const response = await this.fetchAudio(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]), cache: attempt ? "reload" : "default" })
        if (!response.ok) throw new AudioLoadError(response.status === 410 ? "音频已过期，请重新生成；云端录音保留 7 天" : response.status === 404
          ? "音频文件不存在，请回到录音生成重新生成这一段"
          : `音频加载失败（HTTP ${response.status}）`, response.status === 408 || response.status === 429 || response.status >= 500)
        const bytes = await response.arrayBuffer()
        signal.throwIfAborted()
        // Decode errors need a fresh download too: interrupted bodies can be incomplete.
        return await this.context.decodeAudioData(bytes)
      } catch (error) {
        if (signal.aborted || attempt >= 2 || error instanceof AudioLoadError && !error.retryable) throw error
        await retryDelay(400 * (attempt + 1), signal)
      }
    }
  }

  private load(url: string) {
    const cached = this.buffers.get(url)
    if (cached) {
      this.buffers.delete(url)
      this.buffers.set(url, cached)
      return cached
    }
    const signal = this.controller.signal
    const entry: BufferEntry = { promise: Promise.resolve() }
    entry.promise = this.fetchBuffer(url, signal)
      .then(buffer => {
        if (!signal.aborted) entry.buffer = buffer
      })
      .catch(error => {
        if (!signal.aborted) entry.error = new Error(error instanceof Error && error.name === "TimeoutError" ? "自动重试后仍加载超时，请点击播放继续" : error instanceof TypeError ? "自动重试后仍无法连接音频，请点击播放继续" : error instanceof Error ? error.message : "音频加载失败，请点击播放重试")
      })
    this.buffers.set(url, entry)
    // Keep a small decoded cache; a long listening script must not retain every clip.
    for (const [key, value] of this.buffers) {
      if (this.buffers.size <= 8) break
      if (value.buffer || value.error) this.buffers.delete(key)
    }
    return entry
  }

  private prefetch() {
    const pending: Promise<void>[] = []
    const urls = new Set<string>()
    for (let index = this.nextIndex; index < this.clips.length && urls.size < 3; index++) {
      const url = audioUrl(this.clips[index])
      if (!url || urls.has(url)) continue
      urls.add(url)
      pending.push(this.load(url).promise)
    }
    return pending
  }

  async start(clips: PreviewClip[], index = 0) {
    this.stop()
    const run = this.run
    this.clips = clips
    this.nextIndex = Math.max(0, Math.min(index, clips.length - 1))
    if (!clips.length) return
    this.callbacks.buffering(true)
    try {
      // Resume synchronously from the user's click, including on mobile Safari.
      const resumed = this.context.resume()
      this.prefetch()
      const firstUrl = audioUrl(clips[this.nextIndex])
      await Promise.all([resumed, ...(firstUrl ? [this.load(firstUrl).promise] : [])])
      if (this.run !== run) return
      this.nextTime = this.context.currentTime + 0.06
      this.tick()
      if (this.run === run) this.timer = setInterval(() => this.tick(), 80)
    } catch (error) {
      if (this.run !== run) return
      this.stop()
      this.callbacks.error(error instanceof Error ? error.message : "无法开始试听")
    }
  }

  private track(source: AudioScheduledSourceNode, cleanup?: () => void) {
    this.sources.add(source)
    source.onended = () => {
      source.disconnect()
      cleanup?.()
      this.sources.delete(source)
    }
  }

  private schedule(clip: PreviewClip, buffer: AudioBuffer | undefined, start: number, duration: number) {
    if (buffer) {
      const source = this.context.createBufferSource()
      source.buffer = buffer
      source.connect(this.context.destination)
      this.track(source)
      source.start(start, 0, duration)
    } else if (clip.kind === "music") {
      const master = this.context.createGain()
      master.gain.setValueAtTime(0.0001, start)
      master.gain.exponentialRampToValueAtTime(0.12, start + 0.06)
      master.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(0.08, duration - 0.18))
      master.connect(this.context.destination)
      const frequencies = clip.presetId === "bell" ? [880, 1320] : clip.presetId === "soft" ? [392, 523] : [523, 659, 784]
      frequencies.forEach((frequency, index) => {
        const oscillator = this.context.createOscillator()
        const gain = this.context.createGain()
        oscillator.type = index === 0 ? "sine" : "triangle"
        oscillator.frequency.setValueAtTime(frequency, start)
        gain.gain.setValueAtTime(index === 0 ? 0.95 : 0.35, start)
        oscillator.connect(gain).connect(master)
        this.track(oscillator, () => { gain.disconnect(); if (index === 0) master.disconnect() })
        oscillator.start(start)
        oscillator.stop(start + duration)
      })
    }
  }

  private tick() {
    const now = this.context.currentTime
    this.queue = this.queue.filter(clip => clip.start + clip.duration > now)
    this.prefetch()
    while (this.nextIndex < this.clips.length && this.nextTime < now + 20) {
      const clip = this.clips[this.nextIndex]
      const url = audioUrl(clip)
      const entry = url ? this.load(url) : undefined
      if (entry?.error) {
        // A future failed prefetch must not cut off the audio already playing.
        if (this.queue.length && this.nextTime > now) break
        const message = `第 ${this.nextIndex + 1} 段：${entry.error.message}`
        this.callbacks.progress(this.nextIndex, 0)
        this.stop()
        this.callbacks.error(message)
        return
      }
      if (entry && !entry.buffer) break
      const duration = clip.kind === "audio" ? entry!.buffer!.duration
        : clip.kind === "silence" ? Math.max(0, clip.durationMs / 1000)
          : Math.min(Math.max(0.25, clip.durationMs / 1000), 30, entry?.buffer?.duration ?? Infinity)
      const start = this.nextTime < now ? now + 0.06 : this.nextTime
      this.schedule(clip, entry?.buffer, start, duration)
      this.queue.push({ index: this.nextIndex, start, duration })
      this.callbacks.duration(this.nextIndex, duration)
      this.nextTime = start + duration
      this.nextIndex++
      this.prefetch()
    }
    const active = this.queue.find(clip => clip.start <= now && clip.start + clip.duration > now)
    this.callbacks.buffering(!active && this.nextTime <= now && this.nextIndex < this.clips.length)
    if (active) this.callbacks.progress(active.index, Math.min(1, (now - active.start) / active.duration))
    if (!this.queue.length && this.nextIndex === this.clips.length) {
      this.callbacks.progress(this.clips.length - 1, 1)
      this.stop()
      this.callbacks.ended()
    }
  }

  stop() {
    this.run++
    clearInterval(this.timer)
    this.timer = undefined
    this.controller.abort()
    this.controller = new AbortController()
    for (const [url, entry] of this.buffers) if (!entry.buffer) this.buffers.delete(url)
    for (const source of this.sources) {
      try { source.stop() } catch { /* Already ended. */ }
      source.onended?.(new Event("ended"))
    }
    this.sources.clear()
    this.queue = []
    this.callbacks.buffering(false)
  }

  dispose() {
    this.stop()
    this.buffers.clear()
    void this.context.close()
  }
}
