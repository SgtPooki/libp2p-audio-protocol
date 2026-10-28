import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPair } from '@libp2p/crypto/keys'
import { AudioService, sealMessage, type AudioLink, type AudioServiceInit } from '../src/protocol.ts'

/** Frames delivered instantly to every other node; `recorded` lets a test replay anything later. */
function air () {
  const recorded: Uint8Array[] = []
  const ears: Array<(f: Uint8Array) => void> = []
  const link = (): AudioLink => {
    let me: (f: Uint8Array) => void = () => {}
    return {
      async send (f) { recorded.push(f); for (const e of ears) if (e !== me) e(f) },
      onFrame (cb) { me = cb; ears.push(cb) }
    }
  }
  const replay = (f: Uint8Array): void => { for (const e of ears) e(f) }
  return { link, recorded, replay }
}

async function node (link: AudioLink, init?: AudioServiceInit) {
  const privateKey = await generateKeyPair('Ed25519')
  const svc = new AudioService({ privateKey, addressManager: { getAddresses: () => [] } }, link, init)
  svc.start()
  const messages: any[] = []; const rejected: any[] = []; const peers: any[] = []
  svc.addEventListener('message', e => messages.push(e.detail))
  svc.addEventListener('rejected', e => rejected.push(e.detail))
  svc.addEventListener('peer', e => peers.push(e.detail))
  return { svc, privateKey, messages, rejected, peers }
}
const settle = async (): Promise<void> => { await new Promise(r => setTimeout(r, 20)) }

test('T6: a replayed or relayed copy is delivered once', async () => {
  const room = air()
  const a = await node(room.link()); const b = await node(room.link())
  await a.svc.say('shelter open')
  await settle()
  room.replay(room.recorded[0]); room.replay(room.recorded[0])
  await settle()
  assert.equal(b.messages.length, 1)
  assert.deepEqual(b.rejected.map(r => r.reason), ['duplicate', 'duplicate'])
})

test('T2: messages older than maxAge are rejected as stale', async () => {
  const room = air()
  const b = await node(room.link(), { maxAgeMs: 60_000 })
  const key = await generateKeyPair('Ed25519')
  room.replay(await sealMessage('evacuate to the high school', key, Date.now() - 2 * 3_600_000))
  room.replay(await sealMessage('from the future', key, Date.now() + 3_600_000))
  await settle()
  assert.equal(b.messages.length, 0)
  assert.deepEqual(b.rejected.map(r => r.reason), ['stale', 'future'])
})

test('T5: within the window, reordering is tolerated but each message counts once; older than the window is rejected', async () => {
  const room = air()
  const b = await node(room.link(), { windowMs: 10_000 })
  const key = await generateKeyPair('Ed25519')
  const now = Date.now()
  const closed = await sealMessage('shelter closed', key, now)
  const open = await sealMessage('shelter open', key, now - 5_000)
  const ancient = await sealMessage('shelter open (old)', key, now - 20_000)
  room.replay(closed); room.replay(open); room.replay(ancient); room.replay(open)
  await settle()
  assert.deepEqual(b.messages.map(m => m.text), ['shelter closed', 'shelter open'])
  assert.ok(b.messages[0].sentAt > b.messages[1].sentAt, 'sentAt lets the UI order by send time')
  assert.deepEqual(b.rejected.map(r => r.reason), ['duplicate', 'duplicate'])
})

test('sender timestamps are strictly increasing, so rapid messages are not mistaken for replays', async () => {
  const room = air()
  const a = await node(room.link()); const b = await node(room.link())
  await Promise.all([a.svc.say('1'), a.svc.say('2'), a.svc.say('3')])
  await settle()
  assert.equal(b.messages.length, 3)
})

test('T4: an older or repeated PeerRecord is rejected', async () => {
  const room = air()
  const a = await node(room.link()); const b = await node(room.link())
  await a.svc.announce()
  await new Promise(r => setTimeout(r, 5))
  await a.svc.announce()
  await settle()
  room.replay(room.recorded[0]) // older record
  room.replay(room.recorded[1]) // same record again
  await settle()
  assert.equal(b.peers.length, 2)
  assert.deepEqual(b.rejected.map(r => r.reason), ['old-record', 'old-record'])
})

test('T3: only a reply carrying my fresh challenge proves presence; a replayed recording does not', async () => {
  const room = air()
  const medic = await node(room.link()); const shelter = await node(room.link())
  await medic.svc.say('medic on site') // recorded earlier, before any challenge
  await settle()
  await shelter.svc.challenge()
  await settle()
  await medic.svc.say('still here')
  await settle()
  assert.deepEqual(shelter.messages.map(m => [m.text, m.present]), [['medic on site', false], ['still here', true]])
  // an attacker elsewhere replays the old recording after a new challenge: no proof
  const elsewhere = await node(room.link())
  await elsewhere.svc.challenge()
  room.replay(room.recorded[0])
  await settle()
  assert.ok(!elsewhere.messages.some(m => m.present))
})

test('broadcast: long messages arrive via fountain chunks, once, even with chunks lost', async () => {
  const room = air()
  const a = await node(room.link(), { blockSize: 40 })
  const text = 'Water distribution at the north gate 14:00. Bring containers. Medical tent at the library. '.repeat(3)
  // a lossy listener: drops every third chunk
  let n = 0
  const ears: Array<(f: Uint8Array) => void> = []
  const lossy: AudioLink = { async send () {}, onFrame (cb) { ears.push(cb) } }
  const b = await node(lossy)
  a.svc.addEventListener('message', () => {})
  const orig = room.recorded.length
  await a.svc.broadcast(text, 3)
  for (const f of room.recorded.slice(orig)) if (++n % 3 !== 0) ears[0](f)
  await settle()
  assert.equal(b.messages.length, 1)
  assert.equal(b.messages[0].text, text)
})
