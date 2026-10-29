import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunks, ChunkCollector, isChunk } from '../src/broadcast.ts'

// seeded, so the probabilistic bounds below are the same every run
let seed = 7
const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 }
const rand = (n: number): Uint8Array => Uint8Array.from({ length: n }, () => rnd() * 256)

test('any K chunks from anywhere in the loop rebuild the message', () => {
  let decoded = 0
  for (let trial = 0; trial < 50; trial++) {
    const msg = rand(50 + trial * 7)
    const size = 20 + (trial % 4) * 10
    const k = Math.ceil(msg.length / size)
    const gen = chunks(msg, size)
    const all = Array.from({ length: 3 * k + 10 }, () => gen.next().value as Uint8Array)
    // listener joins late and misses a random half of what it hears
    const heard = all.slice(Math.floor(rnd() * k * 2)).filter(() => rnd() < 0.5)
    const c = new ChunkCollector()
    let out: Uint8Array | undefined
    let used = 0
    for (const ch of heard) { used++; out = c.add(ch); if (out != null) break }
    if (out == null) continue // not enough heard this trial; fine, nothing wrong decoded
    decoded++
    assert.deepEqual(out, msg)
    assert.ok(used <= k + 2, `needed ${used} chunks for k=${k}`)
  }
  // hearing half of >= 2K+10 chunks almost always gives K independent ones
  assert.ok(decoded >= 45, `only ${decoded}/50 trials decoded`)
})

test('a forged chunk spoils one attempt but cannot block the real message', () => {
  const msg = rand(150)
  const gen = chunks(msg, 30)
  const real = Array.from({ length: 12 }, () => gen.next().value as Uint8Array)
  const forged = real[7].slice()
  forged.fill(0x42, 9) // same header (msgId, length, index), junk data
  const c = new ChunkCollector()
  let out: Uint8Array | undefined
  for (const f of [forged, ...real]) out = c.add(f) ?? out
  assert.deepEqual(out, msg)
})

test('interleaved messages, duplicates and junk do not confuse the collector', () => {
  const a = rand(100); const b = rand(80)
  const ga = chunks(a, 30); const gb = chunks(b, 30)
  const c = new ChunkCollector()
  const got: Uint8Array[] = []
  const first = ga.next().value as Uint8Array
  for (let i = 0; i < 10; i++) {
    for (const f of [first, ga.next().value as Uint8Array, gb.next().value as Uint8Array, rand(39)]) {
      const out = c.add(f)
      if (out != null) got.push(out)
    }
  }
  assert.equal(got.length, 2)
  assert.ok(got.some(m => m.length === 100 && m.every((v, i) => v === a[i])))
  assert.ok(got.some(m => m.length === 80 && m.every((v, i) => v === b[i])))
  assert.equal(isChunk(Uint8Array.of(0x0a, 1, 2)), false)
})
