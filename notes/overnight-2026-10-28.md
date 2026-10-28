# What changed overnight (2026-10-28 → 29)

Everything below is on `main`, tested (`npm test`: 52 passing), and most of it is measured. Try it first: **https://sgtpooki.github.io/libp2p-audio-protocol/** on your phone (real certificate, Safari works now).

## Try these in the morning

1. **Audio QR** (`/announce/`): laptop as host (`?mode=host`), phone as guest. Tick `music` on the host to hear the link as an arpeggio. Over the air on the laptop: unsigned link in 4.8 s (ultrasonic), signed in 15 s.
2. **Check-in by sound** (`/checkin/`): laptop host taps "Ask who's here", phone answers by itself; the host lists verified keys. Two guest windows checked in 46 s over the air.
3. **Chat** (`/chat/`): the dial now tries the `fast` preset first (20 ms symbols, 2x) and falls back to the one you picked. Whether an iPhone speaker/mic handles `fast` is the open question; the log line `preset …` on "connection outbound" tells you which one won. `?ladder=0` turns it off.
4. Listen to `benchmarks/sounds/music.wav` vs `chime.wav`.

## Numbers

| What | Before | After |
|---|---|---|
| Lean connection, simulated time to first echoed byte | 6 frames, 48.5 s | **4 frames, 41.9 s** (handshake rides in SYN/SYN-ACK); **19.8 s** when `fast` carries it |
| Lean connection over the air, laptop, ultrasonic 20 ms | 16 s | **14 s** |
| Two connections dialed at once in one room (new timed room, 3 seeds) | unmeasured | no carrier sense 0/2; listen-before-talk 2/2; + responder priority 2/2 with **0 overlapping frames** |
| `fast` preset | – | 19.4 B/s, 100% to 0 dB SNR, 100% on sync/header loss |
| `music` preset | – | 6.5 B/s, **95% at RT60 0.3 s, 78% at 0.8 s** (best preset in reverb), 93% in an equal-power collision |
| Audio QR over the air | – | 4.8 s to a link (unsigned, ultrasonic) |
| Check-in over the air | – | 2/2 verified in 46 s |

## New pieces

- `src/announce.ts`: `announce(url, { presets, key })` / `listen(cb)`: speaker-only host, mic-only guest, guests decode four presets at once. `examples/announce`.
- `examples/checkin`: presence proof as a product: host challenge, random-delay signed replies, JSON export.
- `src/bridge.ts`: audio ↔ pubsub. A message said in the room is republished on a topic with its original signature; signed envelopes from the topic are played into the room. Loop-free via the replay window; bounded airtime; plain-text re-signing is opt-in. Tested with floodsub (gossipsub 14 still targets libp2p 2).
- Preset ladder: `AudioLink` carries a preset per frame, `browserAudioLink({ fast, voice })` hears both, the link's SYN ladder tries fast first, the listener answers on what it heard.
- `music` preset: per-bar tone sets (Cmaj7, G7, Am7, Fmaj7), plucked; sync and header on a fixed set so tail recovery still works.
- `test/room-time.ts`: a room with real overlapping audio and a mocked clock; `test/collisions.test.ts` uses it.
- `.github/workflows/pages.yml`: the demos deploy on every push.
- `AudioLink.maxFrame`: packet radios (Meshtastic 233 B) cap frames without a fragment layer.

## Reviews and fixes

Codex reviewed tonight's transport changes (`notes/lean-transport-review.md`, second section): 7 findings, all fixed (bridge backpressure and crash, SYN-ACK on a rejected connection, ladder preset pinning, SYN timer starting before the SYN had played, plain-text re-signing, music frames outliving the receive buffer). The timed room independently caught the SYN-timer bug.

## Not done / needs you

- Phone on `fast` and `ultrasonic`: only the voice preset is proven on the iPhone.
- The `music` preset as the default needs a listening test (it is not radio-safe: notes go to 4.2 kHz).
- LoRa: the research prompt is in `notes/hardware-research-prompt.md`; a `meshtasticLink` is ~100 lines once there is hardware.
