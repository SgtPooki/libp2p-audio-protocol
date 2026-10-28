// Content broadcast: a signed ContentPointer names a CID, then the bytes go out as fountain chunks.
// Listeners rebuild the bytes from any K chunks, from the publisher or from any repeater, and
// verify them against the CID in the pointer, so repeaters need no trust. Design: notes/content-broadcast.md.
//
// Pointer payload: CBOR map (multicodec `cbor`, 0x51) in a libp2p signed envelope, domain `libp2p-audio-content`:
//   { v: 1, t: sentAt ms, x: validFor s, n: name, c: CID bytes, l: length, e: encoding (0 identity, 1 deflate-raw),
//     z: encoded length, m: chunk msgId, h: headline }
// `sentAt` is the sequence for (publisher, name); the pointer expires at sentAt + validFor.

import { decode, encode } from 'cborg'
import { CID } from 'multiformats/cid'
import * as raw from 'multiformats/codecs/raw'
import { sha256 } from 'multiformats/hashes/sha2'
import { fnv1a } from './broadcast.ts'

export class ContentPointer {
  static DOMAIN = 'libp2p-audio-content'
  static CODEC = Uint8Array.of(0x51) // cbor
  readonly domain = ContentPointer.DOMAIN
  readonly codec = ContentPointer.CODEC
  readonly name: string
  readonly sentAt: number
  readonly validFor: number
  readonly cid: CID
  readonly len: number
  readonly encoding: 0 | 1
  readonly encLen: number
  readonly msgId: number
  readonly headline: string

  constructor (f: { name: string, sentAt: number, validFor: number, cid: CID, len: number, encoding: 0 | 1, encLen: number, msgId: number, headline: string }) {
    this.name = f.name; this.sentAt = f.sentAt; this.validFor = f.validFor; this.cid = f.cid; this.len = f.len
    this.encoding = f.encoding; this.encLen = f.encLen; this.msgId = f.msgId; this.headline = f.headline
  }

  get validUntil (): number { return this.sentAt + this.validFor * 1000 }

  marshal (): Uint8Array {
    return encode({ v: 1, t: this.sentAt, x: this.validFor, n: this.name, c: this.cid.bytes, l: this.len, e: this.encoding, z: this.encLen, m: this.msgId, h: this.headline })
  }

  static unmarshal (b: Uint8Array): ContentPointer | undefined {
    try {
      const o = decode(b)
      if (o.v !== 1 || typeof o.n !== 'string' || typeof o.h !== 'string' || ![0, 1].includes(o.e)) return undefined
      for (const k of ['t', 'x', 'l', 'z', 'm']) if (!Number.isInteger(o[k]) || o[k] < 0) return undefined
      return new ContentPointer({ name: o.n, sentAt: o.t, validFor: o.x, cid: CID.decode(o.c), len: o.l, encoding: o.e, encLen: o.z, msgId: o.m, headline: o.h })
    } catch { return undefined }
  }

  equals (other: unknown): boolean {
    return other instanceof ContentPointer && other.cid.equals(this.cid) && other.sentAt === this.sentAt && other.name === this.name
  }
}

async function pipe (bytes: Uint8Array, stream: CompressionStream | DecompressionStream, cap: number): Promise<Uint8Array | undefined> {
  const reader = new Blob([bytes.slice()]).stream().pipeThrough(stream).getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    total += r.value.length
    if (total > cap) { await reader.cancel(); return undefined } // decompression bomb or just wrong
    parts.push(r.value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

/** The CID of `bytes` (CIDv1, raw, sha2-256: the same CID `ipfs add --cid-version 1 --raw-leaves` gives a small file). */
export const cidOf = async (bytes: Uint8Array): Promise<CID> => CID.createV1(raw.code, await sha256.digest(bytes))

/** Compress if it helps; the pointer fields a listener needs to check the result. */
export async function encodeContent (bytes: Uint8Array): Promise<{ cid: CID, encoded: Uint8Array, encoding: 0 | 1 }> {
  const deflated = await pipe(bytes, new CompressionStream('deflate-raw'), Infinity)
  const [encoded, encoding]: [Uint8Array, 0 | 1] = deflated != null && deflated.length < bytes.length ? [deflated, 1] : [bytes, 0]
  return { cid: await cidOf(bytes), encoded, encoding }
}

/** Decode and verify fountain-rebuilt bytes against a pointer: undefined unless the hash matches the CID. */
export async function decodeContent (encoded: Uint8Array, p: ContentPointer): Promise<Uint8Array | undefined> {
  if (encoded.length !== p.encLen || fnv1a(encoded) !== p.msgId) return undefined
  const bytes = p.encoding === 0 ? encoded : await pipe(encoded, new DecompressionStream('deflate-raw'), p.len).catch(() => undefined)
  if (bytes == null || bytes.length !== p.len) return undefined
  return (await cidOf(bytes)).equals(p.cid) ? bytes : undefined
}
