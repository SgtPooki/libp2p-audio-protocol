# Over-the-air results

Real speakers and microphones, as opposed to the simulated [scorecard](RESULTS.md). Reproduce the benchmarks with `npm run demo` running and `node bench/over-the-air.mjs` (see the script header for options).

## Two devices (2026-10-28)

Demo page (`examples/phone-laptop-chat`) on a MacBook Pro (Chrome) and an iPhone (Brave), voice preset, devices on a desk, Wi-Fi only used to load the page.

| Direction | Result |
|---|---|
| Laptop → phone | Phone logged `discovered peer 12D3KooWCQN95…XCjYvw ✔ signature verified` (the laptop's PeerId) |
| Phone → laptop | Laptop discovered the phone's PeerId (`12D3KooWEBV3nu4r…jXZZ`, verified) on the second try, then received the signed message "Yooooo whatsup" |
| iPhone Safari | Start button fails with `NotAllowedError` from `getUserMedia`; likely the self-signed certificate. Brave works. Retest once the demo is hosted with a real certificate. |

Also verified, laptop only: two Chrome windows, speaker → built-in mic. Discovery, signed messages, presence challenge (`🙋 present`), and a fountain-coded Loop broadcast decoded once.

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
