import { createLibp2p } from 'libp2p'
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys'
import { fromString, toString } from 'uint8arrays'
import { audio } from '../../src/protocol.ts'
import { browserAudioLink } from '../../src/browser.ts'
import { PRESETS, type Preset } from '../../src/modem.ts'
import { JINGLES } from '../../src/jingle.ts'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const params = new URLSearchParams(location.search)
const short = (id: string): string => `…${id.slice(-6)}`
const time = (t: number): string => new Date(t).toLocaleTimeString()

async function loadKey () {
  const saved = localStorage.getItem('audio-libp2p-key') // same identity as the chat demo
  if (saved != null) return privateKeyFromProtobuf(fromString(saved, 'base64'))
  const key = await generateKeyPair('Ed25519')
  localStorage.setItem('audio-libp2p-key', toString(privateKeyToProtobuf(key), 'base64'))
  return key
}

let mode: 'host' | 'guest' = params.get('mode') === 'host' ? 'host' : 'guest'
function show (): void {
  $('tab-host').classList.toggle('on', mode === 'host')
  $('tab-guest').classList.toggle('on', mode === 'guest')
  params.set('mode', mode)
  history.replaceState(null, '', `?${params}`)
}
$('tab-host').onclick = () => { mode = 'host'; show() }
$('tab-guest').onclick = () => { mode = 'guest'; show() }
show()
const select = $<HTMLSelectElement>('preset')
const jingle = JINGLES[params.get('jingle') ?? '']
select.value = jingle != null && params.get('preset') !== 'hidden' ? 'ultrasonic' : params.get('preset') ?? 'voice'
select.onchange = () => { params.set('preset', select.value); params.delete('jingle'); location.search = params.toString() }
const jingleSelect = $<HTMLSelectElement>('jingle')
jingleSelect.value = params.get('jingle') ?? ''
jingleSelect.onchange = () => { jingleSelect.value === '' ? params.delete('jingle') : params.set('jingle', jingleSelect.value); location.search = params.toString() }

$('start').onclick = async () => {
  $<HTMLButtonElement>('start').disabled = true
  const preset = select.value as Preset
  const link = await browserAudioLink({ [preset]: PRESETS[preset] })
  link.jingle = jingle
  const node = await createLibp2p({ privateKey: await loadKey(), services: { audio: audio(link) } })
  $('me').textContent = node.peerId.toString()
  $('start').hidden = true
  $(mode).hidden = false
  $('tabs').hidden = true
  const bar = $('meter').firstElementChild as HTMLElement
  setInterval(() => { bar.style.width = `${Math.min(100, link.level() * 400)}%` }, 100)
  const svc = node.services.audio

  if (mode === 'host') {
    // attendees: PeerId -> first answer that proved presence
    const seen = new Map<string, { first: number, last: number, answers: number }>()
    let asked = 0
    const render = (): void => {
      $('count').textContent = String(seen.size)
      $('list').innerHTML = [...seen.entries()].sort((a, b) => b[1].last - a[1].last)
        .map(([id, s]) => `<li><code>${id}</code><br><span class="badge${Date.now() - s.last > 2 * Number($<HTMLInputElement>('every').value) * 1000 ? ' old' : ''}">present ${time(s.last)}</span> <span class="sys">first ${time(s.first)}, ${s.answers} answer${s.answers === 1 ? '' : 's'}</span></li>`).join('')
    }
    svc.addEventListener('message', e => {
      const { from, present, sentAt } = e.detail
      if (!present) return // a reply without our fresh nonce proves nothing (could be a recording)
      const id = from.toString()
      const s = seen.get(id) ?? { first: sentAt, last: sentAt, answers: 0 }
      s.last = Math.max(s.last, sentAt); s.answers++
      seen.set(id, s)
      render()
    })
    const ask = async (): Promise<void> => {
      asked++
      $('host-status').textContent = `🔊 asking (#${asked}) at ${time(Date.now())}… replies take ${Math.ceil(link.duration(120))}-${Math.ceil(link.duration(120) + 20)} s each`
      await svc.challenge()
      render()
    }
    let timer: ReturnType<typeof setInterval> | undefined
    $('ask').onclick = () => {
      void ask()
      clearInterval(timer)
      if ($<HTMLInputElement>('repeat').checked) timer = setInterval(() => { void ask() }, Math.max(20, Number($<HTMLInputElement>('every').value)) * 1000)
    }
    $('export').onclick = () => {
      const blob = new Blob([JSON.stringify({ host: node.peerId.toString(), exportedAt: new Date().toISOString(), attendees: Object.fromEntries(seen) }, null, 2)], { type: 'application/json' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'checkin.json'; a.click()
    }
  } else {
    // guest: answer each question once, after a random wait so a room of phones doesn't all talk at once
    const answered = new Set<string>()
    const log = (html: string): void => { const li = document.createElement('li'); li.innerHTML = html; $('list-guest').prepend(li) }
    svc.addEventListener('challenge', e => {
      const key = toString(e.detail.nonce, 'hex')
      if (answered.has(key)) return
      answered.add(key)
      const wait = 1 + Math.random() * 20
      $('guest-status').textContent = `🙋 the host asked who's here; answering in ${wait.toFixed(0)} s…`
      setTimeout(async () => {
        await svc.say('here')
        $('guest-status').innerHTML = `<span class="ok">✔ answered at ${time(Date.now())}</span>; the host can only count you if it heard this reply`
        log(`<span class="ok">✔</span> answered question <code>${key.slice(0, 8)}</code> at ${time(Date.now())}`)
      }, wait * 1000)
    })
    svc.addEventListener('message', e => { log(`💬 <code>${short(e.detail.from.toString())}</code>: ${e.detail.text}`) })
  }
}
