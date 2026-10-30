// The on-air format of every preset, pinned: a change here means two builds cannot decode each other.
// Update deliberately with UPDATE_FIXTURES=1 node --test test/wire-format.test.ts, and say so in the commit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { modulate, PRESETS } from '../src/modem.ts'
import { JINGLES, TUNABLE, tunePreset } from '../src/jingle.ts'

const FILE = new URL('./fixtures/wire-format.json', import.meta.url)
const payload = Uint8Array.from({ length: 60 }, (_, i) => (i * 37 + 11) & 255)
const presets: Record<string, Parameters<typeof modulate>[2]> = { ...PRESETS, default: undefined, ...Object.fromEntries(TUNABLE.map(j => [`tune:${j}`, tunePreset(JINGLES[j])])) }
const digest = (name: string): string => createHash('sha256').update(Buffer.from(modulate(payload, 48000, presets[name]).buffer)).digest('hex').slice(0, 16)

test('every preset still produces the pinned waveform', () => {
  const now = Object.fromEntries(Object.keys(presets).map(n => [n, digest(n)]))
  if (process.env.UPDATE_FIXTURES != null) { writeFileSync(FILE, JSON.stringify(now, null, 2) + '\n'); return }
  const pinned = JSON.parse(readFileSync(FILE, 'utf8'))
  for (const [name, hash] of Object.entries(now)) assert.equal(hash, pinned[name], `${name}: on-air format changed; both ends must ship together (UPDATE_FIXTURES=1 to pin)`)
  assert.deepEqual(Object.keys(pinned).sort(), Object.keys(now).sort())
})
