# libp2p-audio-protocol

libp2p over sound. Peers find each other, open real libp2p connections, and broadcast signed content as audio tones, so devices can talk with no network at all: through the air, over a loudspeaker, or through a walkie-talkie / FM radio.

Every broadcast frame is a standard [libp2p signed envelope](https://github.com/libp2p/specs/blob/master/RFC/0002-signed-envelopes.md), so a listener can verify which PeerId sent it. Connections are encrypted by default, with a sign-only mode for ham bands. See the [threat model](docs/threat-model.md).

- **Peer discovery**: a signed libp2p `PeerRecord` (PeerId + multiaddrs, including `/audio/<preset>/p2p/<id>`). The `audio()` service is a libp2p `PeerDiscovery` module, so heard peers show up as `peer:discovery` events.
- **Transport**: `audioTransport(link)` is a js-libp2p transport. `node.dial('/audio/voice/p2p/12D3Koo…')` gives a normal `Connection` with streams and protocol handlers (ping, chat, anything). Selective-repeat ARQ, turn-taking and listen-before-talk underneath; keepalives off. Either the stock upgrade (Noise + yamux, ~1 KB, 11 frames on air) or the lean one: a signed handshake that rides in the SYN/SYN-ACK and a 1-byte-header muxer (4 frames, ~390 B; 16 s to a connection over the air, [measured](benchmarks/OVER-THE-AIR.md)). A link that hears several presets dials `fast` first and falls back to the preset in the address (the chat demo does this with the default `voice` preset; an explicit preset is used as-is).
- **Messages**: short signed text with a signed send time (`say`), or looped as fountain chunks (`broadcast`) so late listeners still get it.
- **Content broadcast**: `publish(bytes, { name, headline })` sends a signed `ContentPointer` (CID, size, expiry, headline) and the bytes as fountain chunks. Listeners verify what they rebuild against the CID. Opt-in **repeaters** re-send verified content from allowlisted publishers to extend the range ([simulated](benchmarks/REPEATERS.md)).
- **Pubsub bridge**: `audioBridge(topic)` on a node that is both in the room and on a network republishes every signed message heard over sound onto a pubsub topic, envelope and signature intact, and plays signed envelopes (or re-signed plain text) from the topic into the room. A phone with no network reaches the normal libp2p network through whoever is in earshot.
- **Replay protection**: duplicates, stale messages, old PeerRecords and old or expired pointers are rejected; `challenge()` lets a listener check who is present right now.

## Demo: phone ↔ laptop (`examples/phone-laptop-chat`)

```sh
npm install
npm run demo
```

1. On the laptop, open `https://localhost:5173`. On the phone (same Wi-Fi, only needed to load the page), open the `Network:` URL that Vite prints, e.g. `https://192.168.x.x:5173`. Accept the self-signed certificate warning. Browsers only allow microphone access over https.
2. Tap **Start listening** on both and allow the microphone.
3. Turn the volume up and put the devices near each other. Tap **📡 Announce me** on one device. After about 10 seconds of tones, the other device shows `discovered peer 12D3Koo… ✔ signature verified`.
4. Type a message and **Send**. It arrives tagged with the sender's PeerId, `✔ signed`, and how long ago it was sent.
5. **🔁 Loop** repeats a message as fountain chunks, so someone who starts listening midway still gets it. **🙋 Who's here?** asks for proof of presence: messages sent after it are marked `🙋 present`.
6. **🔗 Connect** dials the last peer heard over sound: a libp2p connection with the lean handshake (about a minute with the voice preset, 16 s with `?preset=ultrasonic&symbolSeconds=0.02` on both devices). After that, messages go over the encrypted stream (🔒) and a ping round trip is shown. `?handshake=noise` uses stock Noise + yamux instead; `?encrypt=0` is the sign-only ham mode.

Once the page has loaded, you can turn off Wi-Fi. Everything after that goes over sound.

Tips: on macOS, set Control Center → Mic Mode to **Standard** (Voice Isolation suppresses tones). Keep the room fairly quiet. The mic level bar should jump while the other device transmits.

## Demo: Audio QR (`examples/announce`)

```sh
npm run demo:announce      # https://localhost:5174
```

The host types a link and taps **Announce**; it plays as sound, alternating the `fast` and `voice` presets (and `ultrasonic` if ticked), or **hidden under a jingle**: pick Westminster Quarters, Shave and a Haircut, Charge! or Beethoven's 5th (public-domain melodies synthesized in `src/jingle.ts`) and the link rides 18 dB under the tune on the `hidden` preset. Listen: `benchmarks/sounds/jingle-westminster-hidden-18dB.wav`. Guests tap **Start listening** and get a tappable card for every link heard, with the preset it came on and, if the host signed it, the host's PeerId. 4.8 s to a link over the air with ultrasonic ([measured](benchmarks/OVER-THE-AIR.md)). In code: `announce(url, { presets, key })` and `listen(cb)` from `src/announce.ts`; no libp2p node needed.

## Demo: check-in by sound (`examples/checkin`)

```sh
npm run demo:checkin      # https://localhost:5175
```

The host taps **Ask who's here**; each guest phone that hears it answers once, after a random wait, with a signed reply carrying the question's nonce. The host lists the keys that were in earshot right then (T3 in the threat model): a forwarded link or a screenshot can't fake it. 2 guests verified in 46 s over the air ([measured](benchmarks/OVER-THE-AIR.md)). Export the list as JSON.

All three demos are hosted at **https://sgtpooki.github.io/libp2p-audio-protocol/** (real certificate, so iPhone Safari works too).

## How it works

| Layer | File | What |
|---|---|---|
| Modem | `src/modem.ts` | MFSK-16: one of 16 tones per 40 ms symbol = 100 bit/s. Sync preamble, 3-copy length header with a vote, CRC-32, Reed-Solomon body, and a tail copy of sync + header so a frame whose start was lost is read backwards. Max 235 bytes per frame. `busy()` for listen-before-talk. |
| Error correction | `src/rs.ts`, `src/conv.ts` | Reed-Solomon over GF(256), 16 or 32 parity bytes per preset: fixes 8/16 unknown bad bytes, or 16/32 the receiver flags as low-confidence (erasures), plus Chase-style runner-up retries. `robust` adds a soft-decision convolutional inner code (K=7, soft Viterbi) over Gray-mapped tones. |
| libp2p service | `src/protocol.ts` | Signed envelopes, plus the `audio(link)` service: peer discovery, `say`, `broadcast`, `publish`, repeaters, `challenge()`, replay protection. |
| Link layer | `src/link.ts` | Reliable byte pipes between two peers in a shared half-duplex room: 7-byte header, selective-repeat ARQ with ack bitmap, bursts that end with an "over" so the peer takes the turn, silence when idle. |
| Transport | `src/transport.ts` | The `/audio` js-libp2p `Transport`: MultiaddrConnections on link pipes, stock or lean upgrade. `AUDIO_DEFAULTS` turns off libp2p's network-speed timeouts and connection monitor. |
| Lean handshake | `src/handshake.ts` | Signed ephemeral X25519 handshake (134 + 96 bytes), HKDF keys, ChaCha20-Poly1305 or HMAC-only records. Reviewed: [`notes/lean-transport-review.md`](notes/lean-transport-review.md). |
| Muxer | `src/mux.ts` | `audiomux`: 3-byte records, protocol pre-negotiated by index in the OPEN record. |
| Pubsub bridge | `src/bridge.ts` | Room ↔ topic relay; loop-free thanks to the per-sender replay window. Tested with floodsub (gossipsub 14 still targets libp2p 2). |
| Content | `src/content.ts` | `ContentPointer` (CBOR), deflate, CIDv1 raw sha2-256 (same CID as `ipfs add --cid-version 1 --raw-leaves` for a small file), verification. |
| Fountain code | `src/broadcast.ts` | Random linear network coding over GF(256) for looping broadcasts and content. |
| Browser I/O | `src/browser.ts` | Speaker out and mic in (voice processing off) as an `AudioLink`, with listen-before-talk. |

The tones sit inside the 300–3000 Hz voice band, so the same audio should pass through a handheld radio's audio path. `AudioLink` is just `send(bytes)` / `onFrame(cb)`, so a radio, a sound card, or a file can replace the browser link.

### Sound presets

Pick one in the demo's **Sound** menu (or `?preset=` in the URL). Both devices must match.

| Preset | Tones | Sounds like | Use for |
|---|---|---|---|
| `voice` (default) | 1000–2567 Hz, 3 rotating tone sets, 32 parity | beeps | radios (fits the 300–3000 Hz voice band), noisy rooms; 8.8 B/s, 77/87% in reverb |
| `chime` | C major pentatonic, C5–C8, plucked notes, 60 ms | a music box | demos, places where beeps annoy people |
| `ultrasonic` | 17.5–19 kHz | near silence for most adults | short range; **Hide in music** mixes it under any audio file you pick |
| `fast` | 1000–4000 Hz, 3 rotating tone sets, 20 ms symbols, 32 parity | faster beeps | 17.5 B/s (2x voice); 100% at -6 dB SNR, 83/100% in reverb, 80% in an equal-power collision; speakers and phones, not radios |
| `dual` | two tones at once, 1000–4000 + 4300–7300 Hz, rotating sets, 20 ms symbols, 32 parity | denser beeps | a byte per symbol: 33 B/s (3.8x voice); 100% at -6 dB SNR, 80/100% in reverb, 70% in a collision; speakers and phones |
| `tri` | three bands at once, 900–8225 Hz, rotating sets, 20 ms symbols, 32 parity | dense chatter | 12 bits per symbol: 48 B/s (5.5x voice); 93% at -6 dB SNR, 87/100% in reverb, 73% in a collision, 100% on 0.3 s dropouts; inside a phone speaker's band |
| `turbo` | dual tones, 1000–9400 Hz, rotating sets, 10 ms symbols, 32 parity | fast chatter | 67 B/s (7.6x voice); 100% to 0 dB SNR, 97/100% in reverb, 100% on 0.3 s dropouts; short range |
| `robust` | voice band with rotating sets, 40 ms symbols, soft-decision convolutional inner code (K=7, rate 2/3) + 32 parity | beeps | the busy-room and radio preset: 6 B/s; 97% in an equal-power collision, 100% at -6 dB SNR and on every dropout row, 90/100% in reverb |
| `hidden` | 4000–7200 Hz, rotating sets, 30 ms symbols, 32 parity | faint texture | data under a jingle (the fallback where ultrasound doesn't pass): 11.7 B/s, 78/92% in reverb, 90% in a collision ([under a jingle](benchmarks/JINGLE.md)) |
| `music` | 7th-chord tones over 4 octaves, chord changes every 8 notes (I–V–vi–IV), plucked | an arpeggiator | demos; best preset in reverb (95% at RT60 0.3 s, 78% at 0.8 s) and collisions (93%); 6.5 B/s; listen: `benchmarks/sounds/music.wav` |

In code: `browserAudioLink({ chime: PRESETS.chime })` (several entries = hear them all, send on any), `new Demodulator(rate, cb, PRESETS.chime)`, or pass your own `tones` (16 frequencies).

Speed is a tuning knob: `symbolSeconds` (default `0.04`). Shorter is faster but more fragile in echoey rooms. Both sides must use the same value.

```ts
import { createLibp2p } from 'libp2p'
import { audio } from './src/protocol.ts'
import { audioTransport, AUDIO_DEFAULTS } from './src/transport.ts'
import { browserAudioLink } from './src/browser.ts'
import { PRESETS } from './src/modem.ts'

const link = await browserAudioLink({ fast: PRESETS.fast, voice: PRESETS.voice }) // dials try fast, fall back to voice
const node = await createLibp2p({
  ...AUDIO_DEFAULTS,
  addresses: { listen: ['/audio/voice'] },
  transports: [audioTransport(link, { handshake: 'lean' })], // encrypt: false for ham bands
  services: { audio: audio(link) }
})
node.addEventListener('peer:discovery', async e => {
  const conn = await node.dial(e.detail.id) // over sound, via the heard /audio address
  const stream = await conn.newStream('/chat/1.0.0')
  stream.send(new TextEncoder().encode('hello'))
})
await node.services.audio.announce()
await node.services.audio.say('meet at the north gate')
await node.services.audio.publish(noticeBytes, { name: 'flood', headline: 'Boil water', validFor: 86_400 })
```

## Scorecard

`npm run scorecard` scores every preset in simulation, so changes are compared on numbers instead of guesses. Headline (50 trials, [full table](benchmarks/RESULTS.md)): every preset decodes 100% through 0 dB in-band SNR and through a 0.3 s dropout anywhere in the frame; reverb at RT60 0.3/0.8 s: voice 86/78%, fast 82/96%, dual 84/100%, tri 92/98%, turbo 92/98%, music 96/76%; an equal-power collision: voice 90%, fast 92%, dual 84%, tri 72%, turbo 68%, robust 96%. Throughput: voice 8.8, fast 17.5, dual 33, tri 48, turbo 67 B/s; robust 6.

- conditions: in-band SNR, room reverb, a handheld radio chain, clock drift, collisions, dropouts by frame position, late join for looping broadcasts, and CPU per audio second

`benchmarks/BASELINE.md` is the starting point; `benchmarks/RESULTS.md` is the current state (seed 1, 100 trials per cell, Wilson 95% intervals). Regenerate with `npm run scorecard -- --out benchmarks/RESULTS.md`; `--only reverb` and `--preset voice` help while iterating.

## Tests

```sh
npm test        # node --test; no browser needed
npm run typecheck
```

- `test/modem.test.ts`: back-to-back frames on one noisy stream, echo, clock drift, 44.1k ↔ 48k mismatch, no false positives on noise, a frame recovered from its tail after its start was lost.
- `test/libp2p.test.ts`: two real libp2p nodes in a simulated room. B hears A's PeerRecord over audio, discovers it, **dials it over TCP using the heard address**, then they exchange a verified message. Tampered frames are rejected.
- `test/transport.test.ts`: the link layer moves 1 KB each way under 20% frame loss; two libp2p nodes connect **over audio** (stock Noise + yamux, lean encrypted, lean sign-only), ping, echo on a stream, with the airtime to the first byte printed for each.
- `test/collisions.test.ts`: two connections dialed at once in a room with real overlapping audio and a mocked clock (`test/room-time.ts`): without carrier sense nothing completes; with listen-before-talk and responder priority both do with no overlapping frames.
- `test/handshake.test.ts`, `test/content.test.ts`, `test/replay.test.ts`, `test/bridge.test.ts`: the attacks in the threat model, and the pubsub bridge.

Also verified by hand, over the air across two devices: a Chrome page playing through the laptop speaker, and a second page listening on an iPhone's microphone (via Continuity). The listener discovered the sender's PeerId and received its signed message.

## Roadmap

- [x] Data over audio between devices (modem + error correction)
- [x] Signed libp2p messages over audio
- [x] Audio libp2p peer discovery (PeerRecord broadcast → `peer:discovery` → dial)
- [x] A real libp2p transport over audio, encrypted or sign-only
- [x] Content broadcast by CID with verified repeaters
- [ ] Through real radios (ham / FRS / FM; see [meshkit](https://www.meshkit.org/)): test the audio path, tune `symbolSeconds`
- [ ] Multiple speakers at once: room-level scheduling, measured under real overlap
- [ ] Steganography: data hidden in other audio

Details and status: [`docs/roadmap.md`](docs/roadmap.md).

Notes from LabWeek 2023 are in [`notes/`](notes/LabWeek23.md).
