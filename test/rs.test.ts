import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rsEncode, rsDecode } from '../src/rs.ts'

test('reed-solomon corrects up to nsym/2 errors', () => {
  for (let trial = 0; trial < 200; trial++) {
    const data = Uint8Array.from({ length: 1 + (trial % 200) }, () => Math.random() * 256)
    const cw = rsEncode(data, 16)
    const errs = trial % 9 // 0..8 errors
    const bad = cw.slice()
    const pos = new Set<number>()
    while (pos.size < errs) pos.add(Math.floor(Math.random() * bad.length))
    for (const p of pos) bad[p] ^= 1 + Math.floor(Math.random() * 255)
    assert.deepEqual(rsDecode(bad, 16), data, `trial ${trial} errs ${errs}`)
  }
})

test('reed-solomon corrects erasures + errors while 2*errors + erasures <= nsym', () => {
  for (let trial = 0; trial < 300; trial++) {
    const data = Uint8Array.from({ length: 10 + (trial % 150) }, () => Math.random() * 256)
    const cw = rsEncode(data, 16)
    const erasures = trial % 17 // 0..16
    const errs = Math.floor(Math.random() * (Math.floor((16 - erasures) / 2) + 1))
    const pos = new Set<number>()
    while (pos.size < erasures + errs) pos.add(Math.floor(Math.random() * cw.length))
    const [erased, wrong] = [[...pos].slice(0, erasures), [...pos].slice(erasures)]
    const bad = cw.slice()
    for (const p of pos) bad[p] ^= 1 + Math.floor(Math.random() * 255)
    assert.deepEqual(rsDecode(bad, 16, erased), data, `trial ${trial}: ${erasures} erasures, ${wrong.length} errors`)
  }
})
