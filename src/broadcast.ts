// Looping broadcast with a fountain code (random linear network coding over GF(256)).
//
// A message is split into K blocks. Chunk i < K carries block i as-is; every later chunk
// carries a pseudo-random mix of all K blocks. A listener needs ANY K independent chunks,
// in any order, so it can tune in at any point of an endless broadcast and finish after
// hearing about K more chunks, no matter which ones were lost.
//
// Chunk frame: [0xB0][msgId u32][msgLen u16][index u16][data]

import { inv, mul } from './rs.ts'

export const CHUNK_MAGIC = 0xb0
const HEADER = 9

/** FNV-1a: a short id that groups chunks of the same message. */
export function fnv1a (bytes: Uint8Array): number {
  let h = 0x811c9dc5
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193)
  return h >>> 0
}

/** Coefficients for chunk `index` of a K-block message: unit vector for i < K, else seeded random. */
function coefficients (msgId: number, index: number, k: number): Uint8Array {
  const c = new Uint8Array(k)
  if (index < k) { c[index] = 1; return c }
  let s = (msgId ^ Math.imul(index, 0x9e3779b1)) >>> 0
  for (let j = 0; j < k; j++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5 // xorshift32
    c[j] = ((s >>> 0) % 255) + 1
  }
  return c
}

export const isChunk = (frame: Uint8Array): boolean => frame[0] === CHUNK_MAGIC && frame.length > HEADER

/**
 * Endless chunk generator for `message`, each chunk carrying `blockSize` data bytes. A repeater
 * starts at a random index >= K so its chunks are fresh combinations, not copies of the source's.
 */
export function * chunks (message: Uint8Array, blockSize: number, start = 0): Generator<Uint8Array> {
  if (message.length > 0xffff) throw new RangeError('message too long')
  const k = Math.ceil(message.length / blockSize)
  const msgId = fnv1a(message)
  const blocks = Array.from({ length: k }, (_, j) => {
    const b = new Uint8Array(blockSize)
    b.set(message.subarray(j * blockSize, (j + 1) * blockSize))
    return b
  })
  for (let index = start & 0xffff; ; index = (index + 1) & 0xffff) {
    const c = coefficients(msgId, index, k)
    const frame = new Uint8Array(HEADER + blockSize)
    const view = new DataView(frame.buffer)
    frame[0] = CHUNK_MAGIC
    view.setUint32(1, msgId)
    view.setUint16(5, message.length)
    view.setUint16(7, index)
    for (let j = 0; j < k; j++) {
      if (c[j] === 0) continue
      for (let n = 0; n < blockSize; n++) frame[HEADER + n] ^= mul(c[j], blocks[j][n])
    }
    yield frame
  }
}

/** Collects chunks of possibly many messages; returns a message once enough chunks arrived. */
export class ChunkCollector {
  // msgId -> rows in reduced row echelon form, keyed by pivot column
  private readonly pending = new Map<number, { len: number, k: number, size: number, rows: Map<number, Uint8Array> }>()
  // finished messages; a broadcast keeps looping after we've decoded it
  private readonly done = new Set<number>()

  add (frame: Uint8Array): Uint8Array | undefined {
    if (!isChunk(frame)) return undefined
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
    const msgId = view.getUint32(1)
    const len = view.getUint16(5)
    const size = frame.length - HEADER
    const k = Math.ceil(len / size)
    if (k === 0 || this.done.has(msgId)) return undefined
    let m = this.pending.get(msgId)
    if (m == null || m.len !== len || m.size !== size) {
      m = { len, k, size, rows: new Map() }
      this.pending.set(msgId, m)
      // bound memory against junk chunks: keep the 32 most recently started messages
      if (this.pending.size > 32) this.pending.delete(this.pending.keys().next().value!)
    }
    // row = [coefficients | data]
    const row = new Uint8Array(k + size)
    row.set(coefficients(msgId, view.getUint16(7), k))
    row.set(frame.subarray(HEADER), k)
    // eliminate existing pivots from the new row
    for (const [p, r] of m.rows) if (row[p] !== 0) axpy(row, r, row[p])
    const pivot = row.findIndex((v, i) => i < k && v !== 0)
    if (pivot === -1) return undefined // nothing new
    scale(row, inv(row[pivot]))
    for (const r of m.rows.values()) if (r[pivot] !== 0) axpy(r, row, r[pivot])
    m.rows.set(pivot, row)
    if (m.rows.size < k) return undefined

    // Either way this attempt is over. On a bad hash (a corrupted or forged chunk got mixed in),
    // start over from fresh chunks instead of giving up on this message for good.
    this.pending.delete(msgId)
    const out = new Uint8Array(k * size)
    for (let j = 0; j < k; j++) out.set(m.rows.get(j)!.subarray(k), j * size)
    const message = out.slice(0, len)
    if (fnv1a(message) !== msgId) return undefined
    this.done.add(msgId)
    // ponytail: bounded memory; a message older than the last 256 decoded could be decoded again
    if (this.done.size > 256) this.done.delete(this.done.values().next().value!)
    return message
  }
}

/** row -= f * other (GF(256): subtraction is xor) */
function axpy (row: Uint8Array, other: Uint8Array, f: number): void {
  for (let i = 0; i < row.length; i++) if (other[i] !== 0) row[i] ^= mul(f, other[i])
}
function scale (row: Uint8Array, f: number): void {
  for (let i = 0; i < row.length; i++) row[i] = mul(row[i], f)
}
