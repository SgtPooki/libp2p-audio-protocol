// AudioLink for browsers: speaker out, microphone in.

import { capture } from './capture.ts'
import { underJingle, type Jingle } from './jingle.ts'
import { modulate, maxPayload, Demodulator, PRESETS, type ModemOptions } from './modem.ts'
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
  /** Output level 0..1 for every transmission. Default 1. The modem decodes at -6 dB in-band SNR, so a quiet room needs far less than full volume. */
  volume?: number
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
  const cap = capture(ctx, mic, rxs)

  // listen before talk: if the band is busy only with the tail of the frame we just decoded, wait exactly for
  // it (we are the one answering); if someone else is talking, wait a random moment and look again
  const clear = async (): Promise<void> => {
    const tail = Math.max(...rxs.map(rx => rx.tailLeft()))
    if (tail > 0) await new Promise(r => setTimeout(r, tail * 1000 + 30))
    for (let i = 0; i < 60 && rxs.some(rx => rx.busy()); i++) await new Promise(r => setTimeout(r, 200 + Math.random() * 500))
  }
  let queue = Promise.resolve()
  const link: BrowserAudioLink = {
    ctx,
    level: cap.level,
    presets: names,
    maxFrame: Math.min(...names.map(n => maxPayload(presets[n]))),
    duration: (bytes, preset) => modulate(new Uint8Array(bytes), 1000, pick(preset)).length / 1000,
    onFrame (f) { cbs.push(f) },
    send (frame, preset) {
      // reject a bad frame here, not inside the speaker queue: a rejection in the chain would stall every later send
      if (frame.length === 0 || frame.length > maxPayload(pick(preset))) return Promise.reject(new RangeError(`frame must be 1..${maxPayload(pick(preset))} bytes`))
      const job = queue.then(clear).then(() => new Promise<void>((resolve, reject) => {
        const data = modulate(frame, ctx.sampleRate, pick(preset))
        const wave = link.jingle != null ? underJingle(data, link.jingle, ctx.sampleRate, link.jingleLevel ?? -18, preset === 'hidden' || (preset == null && names[0] === 'hidden')) : data
        const buf = ctx.createBuffer(1, wave.length, ctx.sampleRate)
        buf.getChannelData(0).set(wave)
        const src = ctx.createBufferSource()
        src.buffer = buf
        const vol = ctx.createGain()
        vol.gain.value = link.volume ?? 1
        src.connect(vol).connect(ctx.destination)
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
        try { src.start() } catch (err) { reject(err) }
      }))
      queue = job.catch(() => {}) // the queue survives a failed job; the caller gets the rejection
      return job
    }
  }
  return link
}
