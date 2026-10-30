// A room with time: transmissions take as long as their audio, overlap when two nodes talk at once
// (listeners hear the mix), and the link's timers run on node:test's mocked clock. For measuring
// collisions and turn-taking, which the instant room in room.ts cannot.
import { mock } from 'node:test'
import { modulate, Demodulator, maxPayload, type ModemOptions } from '../src/modem.ts'
import type { AudioLink } from '../src/protocol.ts'

/** `end` includes the gap after the frame; `audioEnd` is where the sound stops. Overlap means sound over sound. */
interface Tx { from: number, wave: Float32Array, start: number, audioEnd: number, end: number, resolve: () => void, overlapped: boolean }

export interface TimedRoom {
  link: () => AudioLink
  /** Advance the room until `done()` or `maxSeconds` of virtual time; returns virtual seconds elapsed. */
  run: (done: () => boolean, maxSeconds: number) => Promise<number>
  /** overlaps counts frames; sameStep counts pairs that started in the same 100 ms step, before either could hear the other. */
  stats: { frames: number, airtime: number, overlaps: number, sameStep: number, now: number }
}

/**
 * `selfGain`: how loud a node hears its own speaker (0 = deaf to itself; a laptop mic hears its speaker at least as loud as
 * the room). `paths`: every sender→listener path gets its own gain (0 to -spread dB) and delay (0-30 ms), drawn from the
 * seed, instead of one 0.3 for everyone: near/far capture, asymmetric ACK paths.
 */
export function timedRoom ({ rate = 16000, opts, gap = 0.3, lbt = true, noise = 0.05, seed = 1, selfGain = 0, paths = 0 }: { rate?: number, opts?: ModemOptions, gap?: number, lbt?: boolean, noise?: number, seed?: number, selfGain?: number, paths?: number } = {}): TimedRoom {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  const listeners: Array<{ rx: Demodulator, cbs: Array<(f: Uint8Array) => void> }> = []
  const pending: Array<{ from: number, frame: Uint8Array, resolve: () => void, readyAt: number }> = []
  const active: Tx[] = []
  const stats = { frames: 0, airtime: 0, overlaps: 0, sameStep: 0, now: 0 }
  let s = seed
  const rnd = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
  const STEP = 0.1
  // sender -> listener path: gain and delay in samples, fixed for the room's life
  const pathOf = new Map<string, { gain: number, delay: number }>()
  const path = (from: number, to: number): { gain: number, delay: number } => {
    const k = `${from}>${to}`
    let p = pathOf.get(k)
    if (p == null) { p = paths > 0 ? { gain: 0.3 * 10 ** (-paths * rnd() / 20), delay: Math.round(rnd() * 0.03 * rate) } : { gain: 0.3, delay: 0 }; pathOf.set(k, p) }
    return p
  }

  const step = (): void => {
    const now = stats.now
    // start transmissions whose node hears nobody else (carrier sense), else back off a random slot
    for (const p of pending.splice(0)) {
      if (p.readyAt > now) { pending.push(p); continue }
      // one speaker per node: a second frame waits for the first to finish playing
      const own = active.find(t => t.from === p.from && t.audioEnd > now)
      if (own != null) { p.readyAt = own.audioEnd; pending.push(p); continue }
      // the node's own demodulator decides, as the browser's does: a tone in the band, or a decoded frame's tail still
      // playing. Two nodes that start inside the same 100 ms step cannot hear each other yet (stats.sameStep).
      const rx = listeners[p.from].rx
      if (lbt && rx.tailLeft() > 0) { p.readyAt = now + rx.tailLeft() + 0.03; pending.push(p); continue } // as browser.ts: wait exactly for the tail
      if (lbt && rx.busy()) { p.readyAt = now + 0.2 + rnd() * 0.8; pending.push(p); continue }
      const wave = modulate(p.frame, rate, opts)
      const tx: Tx = { from: p.from, wave, start: now, audioEnd: now + wave.length / rate, end: now + wave.length / rate + gap, resolve: p.resolve, overlapped: false }
      for (const o of active) if (o.audioEnd > now) { o.overlapped = true; tx.overlapped = true; if (o.start === now) stats.sameStep++; if (process.env.ROOM_DEBUG != null) console.log(`overlap: ${p.from} starts at ${now.toFixed(1)} over ${o.from} (started ${(now - o.start).toFixed(1)} s ago); starter busy=${listeners[p.from].rx.busy()} tailLeft=${listeners[p.from].rx.tailLeft().toFixed(2)}`) }
      active.push(tx)
      stats.frames++; stats.airtime += wave.length / rate
    }
    // mix this step's audio for every listener
    const n = Math.round(STEP * rate)
    const from = Math.round(now * rate)
    for (const [i, l] of listeners.entries()) {
      const buf = new Float32Array(n)
      for (let k = 0; k < n; k++) buf[k] = (rnd() - 0.5) * noise
      for (const t of active) {
        const p = t.from === i ? { gain: selfGain, delay: 0 } : path(t.from, i) // own speaker at selfGain (0: deaf to itself)
        if (p.gain === 0) continue
        const off = from - Math.round(t.start * rate) - p.delay
        for (let k = 0; k < n; k++) { const v = t.wave[off + k]; if (v != null) buf[k] += p.gain * v }
      }
      l.rx.push(buf)
    }
    stats.now = now + STEP
    for (const t of active.splice(0)) {
      if (t.end <= stats.now) { if (t.overlapped) stats.overlaps++; t.resolve() } else active.push(t)
    }
  }
  const settle = async (): Promise<void> => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)) }

  return {
    stats,
    link () {
      const me = listeners.length
      const cbs: Array<(f: Uint8Array) => void> = []
      listeners.push({ cbs, rx: new Demodulator(rate, f => { for (const cb of cbs) cb(f) }, opts) })
      return {
        send: async (frame) => await new Promise<void>(resolve => { pending.push({ from: me, frame, resolve, readyAt: stats.now }) }),
        onFrame (cb) { cbs.push(cb) },
        maxFrame: maxPayload(opts),
        duration: (bytes) => modulate(new Uint8Array(bytes), rate, opts).length / rate
      }
    },
    async run (done, maxSeconds) {
      const t0 = stats.now
      while (!done() && stats.now - t0 < maxSeconds) {
        step()
        mock.timers.tick(STEP * 1000)
        await settle()
      }
      return stats.now - t0
    }
  }
}

export const stopTime = (): void => { mock.timers.reset() }
