// A simulated room for tests: everything sent is modulated, mixed with noise, and heard by every
// other link. Optional per-frame loss (seeded) and an airtime meter for honest budget numbers.
import { modulate, maxPayload, Demodulator, type ModemOptions } from '../src/modem.ts'
import type { AudioLink } from '../src/protocol.ts'

export interface Room {
  link: () => AudioLink
  /** Frames sent and seconds of audio played so far. */
  stats: { frames: number, seconds: number, bytes: number }
  /** Every frame put on the air, for eavesdropping tests. */
  frames: Uint8Array[]
}

export function air ({ rate = 48000, loss = 0, seed = 1, opts, presets, dead = [] }: { rate?: number, loss?: number, seed?: number, opts?: ModemOptions, presets?: Record<string, ModemOptions>, dead?: string[] } = {}): Room {
  // several named presets: every link hears all of them; `dead` presets never get through (a TV that cuts ultrasound, say)
  const named: Record<string, ModemOptions | undefined> = presets ?? { default: opts } // undefined = the voice preset, as in the browser
  const names = Object.keys(named)
  const listeners: Array<{ rx: Demodulator[] }> = []
  const stats = { frames: 0, seconds: 0, bytes: 0 }
  const frames: Uint8Array[] = []
  let s = seed
  const rnd = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
  return {
    stats,
    frames,
    link () {
      const cbs: Array<(f: Uint8Array, preset?: string) => void> = []
      const me = { rx: names.map(name => new Demodulator(rate, f => { for (const cb of cbs) cb(f, presets == null ? undefined : name) }, named[name])) }
      listeners.push(me)
      return {
        presets: presets == null ? undefined : names,
        maxFrame: Math.min(...names.map(n => maxPayload(named[n]))),
        async send (frame, preset) {
          const name = preset ?? names[0]
          const wave = modulate(frame, rate, named[name])
          stats.frames++; stats.bytes += frame.length; stats.seconds += wave.length / rate; frames.push(frame)
          if (dead.includes(name)) return
          const heard = new Float32Array(wave.length + rate).map((_, i) => 0.3 * (wave[i - rate / 2] ?? 0) + (rnd() - 0.5) * 0.1)
          for (const l of listeners) {
            if (l === me || rnd() < loss) continue
            for (let i = 0; i < heard.length; i += 2048) for (const rx of l.rx) rx.push(heard.subarray(i, i + 2048))
          }
        },
        onFrame (f) { cbs.push(f) }
      }
    }
  }
}
