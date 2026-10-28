# libp2p-audio-protocol

libp2p over sound. Peers find each other, open real libp2p connections, and broadcast signed content as audio tones, so devices can talk with no network at all: through the air, over a loudspeaker, or through a walkie-talkie / FM radio.

Every broadcast frame is a standard [libp2p signed envelope](https://github.com/libp2p/specs/blob/master/RFC/0002-signed-envelopes.md), so a listener can verify which PeerId sent it. Connections are encrypted by default, with a sign-only mode for ham bands. See the [threat model](docs/threat-model.md).

- **Peer discovery**: a signed libp2p `PeerRecord` (PeerId + multiaddrs, including `/audio/<preset>/p2p/<id>`). The `audio()` service is a libp2p `PeerDiscovery` module, so heard peers show up as `peer:discovery` events.
- **Transport**: `audioTransport(link)` is a js-libp2p transport. `node.dial('/audio/voice/p2p/12D3Koo…')` gives a normal `Connection` with streams and protocol handlers (ping, chat, anything). Selective-repeat ARQ, turn-taking and listen-before-talk underneath; keepalives off. Either the stock upgrade (Noise + yamux, ~1 KB on air) or the lean one: a signed one-round-trip handshake and a 1-byte-header muxer (~400 B; 16 s to a connection over the air, [measured](benchmarks/OVER-THE-AIR.md)).
- **Messages**: short signed text with a signed send time (`say`), or looped as fountain chunks (`broadcast`) so late listeners still get it.
- **Content broadcast**: `publish(bytes, { name, headline })` sends a signed `ContentPointer` (CID, size, expiry, headline) and the bytes as fountain chunks. Listeners verify what they rebuild against the CID. Opt-in **repeaters** re-send verified content from allowlisted publishers to extend the range ([simulated](benchmarks/REPEATERS.md)).
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

The host types a link and taps **Announce**; it plays as sound, alternating the `fast` and `voice` presets (and `ultrasonic` if ticked). Guests tap **Start listening** and get a tappable card for every link heard, with the preset it came on and, if the host signed it, the host's PeerId. 4.8 s to a link over the air with ultrasonic ([measured](benchmarks/OVER-THE-AIR.md)). In code: `announce(url, { presets, key })` and `listen(cb)` from `src/announce.ts`; no libp2p node needed.

## How it works

| Layer | File | What |
|---|---|---|
| Modem | `src/modem.ts` | MFSK-16: one of 16 tones per 40 ms symbol = 100 bit/s. Sync preamble, 3-copy length header with a vote, CRC-32, Reed-Solomon body, and a tail copy of sync + header so a frame whose start was lost is read backwards. Max 235 bytes per frame. `busy()` for listen-before-talk. |
| Error correction | `src/rs.ts` | Reed-Solomon over GF(256), 16 parity bytes. Fixes 8 unknown bad bytes, or up to 16 the receiver flags as low-confidence (erasures), so a ~1 s dropout doesn't lose the frame. |
| libp2p service | `src/protocol.ts` | Signed envelopes, plus the `audio(link)` service: peer discovery, `say`, `broadcast`, `publish`, repeaters, `challenge()`, replay protection. |
| Link layer | `src/link.ts` | Reliable byte pipes between two peers in a shared half-duplex room: 7-byte header, selective-repeat ARQ with ack bitmap, bursts that end with an "over" so the peer takes the turn, silence when idle. |
| Transport | `src/transport.ts` | The `/audio` js-libp2p `Transport`: MultiaddrConnections on link pipes, stock or lean upgrade. `AUDIO_DEFAULTS` turns off libp2p's network-speed timeouts and connection monitor. |
| Lean handshake | `src/handshake.ts` | Signed ephemeral X25519 handshake (134 + 96 bytes), HKDF keys, ChaCha20-Poly1305 or HMAC-only records. Reviewed: [`notes/lean-transport-review.md`](notes/lean-transport-review.md). |
| Muxer | `src/mux.ts` | `audiomux`: 3-byte records, protocol pre-negotiated by index in the OPEN record. |
| Content | `src/content.ts` | `ContentPointer` (CBOR), deflate, CIDv1 raw sha2-256 (same CID as `ipfs add --cid-version 1 --raw-leaves` for a small file), verification. |
| Fountain code | `src/broadcast.ts` | Random linear network coding over GF(256) for looping broadcasts and content. |
| Browser I/O | `src/browser.ts` | Speaker out and mic in (voice processing off) as an `AudioLink`, with listen-before-talk. |

The tones sit inside the 300–3000 Hz voice band, so the same audio should pass through a handheld radio's audio path. `AudioLink` is just `send(bytes)` / `onFrame(cb)`, so a radio, a sound card, or a file can replace the browser link.

### Sound presets

Pick one in the demo's **Sound** menu (or `?preset=` in the URL). Both devices must match.

| Preset | Tones | Sounds like | Use for |
|---|---|---|---|
| `voice` (default) | 1000–2500 Hz, 100 Hz apart | beeps | radios (fits the 300–3000 Hz voice band), noisy rooms |
| `chime` | C major pentatonic, C5–C8, plucked notes, 60 ms | a music box | demos, places where beeps annoy people |
| `ultrasonic` | 17.5–19 kHz | near silence for most adults | short range; **Hide in music** mixes it under any audio file you pick |
| `fast` | 1000–3250 Hz, 150 Hz apart, 20 ms symbols | faster beeps | 2x voice (19 B/s); speakers and phones, not radios |

In code: `browserAudioLink(PRESETS.chime)`, `new Demodulator(rate, cb, PRESETS.chime)`, or pass your own `tones` (16 frequencies).

Speed is a tuning knob: `symbolSeconds` (default `0.04`). Shorter is faster but more fragile in echoey rooms. Both sides must use the same value.

```ts
import { createLibp2p } from 'libp2p'
import { audio } from './src/protocol.ts'
import { audioTransport, AUDIO_DEFAULTS } from './src/transport.ts'
import { browserAudioLink } from './src/browser.ts'

const link = await browserAudioLink()
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

`npm run scorecard` scores each preset in simulation, so changes are compared on numbers instead of guesses:

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
- `test/handshake.test.ts`, `test/content.test.ts`, `test/replay.test.ts`: the attacks in the threat model.

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
