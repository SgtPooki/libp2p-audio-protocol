import { createLibp2p } from 'libp2p'
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys'
import { fromString, toString } from 'uint8arrays'
import { audio } from '../../src/protocol.ts'
import { browserAudioLink } from '../../src/browser.ts'
import { PRESETS, type Preset } from '../../src/modem.ts'
import type { PeerId } from '@libp2p/interface'

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
const preset = (params.get('preset') ?? 'voice') as Preset
// ?symbolSeconds=0.03 overrides speed (both devices must match)
const modem = { ...PRESETS[preset], ...(params.has('symbolSeconds') ? { symbolSeconds: Number(params.get('symbolSeconds')) } : {}) }
const select = $<HTMLSelectElement>('preset')
select.value = preset
select.onchange = () => { params.set('preset', select.value); location.search = params.toString() }
$('bed-row').hidden = preset !== 'ultrasonic'

$('start').onclick = async () => {
  $<HTMLButtonElement>('start').disabled = true
  try {
    log('requesting microphone…', 'sys')
    const link = await browserAudioLink(modem)
    $<HTMLInputElement>('bed').onchange = async e => {
      const file = (e.target as HTMLInputElement).files?.[0]
      link.bed = file == null ? undefined : await link.ctx.decodeAudioData(await file.arrayBuffer())
      if (file != null) log(`🎵 hiding transmissions under “${escape(file.name)}”`, 'sys')
    }
    log('starting libp2p…', 'sys')
    const node = await createLibp2p({ privateKey: await loadKey(), services: { audio: audio(link) } })
    $('start').hidden = true
    $('app').hidden = false
    $('me').textContent = node.peerId.toString()
    log(`listening at ${link.ctx.sampleRate} Hz, preset “${preset}”`, 'sys')

    const bar = $('meter').firstElementChild as HTMLElement
    setInterval(() => { bar.style.width = `${Math.min(100, link.level() * 400)}%` }, 100)

    node.addEventListener('peer:discovery', e => {
      log(`📡 discovered peer <code>${e.detail.id}</code> ✔ signature verified`, 'ok')
    })
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
    $('challenge').onclick = () => busy('asking who is here', link.duration(9), () => node.services.audio.challenge())
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
      void busy(`sending “${escape(text)}”`, link.duration(110 + new TextEncoder().encode(text).length), () => node.services.audio.say(text).catch(err => {
        throw err instanceof RangeError ? new Error('too long for one frame; use 🔁 Loop') : err
      }))
    }
  } catch (err: any) {
    log(`⚠️ ${escape(String(err?.message ?? err))}`, 'sys')
    $<HTMLButtonElement>('start').disabled = false
  }
}
