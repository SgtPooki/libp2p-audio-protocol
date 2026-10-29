# Use cases to explore

Things that are easier, more fun, or more provable because the medium is sound. Each entry says what already works, what is missing, and the catch. Numbers are from `benchmarks/RESULTS.md` and `benchmarks/OVER-THE-AIR.md` (voice preset 10 B/s at 40 ms symbols; ultrasonic at 20 ms symbols is 2x faster on a laptop, untested on phones).

## 1. Audio QR: a presenter sends a link to a whole room

A presenter tells the room "turn your volume down, open this page, allow the microphone", then pushes a URL (or any short message) to every phone at once. Like a QR code, but it reaches people who can't see the screen, works across a big hall through the PA, and arrives signed by the presenter's key.

- **Works today:** `say('https://example.com/talk')` is one signed frame: about 12 s on `voice`, about 5 s on `ultrasonic` at 20 ms. Every listening page shows it with the sender's PeerId and `✔ signed`. `broadcast()` loops it as fountain chunks for people who open the page late.
- **Missing:** a presenter page (type a URL, one big button, keep looping, count replies) and a receiver page that shows the link as a tappable card and nothing else. Receivers could answer with a tiny signed "got it" so the presenter sees a live count (one frame each; with 50 phones that needs listen-before-talk and random backoff, both in the browser link now).
- **Catch:** the PA's frequency response and room reverb: the scorecard's RT60 0.8 s row is ~55%, so loop it. Phones need the page open and the mic allowed; iOS Safari needs a real certificate.

### 1b. Party games and second screens: the TV announces the join link

Jackbox-style games make every player scan a QR code or type a 4-letter room code. If the game (or any TV app, smart speaker, or conference-room screen) plays the join link as sound, every phone with the companion page open joins at once, including people who can't see the screen. The same library serves a web app's "announce this link" button and a receiver page.

- **Works today:** a signed URL in one frame (section 1). A room code is 4-8 bytes: a frame that short is ~3 s on `voice`, ~1.3 s on `ultrasonic` at 20 ms.
- **Missing:** a small npm package: `announce(url)` for the host (speaker only, loops until stopped) and `listen(cb)` for the guests (mic only), no libp2p node needed for the simplest version; a demo game lobby; a decision on whether to sign (the host's PeerId makes the link spoof-proof, which a QR code is not) or send unsigned for speed.
- **Catch:** TV speakers and sound bars often cut above ~15 kHz, so the audible `voice`/`chime` presets are the ones to count on; phones must have the page open and the mic allowed, so the first join is still a URL or app, and sound replaces every join after that.

## 2. Event presence: prove you were in the room

A venue plays a signed challenge from a loudspeaker. Phones that hear it reply with a signed message carrying the nonce, so the organizer has a list of PeerIds that were in earshot at that time. Unlike a QR code or a Wi-Fi check-in, the proof can't be forwarded as a screenshot and can't be scanned from outside the door.

- **Works today:** `challenge()` + `say()` already produce `present` (threat T3), and an open connection's handshake is a mutual, replay-proof proof of presence.
- **Missing:** a check-in page; a way for the organizer to publish its PeerId beforehand (poster, ticket, website) so attendees know who asked; many simultaneous replies (a reply slot scheme: each phone waits a random slot, 60-byte reply frames are ~7 s, so a few hundred phones need minutes or several tone bands).
- **Catch:** a live relay (someone on a phone call streaming the room audio) defeats any acoustic proof; a recording does not. Acoustic distance bounding (speed of sound) is an idea only, see `notes/two-way-transport.md`.
- **Variants:** a raffle (first N verified replies), proof of attendance tokens signed by the venue key in response to each reply, a silent roll-call in a classroom.

## 3. Disaster notices with repeaters

The original use case: a county key publishes a notice as a CID; anyone who verified it can opt in as a repeater and extend the range. See `notes/content-broadcast.md` and `benchmarks/REPEATERS.md`: 3 repeaters take a 2 KB notice from 7 of 20 listeners to all 20.

- **Missing:** publishing the official key offline (printed on a poster), priority generations (headline first), CAR export so the content verifies in kubo.

## 4. Pairing without a network

Two devices in the same room open a libp2p connection by sound (35 s phone to laptop today), exchange keys or Wi-Fi credentials, then switch to a fast transport. Being in earshot is the authorization: no codes to type, no Bluetooth pairing UI.

- **Works today:** `node.dial(heardPeer)` over `/audio`, encrypted.
- **Missing:** a "pair" protocol that hands over a Wi-Fi/WebRTC address and dials it, and a UI that explains the wait.

## 5. Radios and PA systems

Walkie-talkies, FRS/GMRS, ham (sign-only mode), the PA at a stadium, FM broadcast. The `voice` preset fits the 300-3000 Hz voice path (scorecard radio row 100%). Open: a real radio test, tuning `symbolSeconds`, legal review of data on FRS/GMRS. See `docs/roadmap.md` section 3.

## 6. In the home: a "same room" primitive for devices

Indoors, Wi-Fi, BLE and Zigbee win on bandwidth. What they can't do is tell *which room* a device is in, or reach a device that has no radio or isn't paired yet. Sound stops at walls and needs no pairing, so it is a natural same-room primitive. At 10-70 B/s it is a control plane and a bootstrap channel, not a data plane.

| Use | How | What exists today |
|---|---|---|
| **Commissioning without radios** | A new device with a mic (a Pi, an ESP32 with an I2S mic, an appliance) hears its Wi-Fi credentials or a Zigbee/Thread network key from a phone's speaker, signed by the owner's key. No pairing mode, no QR code, no vendor app. Matter uses a QR/numeric code for exactly this step; sound is the accessible version, and the one that works for a device with no screen and no camera. | Signed messages (`say`), a signed handshake for a two-way exchange (`/audio` transport); a Node/ESP listener is a port of `Demodulator` |
| **Room-scoped control and presence** | "Lights off" from a phone reaches only what heard it in this room. A hub with a speaker announces a signed "I am the living-room hub" so devices learn their room without a site survey. Zigbee knows the network, not the room. | `announce`/`listen` (Audio QR), `challenge` → `present` |
| **Bridging isolated networks** | A guest-network phone and a device on the IoT VLAN exchange a signed message through the air; no firewall rule is involved. A doorbell, an intercom, handing a visitor a local link. | Any signed frame; the pubsub bridge pattern (`src/bridge.ts`) with a radio instead of a topic |
| **Zero-infrastructure sensors** | A smoke / CO / water / door sensor with a piezo chirps a signed status (ultrasonic, inaudible) to whatever is listening: a phone, a hub. It never associates with anything, so the battery lasts years and there is nothing to configure. | Pointer/message formats; `busy()` to wait for a quiet moment |
| **Devices that already have speakers** | TV, smart speaker, thermostat, washing machine, printer: each can broadcast a signed status or a link ("cycle done, here is the log") to whatever is in earshot, no account or cloud needed. | Audio QR |
| **Audio in, radio out** | A hub with a mic and a Zigbee / Thread / Meshtastic dongle hears a signed envelope and republishes it on the mesh, and announces mesh events into a room by sound. A piezo-only sensor reaches the whole house. The novel part: Zigbee's weak spots are commissioning and trust (install codes); a signed audio envelope at install time solves both. | `src/bridge.ts` does this for pubsub; a dongle adapter is the same `send`/`onFrame` shape (`notes/use-cases.md`, LoRa section) |

**Quiet rooms are a schedule, not a blocker.** Every home is quiet at some hour of a 24-hour day. A sensor or a hub doesn't need the room to be quiet now: `Demodulator.busy()` already senses a busy band, so a device can hold its hourly status until the room is quiet, and a hub can run its "who's here / what's new" sweep at 3 am. Ultrasonic adds the daytime option where speakers and mics allow it (phones do; TVs mostly don't).

**What would make these real**: a listener for a microcontroller (the demodulator is ~300 lines of plain arithmetic; a C port for an ESP32 is the test), a `commission(deviceKey, credentials)` message type with a threat-model entry, and a Zigbee dongle adapter in the bridge shape.

## 7. Smaller ideas

- **Audio business card:** announce your PeerRecord once; the other phone has your addresses and can reach you later over the internet.
- **Signed "now playing" / set-list from a DJ booth**, or a venue broadcasting a signed schedule change to everyone present.
- **Classroom or museum guide:** a looping fountain broadcast of a page of text; walk in at any time and get it.
- **Hidden in music:** the `ultrasonic` preset under a track; the audience's phones get the link without hearing beeps (phone hardware untested).
- **Cross-device proof of co-location** for two people (both heard the same challenge from a third device).
- **Accessibility:** a screen reader gets the link as text; no camera needed, no pointing at a code.
- **Meshtastic / LoRa gateway:** a phone hears a frame and forwards it on LoRa, and back; frames fit a Meshtastic packet.

## What would make these easy to build

- A tiny receiver-only page (`examples/listen`) and a presenter page (`examples/presenter`): no chat, one job each.
- A "reply slot" helper in the service for many-to-one replies (random slot, listen-before-talk, dedupe).
- A faster default preset that phones handle (25 ms symbols, or ultrasonic once verified on phones), since every use case above is bounded by seconds per frame.

## Questions asked on 2026-10-28, with current answers

**Proof of hearing (the "inverse").** Hashing a recording can't work: two microphones never produce the same bytes. The provable version is what exists: the sound carries a signed nonce and the listener signs it back (`challenge` → `present`), or the connection handshake. "Everyone heard the same notice" = the announcer publishes the CID, listeners ack with the nonce. Fuzzy audio fingerprints of the venue's sound, signed and broadcast for phones to compare, is a research idea, not a build.

**Meshkit / LoRa.** Not supported as written, but the modem is the only audio-specific layer: `link.ts`, `transport.ts`, envelopes, chunks and pointers only need `send(bytes)` / `onFrame(cb)`. Missing: a `meshtasticLink` on a Meshtastic private app port via `@meshtastic/js` (frames ≤ 235 B; the 233 B payload limit is to verify), ARQ timers sized for LoRa airtime, duty-cycle limits where they apply, and hardware to test. A gateway is the same piece plus forwarding.

**Performance, ranked.** Fold the handshake into SYN/SYN-ACK (6 → 4 frames); try 25 ms symbols on the phone (40 ms is the only tested phone speed); 32 tones (+25%) or two simultaneous tones (+70%, weaker in reverb); a short control-frame format for acks and pings; measure and trim turnaround (phone connection: 35 s for ~25 s of airtime).

**At home without Wi-Fi.** Wi-Fi and BLE win on speed. Sound is the better tool for bootstrapping (credentials or a peer address by sound, no pairing UI), devices with a mic but no radio, crossing network boundaries (guest network, VLANs), a TV or smart speaker announcing a link to every phone in the room, and accessibility.

**Disaster recovery next.** Publish the official key offline (poster/QR with the PeerId); headline-first priority generations; listeners serve verified content over local Wi-Fi and export CARs; NEED repair when a back channel exists; a real test through two handheld radios.

**Preset ladder (fast first, slow fallback).** Bandwidth is not speed by itself: bit rate = bits per symbol / symbol time, and tone spacing must be at least 1 / symbol time. A wide preset (say 200 Hz spacing up to 19 kHz) allows 10 ms symbols (~4x today) or 64 tones (6 bits/symbol); `voice` at 40 ms is the floor that TVs, PAs and FM radios pass. Receivers can run two or three demodulators at once (1.4-5 ms CPU per audio second each). One-way: the host alternates presets in its loop, listeners decode whichever they hear, optionally replying "heard you on X". Connections: dial on the fastest preset, fall back on SYN timeout, remember what worked per peer. To build: the wide preset plus a scorecard column for it, multi-preset `browserAudioLink`, and the fallback in `audioTransport.dial`.

**Mesh radio payload limits (hardware research, 2026-10-28).** Meshtastic `DATA_PAYLOAD_LEN` is 233 bytes; MeshCore's raw packet payload is 184 bytes and its companion-protocol channel data 165 bytes. Our modem frame can be up to 235 bytes, but nothing requires it: `MAX_PAYLOAD` is the RS(255) ceiling, and every producer already takes a size (`segment` in the link, `blockSize` for chunks; PeerRecords are ~212 B with one address, pointers ~196 B, messages ~110 B + text). So Meshtastic needs no fragmentation adapter, only a per-link `maxFrame` (233) that the link segment, chunk size and `announce()` address trimming respect. MeshCore at 165 B does need either fragmentation in the adapter or smaller pointers (drop the headline, 36-byte CID is fixed). In both systems the radio is a packet transport with its own forwarding, not a byte stream: the adapter is `send(frame)` / `onFrame(cb)` on a private app port, and ARQ timers must be set for LoRa airtime. FRS/GMRS: FCC rules limit digital transmissions to specific uses, 1 s long, normally once per 30 s, so arbitrary libp2p traffic is out; amateur radio (sign-only mode) is the route for audio-modem experiments through real radios.
