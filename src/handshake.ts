// Transport-owned handshake: one round trip, ~230 bytes, instead of multistream + Noise XX (~600 bytes,
// 2.5 round trips). Both sides already know who they expect: the dialer heard the listener's PeerId
// in a signed PeerRecord (it is in the multiaddr), and the listener learns the dialer's key from msg1.
// SIGMA-style: each side signs the other's fresh ephemeral key with its identity key, so a recording
// can't be replayed and a man in the middle can't substitute keys. Ed25519 identities only.
//
//   msg1 (dialer):   [ver=1][mode][dialer public key, protobuf 36][dialer ephemeral x25519 32][sig 64]
//                    sig over DOMAIN || 'init' || listener PeerId bytes || msg1[0..70]
//   msg2 (listener): [listener ephemeral 32][sig 64]
//                    sig over DOMAIN || 'resp' || msg1 || listener ephemeral
//   keys: HKDF-SHA256(x25519 shared secret, salt = SHA-256(msg1 || msg2), info = DOMAIN) -> 32 bytes per direction
//
// Records after the handshake:
//   mode 0 (encrypt):   [len u16][ChaCha20-Poly1305(key, nonce = record counter, plaintext)]
//   mode 1 (sign-only): [len u16][plaintext][HMAC-SHA256(key, counter || plaintext) first 16 bytes]
// Sign-only is for amateur radio, where encoding to obscure meaning is forbidden (47 CFR 97.113(a)(4))
// but authenticating the sender is not. The mode is inside the signed msg1, so it can't be downgraded.

import { peerIdFromPublicKey } from '@libp2p/peer-id'
import { publicKeyFromProtobuf, publicKeyToProtobuf } from '@libp2p/crypto/keys'
import { chacha20poly1305 } from '@noble/ciphers/chacha.js'
import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { Uint8ArrayList } from 'uint8arraylist'
import type { PeerId, PrivateKey } from '@libp2p/interface'

export const DOMAIN = 'libp2p-audio-handshake/1'
export const MSG1 = 2 + 36 + 32 + 64
export const MSG2 = 32 + 64
const TAG = 16
const enc = new TextEncoder()
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

export class HandshakeError extends Error { name = 'HandshakeError' }

/** Record layer for one connection: `seal` outgoing bytes, `open` incoming bytes (buffered until whole records arrive). */
export class Session {
  private readonly sendKey: Uint8Array
  private readonly recvKey: Uint8Array
  readonly encrypt: boolean
  private sent = 0
  private received = 0
  private readonly buf = new Uint8ArrayList()

  constructor (sendKey: Uint8Array, recvKey: Uint8Array, encrypt: boolean) {
    this.sendKey = sendKey; this.recvKey = recvKey; this.encrypt = encrypt
  }

  private static nonce (counter: number): Uint8Array {
    const n = new Uint8Array(12)
    new DataView(n.buffer).setUint32(8, counter)
    return n
  }

  seal (plain: Uint8Array): Uint8Array {
    const nonce = Session.nonce(this.sent++)
    const body = this.encrypt
      ? chacha20poly1305(this.sendKey, nonce).encrypt(plain)
      : cat(plain, hmac(sha256, this.sendKey, cat(nonce, plain)).subarray(0, TAG))
    if (body.length > 0xffff) throw new RangeError('record too long')
    return cat(Uint8Array.of(body.length >> 8, body.length & 0xff), body)
  }

  /** Throws HandshakeError on a bad tag: the caller must drop the connection. */
  open (bytes: Uint8Array): Uint8Array[] {
    this.buf.append(bytes)
    const out: Uint8Array[] = []
    while (this.buf.byteLength >= 2) {
      const len = (this.buf.get(0) << 8) | this.buf.get(1)
      if (this.buf.byteLength < 2 + len) break
      const body = this.buf.subarray(2, 2 + len)
      this.buf.consume(2 + len)
      const nonce = Session.nonce(this.received++)
      if (this.encrypt) {
        try { out.push(chacha20poly1305(this.recvKey, nonce).decrypt(body)) } catch { throw new HandshakeError('bad record') }
      } else {
        if (len < TAG) throw new HandshakeError('bad record')
        const plain = body.subarray(0, len - TAG)
        const tag = hmac(sha256, this.recvKey, cat(nonce, plain)).subarray(0, TAG)
        if (!tag.every((v, i) => v === body[len - TAG + i])) throw new HandshakeError('bad record')
        out.push(plain.slice())
      }
    }
    return out
  }
}

function deriveKeys (secret: Uint8Array, eph: Uint8Array, peerEph: Uint8Array, msg1: Uint8Array, msg2: Uint8Array): [Uint8Array, Uint8Array] {
  const shared = x25519.getSharedSecret(secret, peerEph)
  const keys = hkdf(sha256, shared, sha256(cat(msg1, msg2)), enc.encode(DOMAIN), 64)
  return [keys.subarray(0, 32), keys.subarray(32)] // [dialer -> listener, listener -> dialer]
}

/** Dialer side: build msg1 for `listener`; `finish` checks msg2 and yields the session. */
export async function initiate (key: PrivateKey, listener: PeerId, encrypt = true): Promise<{ msg1: Uint8Array, finish: (msg2: Uint8Array) => Promise<Session> }> {
  const listenerKey = listener.publicKey
  if (key.type !== 'Ed25519' || listenerKey == null) throw new HandshakeError('Ed25519 identities only')
  const eph = x25519.keygen()
  const head = cat(Uint8Array.of(1, encrypt ? 0 : 1), publicKeyToProtobuf(key.publicKey), eph.publicKey)
  const msg1 = cat(head, await key.sign(cat(enc.encode(DOMAIN + 'init'), listener.toMultihash().bytes, head)))
  return {
    msg1,
    async finish (msg2) {
      if (msg2.length !== MSG2) throw new HandshakeError('bad msg2')
      const peerEph = msg2.subarray(0, 32)
      if (!await listenerKey.verify(cat(enc.encode(DOMAIN + 'resp'), msg1, peerEph), msg2.subarray(32))) throw new HandshakeError('listener signature invalid')
      const [send, recv] = deriveKeys(eph.secretKey, eph.publicKey, peerEph, msg1, msg2)
      return new Session(send, recv, encrypt)
    }
  }
}

/** Listener side: check msg1 (must ask for our mode), answer with msg2, and yield the dialer's PeerId and the session. */
export async function respond (key: PrivateKey, msg1: Uint8Array, encrypt = true): Promise<{ remotePeer: PeerId, msg2: Uint8Array, session: Session }> {
  if (key.type !== 'Ed25519') throw new HandshakeError('Ed25519 identities only')
  if (msg1.length !== MSG1 || msg1[0] !== 1) throw new HandshakeError('bad msg1')
  if ((msg1[1] === 1) === encrypt) throw new HandshakeError(`dialer wants ${msg1[1] === 1 ? 'sign-only' : 'encryption'}, this side is configured otherwise`)
  let remoteKey
  try { remoteKey = publicKeyFromProtobuf(msg1.subarray(2, 38)) } catch { throw new HandshakeError('bad dialer key') }
  if (remoteKey.type !== 'Ed25519') throw new HandshakeError('Ed25519 identities only')
  const self = peerIdFromPublicKey(key.publicKey)
  if (!await remoteKey.verify(cat(enc.encode(DOMAIN + 'init'), self.toMultihash().bytes, msg1.subarray(0, 70)), msg1.subarray(70))) throw new HandshakeError('dialer signature invalid')
  const peerEph = msg1.subarray(38, 70)
  const eph = x25519.keygen()
  const msg2 = cat(eph.publicKey, await key.sign(cat(enc.encode(DOMAIN + 'resp'), msg1, eph.publicKey)))
  const [recv, send] = deriveKeys(eph.secretKey, eph.publicKey, peerEph, msg1, msg2)
  return { remotePeer: peerIdFromPublicKey(remoteKey), msg2, session: new Session(send, recv, encrypt) }
}
