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

Lean handshake (transport-owned signed handshake + audiomux), encrypted. The same run with the voice preset at 40 ms symbols and the stock Noise + yamux upgrade (~1 KB on air, 11 frames) did not complete in the first attempt: libp2p's 10 s dial timeout and its connection monitor (ping every 10 s, 5 s timeout) both killed it; `AUDIO_DEFAULTS` in `src/transport.ts` now turns those off. In simulation the stock path is 102.6 s of airtime at 10 B/s versus 43.7 s lean (`npm test`, `test/transport.test.ts`).

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
