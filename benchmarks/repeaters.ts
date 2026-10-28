// Content broadcast coverage: how long until listeners at 1x, 2x and 4x the source's range hold a
// verified 2 KB document, with 0, 1 or 3 opt-in repeaters. Run: node benchmarks/repeaters.ts [--out benchmarks/REPEATERS.md]
//
// Model: nodes on a line, source at 0, repeaters at 1x (and 2x, 3x), 20 listeners at 1x/2x/4x. In-band
// SNR falls 6 dB per doubling of distance from SNR1, the level where a 69-byte chunk frame decodes ~90%
// (measured below). Every frame is really modulated, mixed with each listener's own noise and demodulated.
// Time is virtual: a node transmits when its send is ready and it hears no one (carrier sense at a
// lower threshold); two frames that overlap at a listener that hears both are both lost (collision).
// Repeaters relay only after they verified the content against the CID (src/protocol.ts).
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { generateKeyPair } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { modulate, Demodulator, PRESETS } from '../src/modem.ts'
import { AudioService, type AudioLink } from '../src/protocol.ts'

const { values: args } = parseArgs({ options: { out: { type: 'string' }, budget: { type: 'string', default: '1200' }, seed: { type: 'string', default: '1' } } })
const RATE = 8000 // voice tones are below 2.6 kHz
const OPTS = PRESETS.voice
const BUDGET = Number(args.budget) // seconds of virtual time per scenario
const GAP = 0.3 // seconds between a node's frames
const SLOT = 1 // random backoff after sensing a busy channel, seconds
const BAND = [800, 2700]
const DOC = new TextEncoder().encode('FLOOD NOTICE 2026-10-28 14:00. Boil water until further notice. Shelters open: North High School (gym), Community Center (hall B). Fairgrounds shelter CLOSED. Medical tent at the library. Water distribution at the north gate 14:00, bring containers. '.repeat(8)).subarray(0, 2048)

let seed = Number(args.seed)
const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
const gauss = (): number => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd())
const power = (x: Float32Array): number => { let s = 0; for (const v of x) s += v * v; return s / x.length }
/** Noise sigma so the in-band SNR against `sig` power is `snrDb`. */
const sigma = (sig: number, snrDb: number): number => Math.sqrt(sig / 10 ** (snrDb / 10) / ((BAND[1] - BAND[0]) / (RATE / 2)))

/** Share of 69-byte chunk frames that decode at a given in-band SNR. */
function frameSuccess (snrDb: number, trials = 40): number {
  let ok = 0
  for (let t = 0; t < trials; t++) {
    const payload = Uint8Array.from({ length: 69 }, () => rnd() * 256)
    const wave = modulate(payload, RATE, OPTS)
    const s = sigma(power(wave), snrDb)
    const heard = new Float32Array(wave.length + RATE).map((_, i) => (wave[i - RATE / 2] ?? 0) + s * gauss())
    let got = false
    const rx = new Demodulator(RATE, p => { got = p.length === 69 && p.every((b, i) => b === payload[i]) }, OPTS)
    for (let i = 0; i < heard.length; i += 4096) rx.push(heard.subarray(i, i + 4096))
    if (got) ok++
  }
  return ok / trials
}

// find SNR1: the ~90% point, searched downwards in 1 dB steps
let SNR1 = 0
while (SNR1 > -20 && frameSuccess(SNR1 - 1) >= 0.9) SNR1--
process.stderr.write(`SNR1 (90% frame success) = ${SNR1} dB\n`)
const SENSE = SNR1 - 12 // a transmission is sensed (channel busy) down to here
const AUDIBLE = SNR1 - 9 // and rendered to a listener down to here; below that it's just noise

interface Node { name: string, ring: string, x: number, svc: AudioService, rx?: Demodulator, decodedAt?: number, pending?: { frame: Uint8Array, resolve: () => void, readyAt: number }, busyUntil: number }
interface Tx { node: Node, wave: Float32Array, start: number, end: number, rendered: boolean }

const snrAt = (from: Node, to: Node): number => SNR1 - 20 * Math.log10(Math.max(Math.abs(from.x - to.x), 0.05))

async function scenario (repeaters: number[]): Promise<{ rows: Record<string, { n: number, done: number[] }>, airtime: number, collisions: number, txs: number }> {
  const nodes: Node[] = []
  const txs: Tx[] = []
  let now = 0
  const sourceKey = await generateKeyPair('Ed25519')
  const sourceId = peerIdFromPrivateKey(sourceKey).toString()
  const make = async (name: string, ring: string, x: number, repeat: boolean, key?: Awaited<ReturnType<typeof generateKeyPair>>): Promise<Node> => {
    const node: Node = { name, ring, x, busyUntil: 0 } as Node
    const link: AudioLink = {
      // every sender waits a random slot between its own frames, so a looping source doesn't own the channel
      send: async (frame) => await new Promise<void>(resolve => { node.pending = { frame, resolve, readyAt: Math.max(now, node.busyUntil) + rnd() * SLOT } }),
      onFrame: cb => { node.rx = new Demodulator(RATE, cb, OPTS) }
    }
    node.svc = new AudioService({ privateKey: key ?? await generateKeyPair('Ed25519'), addressManager: { getAddresses: () => [] } }, link, repeat ? { repeat: { allow: [sourceId], loops: 3 } } : {})
    node.svc.start()
    node.svc.addEventListener('content', () => { node.decodedAt ??= now })
    nodes.push(node)
    return node
  }
  const source = await make('source', 'source', 0, false, sourceKey)
  for (const [i, x] of repeaters.entries()) await make(`repeater${i}`, 'repeater', x, true)
  const rings: Array<[string, number, number]> = [['1x', 1, 7], ['2x', 2, 7], ['4x', 4, 6]]
  for (const [ring, x, n] of rings) for (let i = 0; i < n; i++) await make(`${ring}-${i}`, ring, x * (0.7 + 0.3 * (i + 1) / n), false)

  const settle = async (): Promise<void> => { await new Promise(r => setTimeout(r, 2)) }
  const noiseFor = (node: Node, sig: number, from: Node): number => sigma(sig, snrAt(from, node))

  /** Push transmission `t` into every node that can hear it; overlapping audible frames are both lost. */
  const render = (t: Tx): void => {
    t.rendered = true
    const sig = power(t.wave)
    for (const node of nodes) {
      if (node === t.node || node.rx == null || snrAt(t.node, node) < AUDIBLE) continue
      const clash = txs.some(o => o !== t && o.start < t.end && o.end > t.start && o.node !== node && snrAt(o.node, node) >= AUDIBLE)
      const s = noiseFor(node, sig, t.node)
      const gap = Math.round(GAP * RATE)
      const out = new Float32Array(t.wave.length + gap)
      for (let i = 0; i < out.length; i++) out[i] = (clash || i >= t.wave.length ? 0 : t.wave[i]) + s * gauss() + (clash && i < t.wave.length ? 0.5 * Math.sqrt(sig) * gauss() : 0)
      for (let i = 0; i < out.length; i += 4096) node.rx.push(out.subarray(i, i + 4096))
    }
  }

  void source.svc.publish(DOC, { name: 'flood', headline: 'Boil water', loops: 1000 })
  while (source.pending == null) await settle()
  let collisions = 0
  let airtime = 0
  for (;;) {
    let ready = nodes.filter(n => n.pending != null).sort((a, b) => a.pending!.readyAt - b.pending!.readyAt)
    if (ready.length === 0) { // a decode may still be verifying; give it a moment before calling it quiet
      for (let i = 0; i < 10 && ready.length === 0; i++) { await settle(); ready = nodes.filter(n => n.pending != null) }
      if (ready.length === 0) break
      continue
    }
    const node = ready[0]
    const p = node.pending!
    if (p.readyAt > BUDGET) break
    // everything that ends before this send starts is heard first (and may trigger new sends)
    const due = txs.filter(t => !t.rendered && t.end <= p.readyAt).sort((a, b) => a.end - b.end)
    if (due.length > 0) {
      for (const t of due) { now = t.end; render(t); await settle() }
      continue
    }
    // listen before talk: anyone this node can sense still on the air?
    const busy = txs.find(t => t.node !== node && t.start <= p.readyAt && t.end > p.readyAt && snrAt(t.node, node) >= SENSE)
    if (busy != null) { p.readyAt = busy.end + rnd() * SLOT; continue }
    now = p.readyAt
    const wave = modulate(p.frame, RATE, OPTS)
    const tx: Tx = { node, wave, start: now, end: now + wave.length / RATE + GAP, rendered: false }
    if (txs.some(o => o.start < tx.end && o.end > tx.start)) collisions++
    txs.push(tx)
    airtime += wave.length / RATE
    node.busyUntil = tx.end
    node.pending = undefined
    p.resolve()
    await settle()
  }
  const rows: Record<string, { n: number, done: number[] }> = {}
  for (const node of nodes) {
    if (node.ring === 'source' || node.ring === 'repeater') continue
    rows[node.ring] ??= { n: 0, done: [] }
    rows[node.ring].n++
    if (node.decodedAt != null) rows[node.ring].done.push(node.decodedAt)
  }
  return { rows, airtime, collisions, txs: txs.length }
}

const pct = (xs: number[], n: number, q: number): string => {
  const sorted = [...xs].sort((a, b) => a - b)
  const i = Math.ceil(q * n) - 1
  return i < sorted.length ? `${Math.round(sorted[i])} s` : 'never'
}
const lines: string[] = []
const SCENARIOS: Array<[string, number[]]> = [['0 repeaters', []], ['1 repeater at 1x', [1]], ['3 repeaters at 1x, 2x, 3x', [1, 2, 3]]]
for (const [label, reps] of SCENARIOS) {
  const r = await scenario(reps)
  const all = Object.values(r.rows).flatMap(x => x.done)
  const n = Object.values(r.rows).reduce((s, x) => s + x.n, 0)
  const cell = (ring: string): string => { const x = r.rows[ring]; return `${x.done.length}/${x.n}, median ${pct(x.done, x.n, 0.5)}` }
  lines.push(`| ${label} | ${cell('1x')} | ${cell('2x')} | ${cell('4x')} | ${pct(all, n, 0.5)} | ${pct(all, n, 0.9)} | ${Math.round(r.airtime)} s / ${r.txs} | ${r.collisions} |`)
  process.stderr.write(`${label}: ${lines.at(-1)}\n`)
}
const md = `# Content broadcast with repeaters

Simulated (\`node benchmarks/repeaters.ts\`, seed ${args.seed}): a ${DOC.length}-byte notice published as a signed pointer plus
60-byte fountain chunks on a loop, 20 listeners on a line at 1x, 2x and 4x the source's range (7, 7, 6),
budget ${BUDGET} s of virtual time. Range 1x is the distance where a chunk frame decodes 90% (in-band SNR ${SNR1} dB,
measured); SNR falls 6 dB per doubling. Repeaters relay only content they verified against the CID, from a
random chunk index, 3 loops, with listen-before-talk and Trickle-style suppression; frames that overlap at a
listener are lost. Cells: listeners that hold verified content, and the median time for that ring; T50/T90
over all 20 listeners ("never" = not within the budget).

| scenario | 1x | 2x | 4x | T50 | T90 | airtime / frames | overlapping frames |
| --- | --- | --- | --- | --- | --- | --- | --- |
${lines.join('\n')}
`
console.log(md)
if (args.out != null) writeFileSync(args.out, md)
