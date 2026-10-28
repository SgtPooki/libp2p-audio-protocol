// A room with time: transmissions take as long as their audio, overlap when two nodes talk at once
// (listeners hear the mix), and the link's timers run on node:test's mocked clock. For measuring
// collisions and turn-taking, which the instant room in room.ts cannot.
import { mock } from 'node:test'
import { modulate, Demodulator, type ModemOptions } from '../src/modem.ts'
import type { AudioLink } from '../src/protocol.ts'

interface Tx { from: number, wave: Float32Array, start: number, end: number, resolve: () => void, overlapped: boolean }

export interface TimedRoom {
  link: () => AudioLink
  /** Advance the room until `done()` or `maxSeconds` of virtual time; returns virtual seconds elapsed. */
  run: (done: () => boolean, maxSeconds: number) => Promise<number>
  stats: { frames: number, airtime: number, overlaps: number, now: number }
}

export function timedRoom ({ rate = 16000, opts, gap = 0.3, lbt = true, noise = 0.05, seed = 1 }: { rate?: number, opts?: ModemOptions, gap?: number, lbt?: boolean, noise?: number, seed?: number } = {}): TimedRoom {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() })
  const listeners: Array<{ rx: Demodulator, cbs: Array<(f: Uint8Array) => void> }> = []
  const pending: Array<{ from: number, frame: Uint8Array, resolve: () => void, readyAt: number }> = []
  const active: Tx[] = []
  const stats = { frames: 0, airtime: 0, overlaps: 0, now: 0 }
  let s = seed
  const rnd = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
  const STEP = 0.1

  const step = (): void => {
    const now = stats.now
    // start transmissions whose node hears nobody else (carrier sense), else back off a random slot
    for (const p of pending.splice(0)) {
      if (p.readyAt > now) { pending.push(p); continue }
      if (lbt && active.some(t => t.from !== p.from && t.end > now)) { p.readyAt = now + 0.2 + rnd() * 0.8; pending.push(p); continue }
      const wave = modulate(p.frame, rate, opts)
      const tx: Tx = { from: p.from, wave, start: now, end: now + wave.length / rate + gap, resolve: p.resolve, overlapped: false }
      for (const o of active) if (o.end > now) { o.overlapped = true; tx.overlapped = true }
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
        if (t.from === i) continue // a node doesn't hear itself (it is deaf while it plays)
        const off = from - Math.round(t.start * rate)
        for (let k = 0; k < n; k++) { const v = t.wave[off + k]; if (v != null) buf[k] += 0.3 * v }
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
        onFrame (cb) { cbs.push(cb) }
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
