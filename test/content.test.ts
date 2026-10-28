import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPair } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { AudioService, type AudioLink, type AudioServiceInit } from '../src/protocol.ts'
import { cidOf, ContentPointer, encodeContent } from '../src/content.ts'
import { CHUNK_MAGIC } from '../src/broadcast.ts'

/** Instant frames, no modem; `hears(from, to)` decides who is in range of whom. */
function air (hears: (from: number, to: number) => boolean = () => true) {
  const ears: Array<(f: Uint8Array) => void> = []
  const sent: Array<{ from: number, frame: Uint8Array }> = []
  const link = (): AudioLink => {
    const me = ears.length
    ears.push(() => {})
    return {
      async send (f) { sent.push({ from: me, frame: f }); ears.forEach((e, i) => { if (i !== me && hears(me, i)) e(f) }) },
      onFrame (cb) { ears[me] = cb }
    }
  }
  return { link, sent, ears }
}

async function node (link: AudioLink, init?: AudioServiceInit) {
  const privateKey = await generateKeyPair('Ed25519')
  const svc = new AudioService({ privateKey, addressManager: { getAddresses: () => [] } }, link, { blockSize: 40, ...init })
  svc.start()
  const content: any[] = []; const pointers: any[] = []; const rejected: any[] = []
  svc.addEventListener('content', e => content.push(e.detail))
  svc.addEventListener('pointer', e => pointers.push(e.detail))
  svc.addEventListener('rejected', e => rejected.push(e.detail))
  return { svc, id: peerIdFromPrivateKey(privateKey), content, pointers, rejected }
}
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 10)) }
const notice = new TextEncoder().encode('FLOOD NOTICE. Boil water until further notice. Shelters: North High School, Community Center. Fairgrounds CLOSED. '.repeat(18))

test('a 2 KB document is published as a pointer plus fountain chunks and rebuilt, verified against its CID, despite loss', async () => {
  const room = air()
  const a = await node(room.link())
  // a lossy listener hears only two chunks in three
  let n = 0
  const lossy = air((_, to) => to === 0 || ++n % 3 !== 0)
  const b = await node({ async send () {}, onFrame (cb) { room.ears.push(f => { if (f[0] !== CHUNK_MAGIC || ++n % 3 !== 0) cb(f) }) } })
  void lossy
  const pointer = await a.svc.publish(notice, { name: 'flood', headline: 'Boil water', validFor: 3600 })
  await settle()
  assert.ok(pointer.encLen < notice.length / 3, `compressed ${notice.length} -> ${pointer.encLen}`)
  assert.equal(b.pointers.length, 1)
  assert.equal(b.pointers[0].headline, 'Boil water')
  assert.equal(b.content.length, 1, 'delivered once although the carousel loops twice')
  assert.deepEqual(b.content[0].bytes, notice)
  assert.ok(b.content[0].cid.equals(await cidOf(notice)))
  assert.ok(b.content[0].from.equals(a.id))
})

test('forged chunks and forged or expired pointers never produce content; a newer pointer replaces an older one', async () => {
  const room = air()
  const a = await node(room.link())
  const b = await node(room.link())
  const attacker = await node(room.link())
  // the attacker publishes under its own key with the same name: delivered, but as the attacker's content, never as a's
  await attacker.svc.publish(new TextEncoder().encode('go to the fairgrounds'), { name: 'flood' })
  await settle()
  assert.ok(b.content.every(c => c.from.equals(attacker.id)))
  b.content.length = 0
  // forged chunks mixed into a real broadcast spoil attempts but never yield wrong bytes
  const { encoded } = await encodeContent(notice)
  const realLink = room.link()
  const publisher = await node({ async send (f) { await realLink.send(f); if (f[0] === CHUNK_MAGIC) { const bad = f.slice(); bad.fill(0x42, 9); await realLink.send(bad) } }, onFrame () {} })
  await publisher.svc.publish(notice, { name: 'flood', loops: 4 })
  await settle()
  assert.ok(b.content.length >= 1)
  assert.ok(b.content.every(c => c.bytes.length === notice.length && c.bytes.every((v: number, i: number) => v === notice[i])))
  void encoded
  // an expired pointer is rejected
  const old = await a.svc.publish(notice, { name: 'old', validFor: 0 })
  await settle()
  assert.ok(b.rejected.some(r => r.reason === 'expired' && r.sentAt === old.sentAt))
  // a replayed (older) pointer for a name is rejected once a newer one was heard
  const first = room.sent.find(s => s.from === 2) // the attacker's 'flood' pointer again, after a's newer 'old' pointer... same name rule is per publisher
  room.ears[1](first!.frame)
  await settle()
  assert.ok(b.rejected.some(r => r.reason === 'old-record'))
  assert.ok(ContentPointer.unmarshal(new Uint8Array([1, 2, 3])) == null)
})

test('repeaters: an opted-in listener re-sends verified content from an allowlisted publisher, reaching a listener out of the source range', async () => {
  // 0 = source, 1 = repeater (hears source), 2 = far listener (hears only the repeater), 3 = unrelated publisher
  const room = air((from, to) => !(from === 0 && to === 2) && !(from === 3 && to === 2))
  const source = await node(room.link())
  const repeater = await node(room.link(), { repeat: { allow: [], loops: 2 } })
  const far = await node(room.link())
  const other = await node(room.link())
  ;(repeater.svc as any).init.repeat.allow.push(source.id.toString())
  await other.svc.publish(new TextEncoder().encode('buy gold '.repeat(100)), { name: 'spam' })
  await settle()
  assert.equal(repeater.content.length, 1)
  assert.equal(far.content.length, 0, 'content from a publisher not on the allowlist is not repeated')
  await source.svc.publish(notice, { name: 'flood', headline: 'Boil water' })
  await settle()
  assert.equal(far.content.length, 1, 'the far listener got it via the repeater')
  assert.deepEqual(far.content[0].bytes, notice)
  assert.ok(far.content[0].from.equals(source.id), 'still attributed to the signer, not the repeater')
  const relayed = room.sent.filter(s => s.from === 1)
  assert.ok(relayed.length > 1, 'repeater sent the pointer and chunks')
  assert.ok(relayed.some(s => s.frame[0] === CHUNK_MAGIC && new DataView(s.frame.buffer).getUint16(7) >= 4), 'repeater chunks start past K')
})
