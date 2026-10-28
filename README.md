# libp2p-audio-protocol

libp2p over sound. Peers announce themselves and send short signed messages as audio tones, so two devices can find and verify each other with no network at all: through the air, over a loudspeaker, or through a walkie-talkie / FM radio.

Every frame on air is a standard [libp2p signed envelope](https://github.com/libp2p/specs/blob/master/RFC/0002-signed-envelopes.md). A listener can verify which PeerId sent it. Frames are plaintext and not yet replay-protected; see the [threat model](docs/threat-model.md).

- **Peer discovery**: a signed libp2p `PeerRecord` (PeerId + multiaddrs). The `audio()` service is a libp2p `PeerDiscovery` module, so heard peers show up as `peer:discovery` events and can be dialed over any normal transport.
- **Messages**: short signed text (`AudioMessage`, domain `libp2p-audio-message`).

## Demo: phone ↔ laptop (`examples/phone-laptop-chat`)

```sh
npm install
npm run demo
```

1. On the laptop, open `https://localhost:5173`. On the phone (same Wi-Fi, only needed to load the page), open the `Network:` URL that Vite prints, e.g. `https://192.168.x.x:5173`. Accept the self-signed certificate warning. Browsers only allow microphone access over https.
2. Tap **Start listening** on both and allow the microphone.
3. Turn the volume up and put the devices near each other. Tap **📡 Announce me** on one device. After about 10 seconds of tones, the other device shows `discovered peer 12D3Koo… ✔ signature verified`.
4. Type a message and **Send**. It arrives tagged with the sender's PeerId and `✔ signed`.

Once the page has loaded, you can turn off Wi-Fi. Everything after that goes over sound.

Tips: on macOS, set Control Center → Mic Mode to **Standard** (Voice Isolation suppresses tones). Keep the room fairly quiet. The mic level bar should jump while the other device transmits.

## How it works

| Layer | File | What |
|---|---|---|
| Modem | `src/modem.ts` | MFSK-16: one of 16 tones per 40 ms symbol = 100 bit/s. Preamble for sync, length header, CRC-32, Reed-Solomon body. Max 235 bytes per frame. |
| Error correction | `src/rs.ts` | Reed-Solomon over GF(256), 16 parity bytes. Fixes 8 unknown bad bytes, or up to 16 the receiver flags as low-confidence (erasures), so a ~1 s dropout doesn't lose the frame. |
| libp2p | `src/protocol.ts` | Signed envelopes, plus the `audio(link)` libp2p service (peer discovery + `say(text)`). |
| Browser I/O | `src/browser.ts` | Speaker out and mic in (voice processing off) as an `AudioLink`. |

The tones sit inside the 300–3000 Hz voice band, so the same audio should pass through a handheld radio's audio path. `AudioLink` is just `send(bytes)` / `onFrame(cb)`, so a radio, a sound card, or a file can replace the browser link.

### Sound presets

Pick one in the demo's **Sound** menu (or `?preset=` in the URL). Both devices must match.

| Preset | Tones | Sounds like | Use for |
|---|---|---|---|
| `voice` (default) | 1000–2500 Hz, 100 Hz apart | beeps | radios (fits the 300–3000 Hz voice band), noisy rooms |
| `chime` | C major pentatonic, C5–C8, plucked notes, 60 ms | a music box | demos, places where beeps annoy people |
| `ultrasonic` | 17.5–19 kHz | near silence for most adults | short range; **Hide in music** mixes it under any audio file you pick |

In code: `browserAudioLink(PRESETS.chime)`, `new Demodulator(rate, cb, PRESETS.chime)`, or pass your own `tones` (16 frequencies).

Speed is a tuning knob: `symbolSeconds` (default `0.04`). Shorter is faster but more fragile in echoey rooms. Both sides must use the same value.

```ts
import { createLibp2p } from 'libp2p'
import { audio } from './src/protocol.ts'
import { browserAudioLink } from './src/browser.ts'

const node = await createLibp2p({ services: { audio: audio(await browserAudioLink()) } })
node.addEventListener('peer:discovery', e => console.log('heard', e.detail.id.toString()))
await node.services.audio.announce()
await node.services.audio.say('meet at the north gate')
```

## Scorecard

`npm run scorecard` scores each preset in simulation. Use it to compare changes instead of guessing:

- **bytes/s**: payload throughput for a 117-byte signed message
- **min SNR**: lowest signal-to-noise ratio (white noise, full band) at which at least 9 of 10 frames decode
- **drop**: frames that survive losing a 0.1 s, 0.3 s, or 1 s chunk of audio

## Tests

```sh
npm test        # node --test; no browser needed
npm run typecheck
```

- `test/modem.test.ts`: back-to-back frames on one noisy stream, echo, clock drift, 44.1k ↔ 48k mismatch, no false positives on noise.
- `test/libp2p.test.ts`: two real libp2p nodes in a simulated room. B hears A's PeerRecord over audio, discovers it, **dials it over TCP using the heard address**, then they exchange a verified message. Tampered frames are rejected.

Also verified by hand, over the air across two devices: a Chrome page playing through the laptop speaker, and a second page listening on an iPhone's microphone (via Continuity). The listener discovered the sender's PeerId and received its signed message.

## Roadmap

- [x] Data over audio between devices (modem + error correction)
- [x] Signed libp2p messages over audio
- [x] Audio libp2p peer discovery (PeerRecord broadcast → `peer:discovery` → dial)
- [ ] Broadcast CIDs: a signed "fetch this CID" announcement for emergency broadcasts
- [ ] Through real radios (ham / FRS / FM; see [meshkit](https://www.meshkit.org/)): test the audio path, tune `symbolSeconds`
- [ ] Multiple speakers at once (frequency bands per peer?)
- [ ] Steganography: data hidden in other audio
- [ ] Re-broadcast: peers append what they heard and relay it

Notes from LabWeek 2023 are in [`notes/`](notes/LabWeek23.md).
