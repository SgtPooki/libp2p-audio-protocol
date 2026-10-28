import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPair } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { initiate, respond, HandshakeError, MSG1, MSG2 } from '../src/handshake.ts'

const text = (s: string): Uint8Array => new TextEncoder().encode(s)

test('handshake: mutual authentication, then records round-trip in both modes', async () => {
  for (const encrypt of [true, false]) {
    const d = await generateKeyPair('Ed25519'); const l = await generateKeyPair('Ed25519')
    const hs = await initiate(d, peerIdFromPrivateKey(l), encrypt)
    assert.equal(hs.msg1.length, MSG1)
    const r = await respond(l, hs.msg1, encrypt)
    assert.equal(r.msg2.length, MSG2)
    assert.ok(r.remotePeer.equals(peerIdFromPrivateKey(d)))
    const s = await hs.finish(r.msg2)
    const rec = s.seal(text('hi'))
    assert.deepEqual(r.session.open(rec.subarray(0, 3)), [])
    assert.deepEqual(r.session.open(rec.subarray(3)), [text('hi')])
    assert.deepEqual(s.open(r.session.seal(text('back'))), [text('back')])
    assert.equal(new TextDecoder().decode(rec).includes('hi'), !encrypt, 'sign-only is readable, encrypted is not')
  }
})

test('handshake: tampering, wrong identities, mode mismatch, replay and record forgery are rejected', async () => {
  const d = await generateKeyPair('Ed25519'); const l = await generateKeyPair('Ed25519'); const x = await generateKeyPair('Ed25519')
  const hs = await initiate(d, peerIdFromPrivateKey(l))
  // msg1 bit flip
  const bad = hs.msg1.slice(); bad[40] ^= 1
  await assert.rejects(respond(l, bad), HandshakeError)
  // msg1 was meant for l, not x: x can't accept it
  await assert.rejects(respond(x, hs.msg1), HandshakeError)
  // listener wants sign-only, dialer asked for encryption
  await assert.rejects(respond(l, hs.msg1, false), HandshakeError)
  // msg2 signed by an impostor
  const r = await respond(l, hs.msg1)
  const forged = r.msg2.slice(); forged.set(await x.sign(r.msg2.subarray(0, 32)), 32)
  await assert.rejects(hs.finish(forged), HandshakeError)
  // a replayed msg1 gets a fresh session the replayer can't read: records from the real session don't open
  const replay = await respond(l, hs.msg1)
  const real = await hs.finish(r.msg2)
  assert.throws(() => replay.session.open(real.seal(text('secret'))), HandshakeError)
  // a flipped record byte is caught in both modes
  for (const encrypt of [true, false]) {
    const h2 = await initiate(d, peerIdFromPrivateKey(l), encrypt)
    const r2 = await respond(l, h2.msg1, encrypt)
    const s2 = await h2.finish(r2.msg2)
    const rec = s2.seal(text('payload')); rec[5] ^= 1
    assert.throws(() => r2.session.open(rec), HandshakeError)
  }
})
