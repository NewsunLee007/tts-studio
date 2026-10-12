import assert from "node:assert/strict"
import { test } from "node:test"
import { PreviewPlayer } from "../src/lib/previewPlayer.ts"

function fixture(fetchAudio?: typeof fetch) {
  const starts: Array<{ start: number; duration: number; stopped: boolean }> = []
  const context = {
    currentTime: 10,
    destination: {},
    resume: async () => {},
    close: async () => {},
    decodeAudioData: async (bytes: ArrayBuffer) => ({ duration: new Uint8Array(bytes)[0] / 10 }),
    createBufferSource: () => {
      let entry: typeof starts[number]
      return {
        buffer: null,
        connect() {}, disconnect() {}, onended: null,
        start(start: number, _offset: number, duration: number) { entry = { start, duration, stopped: false }; starts.push(entry) },
        stop() { entry.stopped = true }
      }
    }
  }
  const requests: string[] = []
  const errors: string[] = []
  const progress: Array<[number, number]> = []
  const buffering: boolean[] = []
  let ended = 0
  const player = new PreviewPlayer(context as unknown as AudioContext, {
    progress: (index, fraction) => progress.push([index, fraction]),
    buffering: value => buffering.push(value),
    duration() {}, ended: () => ended++, error: message => errors.push(message)
  }, fetchAudio || (async url => {
    requests.push(String(url))
    return new Response(new Uint8Array([20]))
  }) as typeof fetch)
  return { player, context, starts, requests, errors, progress, buffering, get ended() { return ended } }
}

test("decoded clips share exact boundaries, preserve specified silence, and reuse repeated audio", async () => {
  const f = fixture()
  try {
    await f.player.start([
      { kind: "audio", url: "/one" },
      { kind: "audio", url: "/two" },
      { kind: "silence", durationMs: 750 },
      { kind: "audio", url: "/one" }
    ])
    assert.equal(f.starts.length, 3)
    assert.equal(f.starts[1].start, f.starts[0].start + 2)
    assert.equal(f.starts[2].start, f.starts[1].start + 2 + 0.75)
    assert.deepEqual(f.requests, ["/one", "/two"])
    // Simulate a heavily delayed UI timer. Already scheduled audio stays aligned.
    f.context.currentTime = 15
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(f.progress.at(-1)?.[0], 3)
    assert.equal(f.starts.length, 3)
    f.context.currentTime = 18
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(f.ended, 1)
  } finally { f.player.dispose() }
})

test("stop during buffering prevents late audio and permits immediate seeking/restart", async () => {
  let release!: (response: Response) => void
  let first = true
  const f = fixture((async () => {
    if (first) { first = false; return new Promise<Response>(resolve => { release = resolve }) }
    return new Response(new Uint8Array([10]))
  }) as typeof fetch)
  try {
    const oldRun = f.player.start([{ kind: "audio", url: "/slow" }])
    f.player.stop()
    await f.player.start([{ kind: "audio", url: "/new" }])
    release(new Response(new Uint8Array([20])))
    await oldRun
    assert.equal(f.starts.length, 1)
    assert.equal(f.starts[0].duration, 1)
    f.player.stop()
    assert.equal(f.starts[0].stopped, true)
    assert.deepEqual(f.errors, [])
  } finally { f.player.dispose() }
})

test("a failed clip reports an error instead of silently skipping speech", async () => {
  const f = fixture((async () => new Response("missing", { status: 404 })) as typeof fetch)
  try {
    await f.player.start([{ kind: "audio", url: "/missing" }, { kind: "silence", durationMs: 500 }])
    assert.equal(f.starts.length, 0)
    assert.match(f.errors[0], /404/)
    assert.equal(f.buffering.at(-1), false)
  } finally { f.player.dispose() }
})

test("lookahead schedules later clips before their playback boundary under delayed loading", async () => {
  let release!: (response: Response) => void
  const f = fixture((async url => String(url) === "/four"
    ? new Promise<Response>(resolve => { release = resolve })
    : new Response(new Uint8Array([100]))) as typeof fetch)
  try {
    await f.player.start(["/one", "/two", "/three", "/four"].map(url => ({ kind: "audio" as const, url })))
    assert.equal(f.starts.length, 2)
    f.context.currentTime = 21
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(f.starts.length, 3)
    release(new Response(new Uint8Array([100])))
    f.context.currentTime = 31
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(f.starts.length, 4)
    assert.equal(f.starts[3].start, f.starts[2].start + 10)
    assert.deepEqual(f.errors, [])
  } finally { f.player.dispose() }
})
