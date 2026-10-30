// Microphone capture shared by the browser link and the Audio QR listener: one ScriptProcessorNode feeding every
// demodulator, with a main-thread stall (a dropped buffer) padded with silence so symbol timing later in the frame holds.
import type { Demodulator } from './modem.ts'

export interface Capture { level: () => number, stop: () => void }

/** Feed `rxs` from `mic`. `onSamples` sees every buffer (diagnostics). Call from a user gesture (the context must be running). */
export function capture (ctx: AudioContext, mic: MediaStream, rxs: Demodulator[], onSamples?: (samples: Float32Array) => void): Capture {
  // ponytail: ScriptProcessorNode is deprecated but works everywhere incl. iOS Safari; AudioWorklet when it gets removed
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  let nextTime: number | undefined
  let rms = 0
  proc.onaudioprocess = e => {
    const samples = new Float32Array(e.inputBuffer.getChannelData(0))
    if (nextTime != null) {
      const missing = Math.round((e.playbackTime - nextTime) * ctx.sampleRate)
      if (missing > 256 && missing < 10 * ctx.sampleRate) for (const rx of rxs) rx.push(new Float32Array(missing))
    }
    nextTime = e.playbackTime + samples.length / ctx.sampleRate
    let sum = 0
    for (const s of samples) sum += s * s
    rms = Math.sqrt(sum / samples.length)
    onSamples?.(samples)
    for (const rx of rxs) rx.push(samples)
  }
  const mute = ctx.createGain()
  mute.gain.value = 0
  const source = ctx.createMediaStreamSource(mic)
  source.connect(proc).connect(mute).connect(ctx.destination)
  return { level: () => rms, stop: () => { proc.disconnect(); source.disconnect(); mic.getTracks().forEach(t => t.stop()) } }
}
