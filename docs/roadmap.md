# Roadmap and opportunities

The single place to track where libp2p-over-audio goes next. Status lives here; decisions and trade-offs that need more depth get their own doc. Current measured state: [`benchmarks/RESULTS.md`](../benchmarks/RESULTS.md). Security posture: [`threat-model.md`](threat-model.md). Overnight 2026-10-28 summary: [`notes/overnight-2026-10-28.md`](../notes/overnight-2026-10-28.md). Use cases to explore: [`notes/use-cases.md`](../notes/use-cases.md) (audio QR for presenters, event presence proofs, pairing, radios). Background research: [`notes/avenues.md`](../notes/avenues.md), [`notes/two-way-transport.md`](../notes/two-way-transport.md) (real libp2p connections over audio), [`notes/fec-and-coding.md`](../notes/fec-and-coding.md) (error correction and fountain codes in real radio systems), [`notes/content-broadcast.md`](../notes/content-broadcast.md) (broadcasting CID content with repeaters).

## Current goal

Agreed 2026-10-28, transport first so nothing gets built that can't work as a libp2p transport. Status as of the same evening:

1. **Real transport** — done. `src/link.ts` (selective-repeat ARQ, turn-taking, fragmentation, no keepalives), `src/transport.ts` (`/audio/<preset>/p2p/<id>`), stock upgrade and the lean one (`src/handshake.ts` signed handshake, `src/mux.ts` 1-byte-header muxer), encrypted by default with sign-only ham mode. Two js-libp2p nodes connect, ping and echo in the simulated room (`test/transport.test.ts`) and over the air (`benchmarks/OVER-THE-AIR.md`: 16 s to a connection, ultrasonic at 20 ms symbols). Time to first byte in simulation: stock 11 frames / 985 B / 108.7 s of airtime, lean 6 frames / 402 B / 48.5 s. Reviewed by Codex and Gemini: [`notes/lean-transport-review.md`](../notes/lean-transport-review.md) (14 findings, 11 fixed, 3 accepted with reasons). Plan it followed: [`notes/two-way-transport.md`](../notes/two-way-transport.md).
2. **Frame robustness** — done in the modem: tail copy of sync + header, 3-copy length vote, `busy()` for listen-before-talk. Scorecard ([`benchmarks/RESULTS.md`](../benchmarks/RESULTS.md)): sync-loss and header-loss rows 0% → 100% on all presets, collisions at 0 dB 60-67% → 72%, fountain late-join under noise bursts 40-45% → 55-62%, every other row within its interval. Cost: 0.48 s per frame and about 2x decoder CPU under hostile sync tones.
3. **Content broadcast with repeaters** — done: `publish()`, `ContentPointer`, CID verification, opt-in allowlisted repeaters (`src/content.ts`, `src/protocol.ts`, `test/content.test.ts`). Coverage simulation: [`benchmarks/REPEATERS.md`](../benchmarks/REPEATERS.md).
4. Private multicodec replaced (pointer and messages are CBOR, codec 0x51, in signed envelopes); threat model and this roadmap current; all tests pass (`npm test`).

### Performance iterations (2026-10-29)

Each one: hypothesis, a scorecard or room measurement, commit if it held. 30 trials per cell unless noted (from item 39 on, A/B claims use `--save`/`--compare`: paired discordant counts and an exact McNemar p); full tables in [`benchmarks/RESULTS.md`](../benchmarks/RESULTS.md).

| # | Change | Result |
|---|---|---|
| 1 | `dual`: two tones at once, a byte per symbol | 36.8 B/s (3.6x voice); lean connection to first byte 10.6 s |
| 2 | `turbo`: 10 ms symbols | 73.6 B/s; 0.3 s dropouts fatal at 16 parity (see 5) |
| 3 | Jingle dropdown in the demos (your UI request) | data hidden under a public-domain tune, ultrasonic by default |
| 4 | `tri`: three bands, 12 bits per symbol with bit packing | 52.2 B/s |
| 5 | Reed-Solomon parity per preset: 32 on the fast presets | tri 0.3 s dropout rows 0 → 100%, -6 dB 53 → 90%; turbo reverb 50/70 → 87/97% |
| 6-7 | 32 parity on dual, fast, voice (music stays 16) | dual reverb 40/60 → 77/93%; fast reverb 40/65 → 63/93%; voice RT60 0.8 s 55 → 80% |
| 8 | Byte confidence over the right nibbles; dropout symbols not "confident" (Gemini) | neutral-to-positive; the integer-period Goertzel window was measured and rejected (-10 to -30 at -6 dB) |
| 9 | Tone-set rotation on fast, dual, tri, turbo (Opus, measured) | fast reverb 63/93 → 83/100%, collisions 53 → 80%; tri reverb 57/100 → 83/93%, collisions 53 → 77%; no airtime cost |
| 10 | Exact fractional symbol period | max-size voice frames across 44.1/48 kHz 0/5 → 5/5 |
| 11 | Keep scanning after a decoded frame's header (Gemini) | 0 dB collisions: fast 80 → 97%, dual 70 → 83%, turbo 60 → 73% |
| 12 | Chase-style runner-up retries (Opus) | tri reverb 83/93 → 100/97%, fast 83/100 → 93/97% |
| 14 | Second echo-subtraction tap (0.25 x the symbol before last) | voice reverb +4/+3 points, music -3/0: inside the noise, **rejected** |
| 16 | `robust` preset: soft-decision convolutional inner code (Opus #4, built by a background agent) | full table, 50 trials: equal-power collision **96%** (voice 90%), -6 dB and all dropout rows 100%, reverb 84/86%, 6 B/s |
| 21 | `tune`: the data as the jingle's accompaniment (audible-quality note) | quiet room 100% for all four melodies; reverb Westminster 95-100%, Beethoven 80-95%, Shave 55-80%, Charge 50-65% (brass harmonics sit on the chord tones; its ladder starts above them at 2 notes per beat); noisy room 65-100%; 2-5 B/s |
| 20 | Decoded-body dedupe instead of the `lastEnd` barrier (Opus throughput-2 note: the barrier refused our frame whenever the other sender's decoded first) | 0 dB collisions at 50 trials: voice 90 → 94%, fast 92 → 98%, dual 84 → 96%, tri 72 → 94%, turbo 68 → 96%, robust 96 → 98%; -6 dB 100% everywhere; no other row moved |
| 22 | Channel-measured retry: when a body fails at nominal timing, estimate the pitch scale from the head sync (retune the detector, re-read the length), measure the symbol period from the head-to-tail sync distance, decode again; no cost on the common path | new row `clock drift 3000 ppm (walking speed)`: robust 0 → 100%, ultrasonic 0 → 90% (3000 ppm moves its tones half a bin), voice/turbo 100%; other rows unchanged |
| 23 | `ultrasonic`: tone-set rotation (3) and 32 parity, as voice has | 9.7 → 8.8 B/s; reverb 80/70 → 100/93%, 3000 ppm 90 → 97%; under-jingle reverb cells mostly +10-20 points (Westminster -24 dB reverb 90 → 77, inside the noise) |
| 24 | `music` at 32 parity (scorecard `--opts '{"parity":32}'`, new flag for testing a hypothesis without editing src/) | reverb 100/77 → 97/83% for 6.5 → 5.8 B/s: inside the noise, **rejected**; the 0.8 s row is limited by chord tones a semitone apart, not by parity |
| 25 | `chime` with tone-set rotation (`--opts '{"rotate":3}'`) | reverb 0.8 s 77 → 90% at the same 6.5 B/s, but rotation offsets the pentatonic notes by a third of the first interval, so the chime stops being in tune: **rejected** for the audible preset; a musical rotation (sets a whole octave apart) is the version worth trying |
| 26 | `chime`: alternate C and D pentatonic note to note (a musical rotation; together the two sets are G major) | 100 trials: reverb 0.8 s 62 → 77%, 0.3 s 93 → 94%; 0 dB collisions 93 → 90% at 30 trials (noise); same 6.5 B/s |
| 27 | Rotate the tone set every symbol, as `rotate` documents (barSymbols defaulted to 8, so voice/dual/tri/turbo/ultrasonic/hidden/robust changed set every 8 symbols; research note `research-next-experiments.md` exp. 3). Also: the scorecard's reverb rows now use a fixed bank of rooms, so A/B pairs are paired | 100 trials, paired rooms, reverb 0.3/0.8 s: voice 90/87 → 91/93, robust 91/91 → 92/92, hidden 87/91 → 90/95 |
| 28 | Length candidates from both the plain and the differential header read (research note exp. 1: in reverb the two plain copies that follow a sync symbol 10 agree on a wrong length, so most reverb failures never tried the right body) | 100 trials, paired rooms, reverb 0.3/0.8 s: voice 91/93 → 96/98, ultrasonic 95/93 → 97/96, chime 93/83 → 96/86, music 94/72 → 97/75; 0 dB collisions 95% unchanged; no airtime |
| 29 | `music`: each bar alternates its chord with the next diatonic seventh note to note (`alt: 2`; Cmaj7/Dm7, G7/Am7, Am7/Bm7b5, Fmaj7/G7, all in C major), so a note's echo never lands on the next note's tone (research note exp. 2). Also measured for `chime`: a second set 6 semitones up (black keys, no shared pitch class) gives 0.8 s reverb 86 → 91% and 0.3 s 96 → 99%, but alternates white and black keys every 60 ms; left at the in-key D pentatonic until someone listens to both | 100 trials, paired rooms: music reverb 0.3/0.8 s 97/75 → 99/91%, 0 dB collisions 98 → 99%; same 6.5 B/s, still in key |
| 30 | `tune`: Westminster, Shave and Beethoven alternate each beat's chord with the same chord a whole tone up, note to note (`Jingle.alt`); Charge! keeps one set per beat (its brass harmonics sit on the transposed ladder: reverb 73/57/73/70 → 40/27/37/33) | jingle benchmark, 30 trials, reverb at -6..-24 dB: Shave 77/63/80/73 → 90/93/93/93, Beethoven 90/90/80/90 → 93/90/83/90, Westminster noisy 50/60/53/63 → 60/73/60/60; quiet rows 100% |
| 31 | Review fixes (`notes/review-2026-10-30.md`): `busy()` scores every tone set over two windows (it scored set 0 only, so rotating presets read as clear two symbols in three); no-options = `PRESETS.voice`; the drift retry tries both length candidates; Goertzel windows outside the buffer are silence, not cached NaN; one pending retry per frame; jittered SYN retries; the timed room runs the shipping preset through the real `busy()`/`tailLeft()` with one speaker per node; a pinned per-preset waveform fixture (`test/wire-format.test.ts`) fails when the on-air format changes | collisions test, 3 seeds: with carrier sense every remaining overlap is a pair that started inside the same 100 ms step (2-6 frames); without it 10-12 of 11-14 frames overlap and the jittered retries still complete |
| 32 | Second review round (Codex, Gemini, Grok, asked independently; `docs/backlog.md` holds the rest): the voice defaults now apply to partial options too (`{}` and `{ symbolSeconds }` gave rotate 1 / parity 16, so the transport tests ran a modem the browser never ships); the retry keeps every length candidate and a corrected length that is not ready waits without blocking the ready ones; a waiting retry wakes only when its whole tail window is buffered; `goertzel` itself bounds its window; the timed room waits exactly for a decoded tail (as the browser does) and passes `maxFrame`; the browser speaker queue survives a failed send (one oversized frame used to reject every later send until reload); the Audio QR listener shares the browser link's capture with dropped-buffer padding (`src/capture.ts`) | transport TTFB on the shipping voice preset: lean 47.0 s, stock 127.4 s (41.9 s was at 16 parity); 3000 ppm rows 100%; 66 tests pass |
| 33 | Backlog 3 and 4: a frame whose head was lost is recovered from its tail at any clock stretch (the stretch is searched over +-4000 ppm by the tone confidence of the first 32 body symbols, Goertzel only, then one decode); a flood of unsigned SYNs no longer blocks inbound dials (the oldest half-open accepted connection is evicted when the table is full). Delivered frames also remember their tail position, so a tail whose header misreads is not re-tried: that had tripled decoder CPU on clean audio | tests: max-size robust at 3000 ppm with the first 16 symbols erased decodes (0 before); 20 bogus SYNs then a real dial completes; voice CPU 23 → 6.4 ms per audio second; robust/ultrasonic 3000 ppm 100% |
| 34 | `config()` rejects a tone at or above Nyquist (backlog 5; the tri/turbo ladder test moves to 48 kHz). It caught the `tune` ladders: 16 chord tones from C6 up reached 37-67 kHz, so every tune tone above 24 kHz was an alias (a 44.1 kHz phone and a 48 kHz laptop alias differently and cannot talk: a candidate cause of the over-the-air failure), and the jingle benchmark simulated tune at 16 kHz, so its tune rows measured aliases too. Ladders are capped at 14 kHz (chord 9th/13th fill, then an octave lower): 1-9.4 kHz for Westminster/Shave/Beethoven, to 12.5 kHz for Charge | jingle benchmark at 48 kHz, 30 trials, reverb -6..-24 dB: Westminster 97/100/100/100, Shave 100/93/100/100, Beethoven 97/87/77/77, Charge 10/3/30/17 (brass harmonics on a ladder that now sits inside them; backlog); quiet and noisy rows 97-100% except Charge noisy 100%. Wire-format fixture re-pinned for the four tune entries |
| 35 | Scorecard controls (backlog 6): payload, noise, room, collider, burst and join time each draw from their own stream keyed by (seed, trial); rooms keyed by seed (`--seed 2` is a held-out bank); collision cells also score the other sender's frame, which is kept whole inside the stream | voice 0 dB collisions: ours 90%, both 90%; -6 dB: ours 100%, both 53% (the quieter frame is the one that dies); robust 0 dB both 97% |
| 36 | Charge! has no `tune` form (`Jingle.tune: false`): with the ladder under 14 kHz its brass harmonics sit on the data; a higher floor (F7) and one note per beat measured 10-27% in reverb too. Listener, demo, benchmark and fixture skip it; ultrasonic and hidden under Charge! stay | jingle benchmark at 48 kHz: Westminster tune 100% everywhere, Shave 97-100%, Beethoven 73-93% in reverb |
| 37 | Timed room: nodes can hear their own speaker (`selfGain`); a collision variant runs with it at 0.5, louder than the room's 0.3 (backlog 8 and 9) | 3 seeds: 2/2 connections, 143-166 s on air, every overlap a same-step pair. Hearing yourself costs nothing: the link drops own-role frames, so the contested "mute the local decoder while sending" is not needed |
| 38 | Scorecard realism (backlog 6): the radio row's low-pass is 8th order at 3 kHz with receiver hiss after the AGC (two 2nd-order stages let 4-7 kHz through at -14 dB and the AGC pulled it back up, so `hidden` "passed a radio"); a new row, laptop speaker to phone mic (150 Hz-12 kHz, soft clip with a few percent THD) | radio: hidden 100 → 0%, voice/fast/robust/chime 100%; speaker-to-mic: voice, dual, tri, turbo 100% at 30 trials (a low band's harmonics at this distortion do not reach the upper bands) |
| 39 | Scorecard `--save a.json` / `--compare a.json`: per-trial outcomes, and a paired report per row (trials only B decoded vs only A, exact McNemar p); the same seed gives both builds the same payloads, rooms and noise per trial | hidden, rotation every 8 symbols vs every symbol, 100 trials: reverb 0.3 s 90 → 96, B won 6 / A won 0 discordant, p = 0.031; 0.8 s 96 → 96, 1/1, p = 1. Overlapping Wilson intervals could not have said the first was real |
| 40 | Timed room: per-path gain (0 to -N dB) and delay (0-30 ms) per sender→listener, from the seed (backlog 9); collision variant at -18 dB spread | 3 seeds: 2/2 connections, 127-137 s on air, every overlap a same-step pair. No near/far failure at this spread; a wider one is the knob for hidden terminals |
| 18 | Raised-cosine symbol edges, volume control (audible-quality note) | decode rows unchanged; no clicks between tones |
| 19 | Channel note (Gemini): rotation on voice and robust, tri inside the phone band (900-8225 Hz), fair same-noise rows, dropped-buffer guard in the browser capture | voice reverb 70/80 → 77/87%; robust reverb 84/86 → 90/100%, collisions 97%; tri 48 B/s unchanged with 87/100% reverb; radio rows still 100% |
| 17 | `hidden` gets rotation and 32 parity | reverb 56/54 → 78/92%, collisions 70 → 90%, 1 s dropout 38 → 100%, 11.7 B/s |
| 15 | `turbo` at 40 parity (Opus: 0.3 s erases 30 bytes) | -6 dB 33 → 73%, reverb 93/100%, 63.9 B/s, but 0 dB collisions 72 → 55% at 60 trials: a trade, **kept 32** (dropout rows are already 100%) |
| 13 | `tri` at 15 ms symbols (Opus #3) | 63.9 B/s (+33%) but -6 dB 100 → 83%, collisions 77 → 53%, reverb 100/97 → 83/90%: **rejected**, tri stays the robust fast tier |

Not adopted with reasons: lighter parity on short frames (3%), handshake trim for known peers (7%, touches reviewed crypto), integer-period window (SNR loss). Research notes: [`notes/research-throughput-opus.md`](../notes/research-throughput-opus.md), [`notes/research-throughput-gemini.md`](../notes/research-throughput-gemini.md). Still on the list from them: energy-flagged erasures, a soft inner code for collisions, echo subtraction trained on the preamble, a 4th band, k-of-N tones, OFDM for short range.

### Transport: what is still open

- ~~Room-level scheduling~~ measured 2026-10-28 in a room with real overlapping audio and a mocked clock (`test/room-time.ts`, `test/collisions.test.ts`): two lean connections dialed at the same moment in one room, 3 seeds each. No carrier sense: 0/2 complete, every frame collides. Listen-before-talk through the real `busy()`/`tailLeft()` (2026-10-30; the earlier run used god-view carrier sense): 2/2 in 138-353 s, and every overlap left is a pair that started inside the same 100 ms step. Plus responder priority (answers go first, new bursts wait a random extra slot, now the default): 2/2 in 114-152 s, **0 overlapping frames in every seed**. Open: more than two conversations, and a shared scheduler across the discovery service and the transport.
- ~~Fold the handshake into SYN / SYN-ACK~~ (done: 4 frames; 41.9 s simulated at 16 parity, 47.0 s on the shipping voice preset with 32 parity (stock Noise + yamux: 127.4 s); preset ladder on top: 19.8 s when `fast` works).
- **Authenticated link control.** FIN/RST/ACK are unsigned (threat T21). Only worth bytes if targeted disruption shows up.
- **Multiaddr code.** `/audio` uses private-use code 0x300003 until registered in the multicodec table.
- **Frame-format policy (2026-10-30, after three reviewers agreed nothing should go on the air yet).** The on-air format of every preset is pinned by `test/wire-format.test.ts`; a change fails CI until the fixture is updated on purpose and the commit says so. Today every receiver is a page loaded fresh from the same deploy, so both ends always run the same build. The first time a receiver exists that cannot be updated (a firmware, a third-party page), a breaking change ships as a new preset generation (`voice2`) and receivers listen for both for one release; a version byte in the header would cost 0.48 s per voice frame forever and still could not describe tone schedules, so it is not planned.
- **Hosted demos.** https://sgtpooki.github.io/libp2p-audio-protocol/ deploys from `main` (`.github/workflows/pages.yml`).
- **Signature preamble.** The jingle's first phrase as the sync (long notes, detectable well below the music), its transposition naming the preset that follows; replaces the beep preamble in tune mode. Design in `notes/research-audible-opus.md` 2.2.
- **Phone-native `fast`.** Ultrasonic works on the iPhone in both directions (2026-10-29, Brave); 20-25 ms symbols on the phone are still untested (leave the preset on voice and tap Connect: the ladder tries `fast` and the log names the winner).

Backlog, ranked: [`backlog.md`](backlog.md). Working agreements: commit and push to `main` directly; peer review with frontier models (Fable, Codex, Gemini); measure claims with the scorecard (`benchmarks/RESULTS.md`) or over the air (`benchmarks/OVER-THE-AIR.md`), and give competing strategies equal budgets.

## 1. Adopt existing libp2p / IPFS standards

| Item | Today | Plan | Why |
|---|---|---|---|
| Signed broadcast messages | Custom `AudioMessage` in a signed envelope | Switch to the GossipSub/pubsub `Message` (`from`, `data`, `seqno`, `topic`, signature, dedupe by `from+seqno`) **when we build an audio ↔ gossipsub bridge**, not before | A bridge can republish audio messages unchanged onto a gossipsub topic (and back), with signatures still valid on the normal libp2p network. Reviewers split: Codex says adopt it if bridging matters; Gemini says skip it (extra topic and key bytes, duplicates the envelope). Its seen-cache gives dedupe, not freshness, so our replay window stays either way. |
| "Fetch this CID" broadcasts | Not built | Broadcast IPNS records (V2: signed CBOR with value, sequence, validity) | Standard, verifiable by any IPFS node, and already carries expiry (stale-instruction protection) and a sequence |
| Payload type codes | Registered `cbor` (0x51); the signed-envelope domain string tells message types apart | Keep | Interop; no private-use codes left in envelopes |
| Message encoding | CBOR maps with 1-letter keys (`AudioMessage`, `ContentPointer`) | Keep; ~5 bytes more than fixed binary, extensible | Extensibility vs bytes on air |
| Discovery | `PeerRecord` in a signed envelope | Keep | Already the libp2p standard |
| Replay window, presence challenge, fountain code | Custom | Keep custom | No libp2p/IPFS equivalent for one-way, hours-late, lossy broadcast |

## 2. Weak spots in the scorecard

Proposals from the Codex and Gemini reviews (2026-10-28), each to be proven with a scorecard row:

| Weak spot (benchmarks/RESULTS.md) | Most promising fixes | Expected |
|---|---|---|
| ~~Losing 0.3 s of sync or the 2-byte length header kills the frame (0%)~~ | Done 2026-10-28: tail copy of sync + header, 3-copy length vote (+0.48 s per frame) | 0% → **100%** on both rows, all presets; fountain late-join under noise bursts 40-45% → 55-62% |
| Two equal-volume senders collide (60-88%) | Listen-before-talk with random backoff in `AudioLink` (no airtime cost); per-frame tone hopping so overlapping frames hit different tones | Fewer collisions in practice; 0 dB row toward 85% |
| ~~Reverb RT60 0.8 s still ~51-57%~~ | Done 2026-10-29 (items 5-9, 17, 23, 26-30): parity 32, tone-set rotation every symbol, the differential read's length as a second header candidate, musical alternation for chime/music/tune | 50 trials: voice 100%, ultrasonic 96%, robust 100%, music 96%, fast 100%, dual 96%, tri 98%, turbo 98%, hidden 98%, chime 80% |
| Late join under heavy noise bursts: voice fountain 72% vs repeat 92% at equal listening time (2026-10-29, 50 trials) | For a 117-byte message the fountain is two 60-byte chunks, each with its own sync, header, tail and 32 parity: 1.4x the airtime of one frame inside a budget of two frames, so it gets fewer chances than the repeat. The fountain earns its overhead on messages of many chunks (a late listener never waits for a whole long frame), not on one-frame messages; the demo's Loop button should pick repeat below ~2 chunks | documented, not a modem fix |
| ~~Long frames + clock drift~~ | Done 2026-10-29 (items 22-23): when a body fails, the pitch scale is measured from the head sync and the symbol period from the head-to-tail distance, then the body is decoded again; `clock drift 3000 ppm (walking speed)` row: robust 100%, ultrasonic 100%, max-size robust frames covered by a test | 0% → **100%** at 3000 ppm |

Benchmark realism to add (both reviewers; seeds, paired inputs and both colliders done 2026-10-30, item 35): several seeds and held-out seeds so we don't tune to one fixture; paired comparisons; a corpus of real recordings (phones, rooms, a radio) replayed through the scorecard; real envelopes instead of random bytes; collisions scored for both senders; dropout start swept across every symbol.

## 3. Radio and mesh opportunities

| Opportunity | What it would show | Needs |
|---|---|---|
| **Audio ↔ LoRa gateway** (Meshtastic / MeshCore, the radios [meshkit](https://www.meshkit.org/) teaches) | A laptop or phone hears a signed envelope over audio and re-sends it unchanged on a Meshtastic private app port (256-511), and the reverse. Frames (≤ 235 B) fit a Meshtastic packet (233 B payload, to verify). | A Meshtastic node, the Meshtastic JS/Python API |
| **Through a handheld radio** | Measured frame error rate through a real FM handheld (`voice` preset was designed for the 300-3000 Hz voice band) | Two radios; ham license for amateur bands; check FRS/GMRS data rules |
| **Ham packet interop** | Same envelope carried as AX.25 via Dire Wolf, compared with our modem | Dire Wolf, a radio or a sound-card loopback |
| **Reticulum** | Our envelopes on a Reticulum `plain` destination, or our modem as a Reticulum interface | Fragmentation (Reticulum assumes 500 B packets) |
| **Town-square loudspeaker** | A looping signed broadcast (IPNS record or pubsub message) heard across a space | PA system, range test |
| **FM / broadcast datacasting** | Signed CID in a radio station's audio; listeners fetch over any link | Lossy codecs and FM may cut above ~15 kHz (ultrasonic won't survive) |
| **Emergency alerting** | EAS/SAME-style repeated headers (3 bursts) for signed alerts, using our own tones (47 CFR 11.45 forbids reusing EAS codes) | Message type with expiry |

## 4. A default sound that doesn't sound like dial-up

Goal: the **default** preset is a catchy, repetitive jingle or melody that still carries data, instead of beeps. `chime` (random pentatonic notes) is a first step but sounds like wind chimes, not a tune.

**Built 2026-10-28: the `music` preset** is the chord-progression arpeggiator below (7th chords over 4 octaves, I–V–vi–IV, chord change every 8 notes, plucked). Scorecard: 100% down to -6 dB SNR, 95% at RT60 0.3 s and 78% at 0.8 s (best of all presets, the chord changes keep a tone from being reused while its echo rings), 93% in an equal-power collision, 6.5 B/s. Listen: `benchmarks/sounds/music.wav`. Still open: a blind listening test and whether to make it the default (it needs a full-range speaker, so not for radios).

Designs from the reviews, each needing a scorecard row (bytes/s and robustness vs `voice`) and a listening test:

| Design | How it carries data | Throughput (estimates) | Notes |
|---|---|---|---|
| **Chord-progression arpeggiator** (top pick) | Keep MFSK-16, but the 16 tones for symbol *i* are chord tones of the current bar of a fixed loop (e.g. I-V-vi-IV), voiced over 3 octaves, plucked | ~10 B/s (same as `voice`), per Gemini | Same Goertzel decoder; the receiver switches tone sets per bar. Sounds like a synth arpeggio, always in key. Cheapest to try. |
| **Bass ostinato + data counter-melody** | A fixed, recognizable 4-note bass riff (400-750 Hz) under 16-FSK data in 1000-2500 Hz | ~9-10 B/s (Gemini); ~3-4 B/s if notes are slower and more musical (Codex) | The riff is the hook and a continuous timing reference, which could also help sync loss and clock drift. Splits speaker power. |
| **Chord-constrained melody** | Each eighth note picks 1 of 4 notes that fit the current chord | ~1-1.5 B/s (Codex) | Most musical, much slower. |
| **Rhythm + pitch cells** | 4 rhythm patterns x 16 pitches per 120 ms cell | ~6 B/s (Gemini) | Most song-like; onset timing suffers in reverb. |
| **Data under any music** | `ultrasonic` mixed under a track | ~10 B/s | Works laptop to laptop; phone hardware untested; won't survive FM or lossy codecs. |

Pick the default with scorecard numbers plus a blind listener preference test.

## 5. Research areas to learn from

| Area | Why it's relevant |
|---|---|
| Delay/disruption-tolerant networking (DTN, Bundle Protocol RFC 9171) | Store-and-forward for links that are intermittent, which is exactly a disaster |
| Ham digital modes (FT8, JS8Call, VARA, AX.25/APRS, Winlink) | Decades of weak-signal and shared-channel practice: sync, FEC, collision handling |
| Underwater acoustic modems | Severe multipath and Doppler; the best references for echo-heavy channels |
| Broadcast datacasting (RDS, ATSC 3.0, satellite datacast like Othernet) | One-way broadcast with no back channel, as in our looping broadcasts |
| Fountain and network codes (RaptorQ RFC 6330, LT codes) | Better late-join efficiency at larger message sizes |
| Audio watermarking and steganography (spread spectrum, echo hiding) | Data hidden in music; robustness to compression |
| Emergency alerting (CAP, EAS/SAME, cell broadcast) | Message formats, expiry, authenticity, public trust |
| Ultrasonic proximity (Google Nearby, Chirp, LISNR) | What worked and failed on real phones |
| Mesh routing (Reticulum, Meshtastic, MeshCore, Briar) | How offline meshes spread messages and handle identity |
| Music information retrieval and audio fingerprinting | Recognizing a jingle/sync pattern robustly by ear and by machine |

## 6. Next steps (ranked)

1. ~~Fix fountain poisoning, bound state, expire challenges~~ (done 2026-10-28).
2. ~~Real libp2p transport, lean handshake, review~~ (done 2026-10-28; see "Current goal").
3. ~~Frame robustness: tail sync/header, length vote, listen-before-talk~~ (done 2026-10-28). Still open from [fec-and-coding](../notes/fec-and-coding.md): tone hopping against echo, a `robust` preset with soft decisions.
4. ~~Content broadcast with repeaters~~ (done 2026-10-28). Open: priority generations, CAR export, IPNS record, NEED repair requests, repeaters re-sending renewed pointers from cache.
5. ~~Presenter "audio QR" and event check-in pages~~ (done 2026-10-28: `examples/announce`, `examples/checkin`, hosted at https://sgtpooki.github.io/libp2p-audio-protocol/). Open: a reply count on the host for Audio QR, a reply-slot helper for rooms with many phones.
6. **Room with real overlap** in the simulator, then room-level scheduling with responder priority (transport open items above).
7. Phone-native ultrasonic and 25 ms symbols (phone↔laptop voice connection done 2026-10-28: 35 s).
8. Soft-decision decoding + convolutional inner code as a `robust` preset (~5 B/s), measured against the scorecard.
9. Benchmark realism: multiple and held-out seeds, recorded hardware corpus, real envelopes, both senders scored in collisions.
10. ~~Prototype the chord-progression arpeggiator~~ (done: `music` preset); decide on the default after a listening test.
11. Register the `/audio` multiaddr code; audio ↔ Meshtastic gateway.

## 7. Needs a person

- ~~Phone-native ultrasonic~~ (works, 2026-10-29); 25 ms symbols / `fast` on the phone still to check.
- Safari: host the demo with a real certificate (e.g. GitHub Pages) and retest.
