# Over-the-air results

Real speakers and microphones, as opposed to the simulated [scorecard](RESULTS.md). Reproduce the benchmarks with `npm run demo` running and `node benchmarks/over-the-air.mjs` (see the script header for options).

## Two devices (2026-10-28)

Demo page (`examples/phone-laptop-chat`) on a MacBook Pro (Chrome) and an iPhone (Brave), voice preset, devices on a desk, Wi-Fi only used to load the page.

| Direction | Result |
|---|---|
| Laptop → phone | Phone logged `discovered peer 12D3KooWCQN95…XCjYvw ✔ signature verified` (the laptop's PeerId) |
| Phone → laptop | Laptop discovered the phone's PeerId (`12D3KooWEBV3nu4r…jXZZ`, verified) on the second try, then received the signed message "Yooooo whatsup" |
| iPhone Safari | Start button fails with `NotAllowedError` from `getUserMedia`; likely the self-signed certificate. Brave works. Retest once the demo is hosted with a real certificate. |

Also verified, laptop only: two Chrome windows, speaker → built-in mic. Discovery, signed messages, presence challenge (`🙋 present`), and a fountain-coded Loop broadcast decoded once.

## libp2p connection over sound (2026-10-28)

Two Chrome windows on the MacBook Pro, speaker → built-in mic, run by `node benchmarks/over-the-air-connect.mjs 'preset=ultrasonic&symbolSeconds=0.02'` with `npm run demo` up. Page A announces its PeerRecord; page B discovers it, dials `/audio/ultrasonic/p2p/<A>`, opens a `/chat/1.0.0` stream and pings.

| Step | Wall clock |
|---|---|
| B discovers A (one 212-byte PeerRecord frame) | 10 s |
| B dials A: SYN, SYN-ACK, handshake msg1 (134 B), msg2 (96 B), connection open | **16 s** |
| libp2p ping round trip over the connection | 10.7 s |
| Chat message sent on the encrypted stream, shown on A | 41 s after start |

Lean handshake (transport-owned signed handshake + audiomux), encrypted. Later the same day, with the handshake folded into the SYN and SYN-ACK (4 frames instead of 6): **connected in 14 s**, same setup (`preset=ultrasonic&symbolSeconds=0.02&ladder=0`). The same run with the voice preset at 40 ms symbols and the stock Noise + yamux upgrade (~1 KB on air, 11 frames) did not complete in the first attempt: libp2p's 10 s dial timeout and its connection monitor (ping every 10 s, 5 s timeout) both killed it; `AUDIO_DEFAULTS` in `src/transport.ts` now turns those off. In simulation the stock path is 102.6 s of airtime at 10 B/s versus 43.7 s lean (`npm test`, `test/transport.test.ts`).

### Phone ↔ laptop (2026-10-28, 15:30)

iPhone (Brave) and MacBook Pro (Chrome) on a desk, voice preset, 40 ms symbols, lean handshake, by hand on the demo page.

| Step | Wall clock |
|---|---|
| Laptop announces; phone logs `heard peer record from 12D3KooWKKeZ…Rh8Wvd ✔ signature verified` | 20 s after the announce started (one 212-byte frame) |
| Phone dials: `connection outbound with …Rh8Wvd (native, /audiomux/1.0.0)`, `connected in 35 s` | **35 s** |
| Laptop: `connection inbound with …VwjXZZ (native, /audiomux/1.0.0)` | same |
| `ping 25.1 s round trip` (one 32-byte stream open each way at 10 B/s, plus turnarounds) | 25 s |
| A typed message sent over the encrypted stream, shown on the other device with 🔒 | worked |

This is the first libp2p connection between two different devices over sound. Found on the way: the demo's "Who's here?" did nothing once a connection was open, because replies go over the stream instead of as signed broadcasts; it now pings connected peers (an authenticated round trip is the presence proof), and inbound pings are logged.

## Audio QR (2026-10-28, evening)

`examples/announce`: a host window plays a link, a guest window listens on fast, voice and ultrasonic at once (`node benchmarks/over-the-air-announce.mjs ultrasonic`, laptop speaker → mic).

| Frame | Guest shows the link after |
|---|---|
| unsigned link (30 bytes), ultrasonic | **4.8 s** |
| signed link (libp2p envelope, ~140 bytes), ultrasonic | 15.2 s |

The fast and voice presets were not run on the laptop (audible); their simulated airtime for the unsigned link is 2.4 s and 4.6 s.

## Check-in by sound (2026-10-28, evening)

`examples/checkin`: a host window asks "who's here?" (one unsigned 9-byte challenge frame); guest windows answer with a signed message carrying the nonce after a random 1-21 s wait, with listen-before-talk. `node benchmarks/over-the-air-checkin.mjs ultrasonic 2`, laptop speaker → mic.

| | |
|---|---|
| 2 guests, ultrasonic | both verified present **46 s** after the question |

## Tune mode over the air (2026-10-29, evening): not yet

`tune` (the link as the arpeggiated accompaniment of Westminster Quarters / Beethoven's 5th, melody 6 dB above the data) decodes 100% in simulation at 16, 44.1 and 48 kHz, but two runs through the laptop speaker and mic (`node benchmarks/over-the-air-announce.mjs jingle:westminster:-6:tune jingle:beethoven5:-6:tune`) decoded nothing in 90 s each, signed or unsigned. Cause not isolated: suspects are the laptop speaker limiting on the loud bell peaks (the data is 6 dB below), the bells' own reverb on the data ladder, and the sync gate. `benchmarks/over-the-air-tap.mjs` (guest page with `?tap=1`) is meant to record what the mic hears for offline decoding, but the capture came back empty in this session; fix that first. Ultrasonic-under-jingle remains the proven audible-music mode.

## Fast presets over the air (2026-10-29, afternoon)

Two Chrome windows on the laptop, speaker → mic, lean connection, `node benchmarks/over-the-air-connect.mjs 'preset=<p>&ladder=0'`, after tone-set rotation, 32 parity and Chase retries landed.

| preset | PeerRecord discovered | connected | ping round trip |
|---|---|---|---|
| `dual` (33 B/s) | 5 s | 9 s | 8.0 s |
| `tri` (48 B/s) | 4 s | 6 s | 4.8 s |
| `turbo` (67 B/s) | 3 s | **5 s** | 4.9 s |

For scale: the first phone↔laptop connection (voice, 2026-10-28) took 35 s with a 25 s ping. Phones have not been tried on these presets yet; `tri` and `turbo` use tones up to 9-10 kHz.

## Phone-native ultrasonic (2026-10-29)

iPhone (Brave) ↔ MacBook Pro, `?preset=ultrasonic` on both, the hosted chat page: the phone **heard and transmitted ultrasonic successfully** in both directions. So the 0/5 "iPhone mic (Continuity)" column below was Continuity's compressed audio link, not the phone's hardware. Still open: 25 ms symbols and the `fast` preset on the phone.

## A link hidden under a jingle (2026-10-29)

Audio QR host playing Westminster Quarters (synthesized, `src/jingle.ts`) with the link mixed 18 dB under it, laptop speaker → mic, `node benchmarks/over-the-air-announce.mjs jingle:westminster:-18:ultrasonic`.

| Data band | Guest shows the link after |
|---|---|
| ultrasonic (all you hear is the bells) | **4.9 s** unsigned, 15.2 s signed |
| 4-7 kHz, ducked to the music's envelope, -18 dB | not decoded in 90 s (too weak through the laptop speaker and mic at that level; see `benchmarks/JINGLE.md` for the simulated margin) |

The 4-7 kHz band was also audible as faint beeps under the bells at -18 dB; ultrasonic is the default for the jingle mode, the 4-7 kHz band is the fallback for TVs and PAs that cut ultrasound and needs a louder setting.

## Benchmarks: laptop speaker → microphones

5 signed messages per row. "iPhone mic" is the iPhone's microphone used by the laptop through macOS Continuity, which streams it over a compressed link; that likely strips ultrasound and smears fast symbols, so the iPhone column is **not** a measure of the phone's own hardware.

| Config | Air time per message | MacBook mic | iPhone mic (Continuity) |
|---|---|---|---|
| voice, 40 ms symbols | ~12.7-13.6 s | 5/5 | 4/5 |
| chime | ~18.6 s | 5/5 | 4/5 |
| ultrasonic | ~13.1 s | 5/5 | 0/5 |
| voice, 30 ms | ~11.5 s | 5/5 | 0/5 |
| voice, 25 ms | ~9.8 s | 5/5 | 0/5 |
| voice, 20 ms | ~8.0 s | 5/5 | 0/5 |

The preset rows were run before erasure decoding and differential detection were added; the speed rows after erasure decoding.

Takeaways: speaker → mic on one laptop works at up to 2x the default speed and with ultrasonic. Whether phones do is still open: run the page on the phone itself with `?preset=ultrasonic` and `?symbolSeconds=0.025` on both devices.

## Lessons

- Headless Chrome plays no audio; over-the-air tests need visible windows.
- macOS: set Control Center → Mic Mode to Standard (Voice Isolation suppresses tones).
- Code edits under `src/` or `examples/` hot-reload the Vite demo and break a running benchmark; don't edit during a run.
- An earlier attempt to record with `ffmpeg` (avfoundation) dropped audio buffers, which looked like a modem bug. Record through the browser instead.
