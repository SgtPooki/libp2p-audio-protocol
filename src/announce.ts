// Audio QR: a host plays a link through its speaker, every phone in the room with the listener
// open gets it. Speaker-only on the host, mic-only on the guests, no libp2p node needed.
//
// Frames: unsigned  [0xD1][utf-8 url]                       short: ~30 bytes, 2-5 s on air
//         signed    a libp2p signed envelope (AudioMessage)  ~110 bytes + url; proves which key sent it
// A guest listens on several presets at once, so the host can alternate fast and slow presets
// (fast first for phones, voice as the floor that TVs, PAs and radios pass).

import { peerIdFromPublicKey } from '@libp2p/peer-id'
import { JINGLES, underJingle } from './jingle.ts'
import { modulate, Demodulator, PRESETS, type ModemOptions, type Preset } from './modem.ts'
import { openFrame, sealMessage } from './protocol.ts'
import type { PeerId, PrivateKey } from '@libp2p/interface'

const MAGIC = 0xd1
const enc = new TextEncoder()
const dec = new TextDecoder()

export interface Heard { url: string, from?: PeerId, preset: Preset, at: number }

export const encodeLink = (url: string): Uint8Array => Uint8Array.of(MAGIC, ...enc.encode(url))

/** Parse a frame as a link: unsigned, or a signed message whose text is a URL. */
export async function decodeLink (frame: Uint8Array): Promise<{ url: string, from?: PeerId } | undefined> {
  if (frame[0] === MAGIC && frame.length > 1) return { url: dec.decode(frame.subarray(1)) }
  const f = await openFrame(frame)
  if (f?.type === 'message' && /^[a-z][a-z0-9+.-]*:/i.test(f.text)) return { url: f.text, from: f.from }
  return undefined
}

export interface AnnounceOptions {
  /** Presets to alternate between, fastest first. Default ['fast', 'voice']. */
  presets?: Preset[]
  /** Sign with this key so guests see which PeerId sent the link (~110 bytes more on air). */
  key?: PrivateKey
  /** Seconds of silence between frames. Default 0.5. */
  gap?: number
  /** Loop until `stop()` is called. Default true. `loops` caps the passes (default unlimited). */
  loop?: boolean
  loops?: number
  /** Reuse an AudioContext (must be created in a user gesture). */
  ctx?: AudioContext
  /**
   * Play a public-domain jingle (src/jingle.ts) and hide the data under it, `level` dB below the melody
   * (default -18). Replaces `presets`. `band`: 'ultrasonic' (default; all anyone hears is the tune) or
   * 'hidden' (4-7 kHz, faint but survives TVs and PAs that cut ultrasound; ducked to the music's envelope).
   */
  jingle?: keyof typeof JINGLES
  level?: number
  band?: 'ultrasonic' | 'hidden'
}

/** Play `url` through the speaker, alternating presets, until stopped. Call from a click handler. */
export async function announce (url: string, opts: AnnounceOptions = {}): Promise<{ stop: () => void, done: Promise<void>, frames: Record<Preset, Uint8Array> }> {
  const { gap = 0.5, loop = true, loops = Infinity, jingle, level = -18, band = 'ultrasonic' } = opts
  const presets: Preset[] = jingle != null ? [band] : opts.presets ?? ['fast', 'voice']
  const ctx = opts.ctx ?? new AudioContext()
  await ctx.resume()
  const bytes = opts.key != null ? await sealMessage(url, opts.key) : encodeLink(url)
  const frames = Object.fromEntries(presets.map(p => [p, bytes])) as Record<Preset, Uint8Array>
  let running = true
  const play = async (preset: Preset): Promise<void> => {
    const data = modulate(bytes, ctx.sampleRate, PRESETS[preset] as ModemOptions)
    const wave = jingle != null ? underJingle(data, JINGLES[jingle], ctx.sampleRate, level, band === 'hidden') : data
    const buf = ctx.createBuffer(1, wave.length, ctx.sampleRate)
    buf.getChannelData(0).set(wave)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    await new Promise<void>(resolve => { src.onended = () => resolve(); src.start() })
    await new Promise(r => setTimeout(r, gap * 1000))
  }
  const done = (async () => {
    for (let n = 0; running && n < loops; n++) {
      for (const p of presets) { if (!running) return; await play(p) }
      if (!loop) break
    }
    running = false
  })()
  return { stop: () => { running = false }, done, frames }
}

export interface ListenOptions {
  /** Presets to decode at the same time. Default ['fast', 'voice', 'ultrasonic', 'hidden']. */
  presets?: Preset[]
  ctx?: AudioContext
}

/** Open the microphone and call `cb` for every link heard, on any of the presets. Call from a click handler. */
export async function listen (cb: (heard: Heard) => void, opts: ListenOptions = {}): Promise<{ stop: () => void, level: () => number }> {
  const { presets = ['fast', 'voice', 'ultrasonic', 'hidden'] } = opts
  const ctx = opts.ctx ?? new AudioContext()
  const micRequest = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
  await ctx.resume()
  const mic = await micRequest
  const rxs = presets.map(preset => new Demodulator(ctx.sampleRate, frame => {
    void decodeLink(frame).then(link => { if (link != null) cb({ ...link, preset, at: Date.now() }) })
  }, PRESETS[preset] as ModemOptions))
  let rms = 0
  // ponytail: ScriptProcessorNode, same as src/browser.ts; AudioWorklet when it gets removed
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  proc.onaudioprocess = e => {
    const samples = new Float32Array(e.inputBuffer.getChannelData(0))
    let sum = 0
    for (const s of samples) sum += s * s
    rms = Math.sqrt(sum / samples.length)
    for (const rx of rxs) rx.push(samples)
  }
  const mute = ctx.createGain()
  mute.gain.value = 0
  const source = ctx.createMediaStreamSource(mic)
  source.connect(proc).connect(mute).connect(ctx.destination)
  return {
    level: () => rms,
    stop: () => { proc.disconnect(); source.disconnect(); mic.getTracks().forEach(t => t.stop()) }
  }
}

export { peerIdFromPublicKey }
