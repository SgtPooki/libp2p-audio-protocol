import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { fromString, toString } from 'uint8arrays'
import { announce, listen, type Heard } from '../../src/announce.ts'
import { modulate, PRESETS, type Preset } from '../../src/modem.ts'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const params = new URLSearchParams(location.search)
const escape = (s: string): string => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)

async function loadKey () {
  const saved = localStorage.getItem('audio-qr-key')
  if (saved != null) return privateKeyFromProtobuf(fromString(saved, 'base64'))
  const key = await generateKeyPair('Ed25519')
  localStorage.setItem('audio-qr-key', toString(privateKeyToProtobuf(key), 'base64'))
  return key
}

function show (mode: 'host' | 'guest'): void {
  $('host').hidden = mode !== 'host'
  $('guest').hidden = mode !== 'guest'
  $('tab-host').classList.toggle('on', mode === 'host')
  $('tab-guest').classList.toggle('on', mode === 'guest')
  params.set('mode', mode)
  history.replaceState(null, '', `?${params}`)
}
$('tab-host').onclick = () => show('host')
$('tab-guest').onclick = () => show('guest')
show(params.get('mode') === 'host' ? 'host' : 'guest')
if (params.has('url')) $<HTMLInputElement>('url').value = params.get('url')!

// ---- host ----
let current: { stop: () => void } | undefined
$('announce').onclick = async () => {
  const url = $<HTMLInputElement>('url').value.trim()
  if (url === '') return
  const presets = (['fast', 'voice', 'ultrasonic'] as Preset[]).filter(p => $<HTMLInputElement>(`p-${p}`).checked)
  if (presets.length === 0) return
  const key = $<HTMLInputElement>('sign').checked ? await loadKey() : undefined
  $('announce').hidden = true; $('stop').hidden = false
  current = await announce(url, { presets, key })
  const bytes = key != null ? 110 + new TextEncoder().encode(url).length : 1 + new TextEncoder().encode(url).length
  const secs = presets.map(p => `${p} ${(modulate(new Uint8Array(bytes), 1000, PRESETS[p]).length / 1000).toFixed(1)} s`).join(', ')
  $('host-status').innerHTML = `📢 looping <b>${escape(url)}</b> (${key != null ? `signed by <code>…${peerIdFromPrivateKey(key).toString().slice(-6)}</code>` : 'unsigned'}; ${secs} per frame)`
}
$('stop').onclick = () => {
  current?.stop()
  $('announce').hidden = false; $('stop').hidden = true
  $('host-status').textContent = 'stopped'
}

// ---- guest ----
$('listen').onclick = async () => {
  $<HTMLButtonElement>('listen').disabled = true
  const seen = new Map<string, HTMLElement>()
  const onHeard = (h: Heard): void => {
    const key = `${h.url}|${h.from?.toString() ?? ''}`
    let card = seen.get(key)
    if (card == null) {
      card = document.createElement('a')
      card.className = 'card'
      card.setAttribute('href', h.url)
      card.setAttribute('target', '_blank')
      card.setAttribute('rel', 'noopener')
      $('cards').prepend(card)
      seen.set(key, card)
      if (navigator.vibrate != null) navigator.vibrate(100)
    }
    const n = Number(card.dataset.n ?? 0) + 1
    card.dataset.n = String(n)
    card.innerHTML = `<span class="url">${escape(h.url)}</span><small>${h.from != null ? `✔ signed by <code>…${h.from.toString().slice(-6)}</code>` : '⚠ unsigned'} · heard on ${h.preset}${n > 1 ? ` · ${n}x` : ''} · ${new Date(h.at).toLocaleTimeString()}</small>`
  }
  try {
    const rx = await listen(onHeard)
    $('guest-status').textContent = 'listening on fast, voice and ultrasonic. Put the phone near the speaker.'
    const bar = $('meter').firstElementChild as HTMLElement
    setInterval(() => { bar.style.width = `${Math.min(100, rx.level() * 400)}%` }, 100)
  } catch (err: any) {
    $('guest-status').textContent = `⚠️ ${err.message}`
    $<HTMLButtonElement>('listen').disabled = false
  }
}
