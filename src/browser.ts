// AudioLink for browsers: speaker out, microphone in.

import { underJingle, type Jingle } from './jingle.ts'
import { modulate, Demodulator, PRESETS, type ModemOptions } from './modem.ts'
import type { AudioLink } from './protocol.ts'

export interface BrowserAudioLink extends AudioLink {
  ctx: AudioContext
  /** Recent mic RMS level, 0..1. */
  level: () => number
  /** Seconds of audio a frame of `bytes` length takes to send on `preset` (default: the first). */
  duration: (bytes: number, preset?: string) => number
  presets: string[]
  /** Optional music played under every transmission (pair with the ultrasonic preset to hide data in it). */
  bed?: AudioBuffer
  /** A synthesized public-domain melody to hide every transmission under (pair with the `hidden` preset); see src/jingle.ts. */
  jingle?: Jingle
  /** Data level below the jingle, dB. Default -18. */
  jingleLevel?: number
}

/**
 * Must be called from a user gesture (click) so the AudioContext may start.
 * `presets` are the named modem settings to hear (all at once) and send on; the first is the default.
 */
export async function browserAudioLink (presets: Record<string, ModemOptions> = { voice: PRESETS.voice }): Promise<BrowserAudioLink> {
  const names = Object.keys(presets)
  const pick = (preset?: string): ModemOptions => presets[preset ?? names[0]] ?? presets[names[0]]
  // Start both before any await: Safari only allows them inside the click's user activation.
  const ctx = new AudioContext()
  // Voice processing (echo cancel, noise suppression, AGC) mangles tones, so turn it off.
  const micRequest = navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
  })
  await ctx.resume()
  const mic = await micRequest
  const cbs: Array<(frame: Uint8Array, preset?: string) => void> = []
  const rxs = names.map(name => new Demodulator(ctx.sampleRate, f => { for (const cb of cbs) cb(f, name) }, presets[name]))
  let rms = 0

  // ponytail: ScriptProcessorNode is deprecated but works everywhere incl. iOS Safari; move to AudioWorklet if it gets removed
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
  ctx.createMediaStreamSource(mic).connect(proc).connect(mute).connect(ctx.destination)

  // listen before talk: if someone else's tones fill the band, wait a random moment and look again
  const clear = async (): Promise<void> => {
    for (let i = 0; i < 60 && rxs.some(rx => rx.busy()); i++) await new Promise(r => setTimeout(r, 200 + Math.random() * 500))
  }
  let queue = Promise.resolve()
  const link: BrowserAudioLink = {
    ctx,
    level: () => rms,
    presets: names,
    duration: (bytes, preset) => modulate(new Uint8Array(bytes), 1000, pick(preset)).length / 1000,
    onFrame (f) { cbs.push(f) },
    send (frame, preset) {
      queue = queue.then(clear).then(() => new Promise<void>(resolve => {
        const data = modulate(frame, ctx.sampleRate, pick(preset))
        const wave = link.jingle != null ? underJingle(data, link.jingle, ctx.sampleRate, link.jingleLevel ?? -18) : data
        const buf = ctx.createBuffer(1, wave.length, ctx.sampleRate)
        buf.getChannelData(0).set(wave)
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.connect(ctx.destination)
        src.onended = () => { resolve() }
        if (link.bed != null) {
          const music = ctx.createBufferSource()
          const gain = ctx.createGain()
          music.buffer = link.bed
          music.loop = true
          gain.gain.value = 0.6
          music.connect(gain).connect(ctx.destination)
          music.start()
          music.stop(ctx.currentTime + buf.duration)
        }
        src.start()
      }))
      return queue
    }
  }
  return link
}
