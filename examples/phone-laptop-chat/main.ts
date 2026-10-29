import { createLibp2p } from 'libp2p'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys'
import { fromString, toString } from 'uint8arrays'
import { audio } from '../../src/protocol.ts'
import { audioTransport, AUDIO_DEFAULTS } from '../../src/transport.ts'
import { browserAudioLink } from '../../src/browser.ts'
import { PRESETS, type Preset } from '../../src/modem.ts'
import { JINGLES } from '../../src/jingle.ts'
import type { PeerId, Stream } from '@libp2p/interface'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const short = (id: PeerId): string => `…${id.toString().slice(-6)}`

function log (html: string, cls = ''): void {
  const li = document.createElement('li')
  li.className = cls
  li.innerHTML = `<span class="sys">${new Date().toLocaleTimeString()}</span> ${html}`
  $('log').prepend(li)
}
const escape = (s: string): string => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)

// Same identity across reloads, so the other device recognizes you.
async function loadKey () {
  const saved = localStorage.getItem('audio-libp2p-key')
  if (saved != null) return privateKeyFromProtobuf(fromString(saved, 'base64'))
  const key = await generateKeyPair('Ed25519')
  localStorage.setItem('audio-libp2p-key', toString(privateKeyToProtobuf(key), 'base64'))
  return key
}

// Both devices must use the same preset; it lives in the URL so the choice survives reloads.
const params = new URLSearchParams(location.search)
// a jingle means the data hides under it on the `hidden` preset
const jingle = JINGLES[params.get('jingle') ?? '']
const preset = (jingle != null && params.get('preset') !== 'hidden' ? 'ultrasonic' : params.get('preset') ?? 'voice') as Preset
// ?symbolSeconds=0.03 overrides speed (both devices must match)
const modem = { ...PRESETS[preset], ...(params.has('symbolSeconds') ? { symbolSeconds: Number(params.get('symbolSeconds')) } : {}) }
const handshake = params.get('handshake') === 'noise' ? 'noise' : 'lean'
const select = $<HTMLSelectElement>('preset')
select.value = preset
select.onchange = () => { params.set('preset', select.value); params.delete('jingle'); location.search = params.toString() }
const jingleSelect = $<HTMLSelectElement>('jingle')
jingleSelect.value = params.get('jingle') ?? ''
jingleSelect.onchange = () => { jingleSelect.value === '' ? params.delete('jingle') : params.set('jingle', jingleSelect.value); location.search = params.toString() }
$('bed-row').hidden = preset !== 'ultrasonic'

$('start').onclick = async () => {
  $<HTMLButtonElement>('start').disabled = true
  try {
    log('requesting microphone…', 'sys')
    // the chosen preset is what we send on. With the default (voice) the dial also tries `dual` then `fast` first
    // and falls back; an explicit preset (ultrasonic, music...) is used as-is. ?ladder=1 / ?ladder=0 override.
    const ladder = params.has('ladder') ? params.get('ladder') === '1' : preset === 'voice'
    const link = await browserAudioLink(ladder && !['fast', 'dual', 'tri', 'turbo', 'hidden'].includes(preset) ? { [preset]: modem, dual: PRESETS.dual, fast: PRESETS.fast } : { [preset]: modem })
    link.jingle = jingle
    $<HTMLInputElement>('bed').onchange = async e => {
      const file = (e.target as HTMLInputElement).files?.[0]
      link.bed = file == null ? undefined : await link.ctx.decodeAudioData(await file.arrayBuffer())
      if (file != null) log(`🎵 hiding transmissions under “${escape(file.name)}”`, 'sys')
    }
    log('starting libp2p…', 'sys')
    const node = await createLibp2p({
      privateKey: await loadKey(),
      ...AUDIO_DEFAULTS,
      addresses: { listen: [`/audio/${preset}`] },
      // lean = the transport's own signed handshake (~300 B on air); ?handshake=noise for stock Noise + yamux (~1 KB)
      // ?encrypt=0 is the sign-only ham mode. rto: a full frame plus a guard before resending.
      transports: [audioTransport(link, { preset, handshake, encrypt: params.get('encrypt') !== '0' })], // timeouts come from link.duration per preset
      connectionEncrypters: [noise()],
      streamMuxers: [yamux({ enableKeepAlive: false })], // a yamux ping is ~5 s of airtime every 30 s
      services: { audio: audio(link) }
    })
    $('start').hidden = true
    $('app').hidden = false
    $('me').textContent = node.peerId.toString()
    log(`listening at ${link.ctx.sampleRate} Hz, preset “${preset}”${jingle != null ? `, transmissions hidden under “${jingle.name}”` : ''}`, 'sys')

    const bar = $('meter').firstElementChild as HTMLElement
    setInterval(() => { bar.style.width = `${Math.min(100, link.level() * 400)}%` }, 100)

    let lastPeer: PeerId | undefined
    let chat: Stream | undefined
    const connectBtn = $<HTMLButtonElement>('connect')
    node.services.audio.addEventListener('peer', e => {
      log(`📡 heard peer record from <code>${e.detail.id}</code> ✔ signature verified`, 'ok')
      lastPeer = e.detail.id
      connectBtn.disabled = false
    })
    // a real libp2p connection over sound: Noise-encrypted, multiplexed; chat messages go over a stream
    const onChat = (stream: Stream, from: PeerId): void => {
      chat = stream
      stream.addEventListener('message', e => { log(`🔒 <code>${short(from)}</code>: ${escape(new TextDecoder().decode(e.data.subarray()))} <span class="ok">encrypted stream</span>`) })
      stream.addEventListener('close', () => { if (chat === stream) chat = undefined })
    }
    await node.handle('/chat/1.0.0', (stream, conn) => { onChat(stream, conn.remotePeer) })
    node.addEventListener('connection:open', e => { log(`🔗 connection ${e.detail.direction} with <code>${short(e.detail.remotePeer)}</code> (${e.detail.encryption}, ${e.detail.multiplexer}, preset ${e.detail.remoteAddr.getComponents()[0]?.value ?? preset})`, 'ok') })
    node.addEventListener('connection:close', e => { log(`🔗 connection with <code>${short(e.detail.remotePeer)}</code> closed`, 'sys') })
    connectBtn.onclick = async () => {
      if (lastPeer == null) return
      connectBtn.disabled = true
      const t0 = Date.now()
      log(`🔗 dialing <code>${short(lastPeer)}</code> over sound (${handshake} handshake)…`, 'me')
      try {
        const conn = await node.dial(lastPeer)
        onChat(await conn.newStream('/chat/1.0.0'), lastPeer)
        log(`🔗 connected in ${((Date.now() - t0) / 1000).toFixed(0)} s; messages now go over the encrypted stream`, 'ok')
        log(`🏓 ping ${(await ping(lastPeer) / 1000).toFixed(1)} s round trip`, 'ok')
      } catch (err: any) { log(`⚠️ ${escape(err.message)}`, 'sys'); connectBtn.disabled = false }
    }
    const ago = (t: number): string => {
      const s = Math.round((Date.now() - t) / 1000)
      return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`
    }
    node.services.audio.addEventListener('message', e => {
      const { from, text, sentAt, present } = e.detail
      log(`💬 <code>${short(from)}</code>: ${escape(text)} <span class="ok">✔ signed</span> <span class="sys">sent ${ago(sentAt)}</span>${present ? ' <span class="ok">🙋 present</span>' : ''}`)
    })
    node.services.audio.addEventListener('rejected', e => {
      const { from, reason, sentAt } = e.detail
      log(`🚫 ignored ${reason} frame from <code>${short(from)}</code>${sentAt != null ? ` (sent ${ago(sentAt)})` : ''}`, 'sys')
    })

    const busy = async (label: string, seconds: number, fn: () => Promise<void>): Promise<void> => {
      const buttons = document.querySelectorAll('button')
      buttons.forEach(b => { b.disabled = true })
      log(`🔊 ${label} (~${Math.ceil(seconds)}s)…`, 'me')
      try { await fn() } catch (err: any) { log(`⚠️ ${escape(err.message)}`, 'sys') } finally { buttons.forEach(b => { b.disabled = false }) }
    }

    $('announce').onclick = () => busy('announcing my peer record', link.duration(157), () => node.services.audio.announce())
    // with a connection open, presence is an authenticated round trip; otherwise it's the one-way challenge
    $('challenge').onclick = () => {
      const peers = node.getPeers()
      if (peers.length > 0) {
        void busy('pinging connected peers', 30, async () => {
          for (const p of peers) log(`🙋 <code>${short(p)}</code> is here: authenticated round trip in ${(await ping(p) / 1000).toFixed(1)} s`, 'ok')
        })
        return
      }
      void busy('asking who is here', link.duration(9), async () => {
        await node.services.audio.challenge()
        log('🙋 asked. Peers that hear it mark their next broadcast message (Send, without a connection) as present', 'sys')
      })
    }
    node.services.audio.addEventListener('challenge', () => { log('🙋 someone asked who is here; your next Send (without a connection) answers it', 'sys') })
    // libp2p ping (32 bytes echoed on /ipfs/ping/1.0.0), done here so both sides can show it
    await node.handle('/ipfs/ping/1.0.0', (stream, conn) => {
      stream.addEventListener('message', e => { stream.send(e.data); log(`🏓 ping from <code>${short(conn.remotePeer)}</code>, answered`, 'ok') })
    })
    const ping = async (peer: PeerId): Promise<number> => {
      const t0 = Date.now()
      const stream = await (await node.dial(peer)).newStream('/ipfs/ping/1.0.0')
      const echoed = new Promise<void>(resolve => stream.addEventListener('message', () => resolve(), { once: true }))
      stream.send(crypto.getRandomValues(new Uint8Array(32)))
      await echoed
      await stream.close()
      return Date.now() - t0
    }
    $('loop').onclick = () => {
      const input = $<HTMLInputElement>('text')
      const text = input.value.trim()
      if (text === '') return
      input.value = ''
      // 2 loops of fountain chunks: ceil(envelope / 60 B) chunks per loop, each chunk 69 B on air
      const chunkCount = 2 * Math.ceil((110 + new TextEncoder().encode(text).length) / 60)
      void busy(`looping “${escape(text)}” as ${chunkCount} chunks`, chunkCount * link.duration(69), () => node.services.audio.broadcast(text, 2))
    }
    $('form').onsubmit = e => {
      e.preventDefault()
      const input = $<HTMLInputElement>('text')
      const text = input.value.trim()
      if (text === '') return
      input.value = ''
      if (chat != null) {
        chat.send(new TextEncoder().encode(text))
        log(`🔒 me: ${escape(text)}`, 'me')
        return
      }
      void busy(`sending “${escape(text)}”`, link.duration(110 + new TextEncoder().encode(text).length), () => node.services.audio.say(text).catch(err => {
        throw err instanceof RangeError ? new Error('too long for one frame; use 🔁 Loop') : err
      }))
    }
  } catch (err: any) {
    log(`⚠️ ${escape(String(err?.message ?? err))}`, 'sys')
    $<HTMLButtonElement>('start').disabled = false
  }
}
