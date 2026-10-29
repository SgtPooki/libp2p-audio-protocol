# Past the MFSK ceiling, collisions, dropouts and connection time (2026-10-29, second round)

Researched against `main` at 2d667c7 (rotation on voice and robust, tri inside the phone band, the
same-level white-noise rows). Questions: what gets past MFSK's ~0.19 bit/s/Hz in a browser, how to fix
equal-power collisions, 1 s dropouts and the 5 s `turbo` connection, and what other systems do that we
don't.

How the numbers were made:

- **measured**: the real `benchmarks/scorecard.ts` from 2d667c7, copied outside the repo, 50 trials, seed
  1, Wilson 95% intervals. Six rows were added (marked `X`), the reverb model got a DRR parameter, and
  `drift()` uses a windowed-sinc resampler instead of linear interpolation (see section 5). The extra rows
  come first, so they shift the random draws: **cells here are not comparable cell-for-cell with
  `benchmarks/RESULTS.md`**. Every A/B below ran in the same script with the same seed.
- **prototype**: a 279-line OFDM modem with the same `modulate` / `Demodulator` API as `src/modem.ts`,
  run through that same scorecard. It lives in the session scratchpad, not in the repo.
- **estimate**: arithmetic or reasoning, marked as such. Each needs a scorecard row or an over-the-air
  run before it counts.

## Headline

1. **Most of the 0 dB collision loss is a decoder bookkeeping bug, not physics.** In 100 collision trials
   the receiver almost never failed on both frames. It decoded exactly one of the two, and when it got
   the *other* sender first, `lastEnd` blocked ours: `tryHead` drops pending heads whose body starts
   before the decoded frame's end, and the tail path refuses bodies before `lastEnd`. Replacing that
   barrier with "skip only bodies already decoded" (8 lines) takes 0 dB collisions from **64-94% to
   96-100% on every preset** and -6 dB collisions to 100%. In the paired run, no other row changed in any
   cell. Gemini named this in its first throughput note. Iteration 11 (keep scanning) fixed half of it,
   and this is the other half.
2. **OFDM-DQPSK works in our simulated rooms, but only at high SNR.** The prototype measured 166 B/s at
   1-6.5 kHz (2.5x `turbo`) and 114 B/s with a longer symbol. It scores 100% on reverb at RT60 0.3 s,
   98% at 0.8 s with the long symbol, and 100% at 1000 ppm and at 3000 ppm (walking speed). It scores
   **0% at in-band SNR 3 dB and below, 0% on the same-level white-noise rows, 4-10% in 0 dB collisions,
   and 0% on every dropout row.** It is a near-field, quiet-room tier on top of MFSK, not a replacement.
   Ultrasonic OFDM at 17-19 kHz measured 87 B/s, 9x the `ultrasonic` preset, with the same caveats.
3. **The collision weak spot that remains is collisions in a reverberant room.** On a new row (0 dB
   collision plus RT60 0.3 s), MFSK scores tri 6%, turbo 12%, voice 26%, dual 42%, fast 56% and robust
   72%. Unblocking doesn't help it. Reaching the reverb-only row's 90-96% needs either FT8-style
   subtraction (decode, re-synthesize, subtract, decode again) or rate 1/2 on `robust`: 72 to 86%,
   measured, at 25% less throughput.
4. **1 s dropouts should be left to ARQ.** Cross-frame parity on the link costs a frame per burst. It
   only beats retransmission if a 1 s hole hits more often than about once every 15 s of `turbo` airtime
   (estimate below). RLNC already covers one-way broadcasts.
5. **The 5 s `turbo` connection is 3.76 s of airtime plus about 1.2 s of turnaround.** The cheapest win is
   the 200-700 ms listen-before-talk backoff that the answering side takes when `busy()` sees the tail of
   the frame it just decoded (estimate, from reading `browser.ts`). Under 3 s needs a smaller handshake
   (static-key DH: 230 to 144 bytes, 0.86 s on `turbo`) or the OFDM tier (about 1.4 s of airtime for
   SYN plus SYN-ACK).

## 1. Ranked proposals

Paired baseline (2d667c7, this script), for reference:

| row | voice | fast | dual | tri | turbo | robust |
|---|---|---|---|---|---|---|
| collision 0 dB | 88% | 80% | 94% | 64% | 78% | 98% |
| collision -6 dB | 96% | 100% | 90% | 100% | 98% | 100% |
| X collision 0 dB + reverb 0.3 s | 26% | 54% | 38% | 6% | 10% | 70% |
| X drift 3000 ppm (1 m/s) | 100% | 100% | 100% | 100% | 100% | **0%** |

| # | Proposal | Expected gain (measured unless marked) | Cost | Trade-offs | Row that proves it |
|---|---|---|---|---|---|
| 1 | **Unblock overlapping frames**: dedupe decoded frames by body start (within 2 symbols) instead of the `lastEnd` barrier in `process`, `tryHead`, `flushPending` | Collision 0 dB: voice 88 to **100**, fast 80 to **98**, dual 94 to **98**, tri 64 to **96**, turbo 78 to **96**, robust 98 to **100%**. -6 dB: all **100%**. No other row moved (all 29 rows x 6 presets, paired) | ~8 lines in `src/modem.ts`. No airtime. A few more body decodes per collision | Duplicate deliveries are blocked only by the 2-symbol window, so run `npm test`; the link already drops repeated seqs | collision 0 / -6 dB, all presets |
| 2 | **Answer without the listen-before-talk backoff**: when the receiver just decoded a frame from its head, the `busy()` it sees is that frame's own 9-symbol tail. Wait until the known frame end + 30 ms instead of 200-700 ms random | **Estimate**: about 0.45 s per turn. `turbo` connection 5 s to about 4.5 s, and the same per burst handoff on every link turn | ~10 lines (`Demodulator` exposes `lastEnd` in seconds; `clear()` in `browser.ts` uses it) | None in a 2-party link. Keep the random backoff when the busy sender is not the one we're answering | over-the-air connect timestamps (`over-the-air-connect.mjs`), `test/room-time.ts` |
| 3 | **OFDM "near" tier** (section 3): 64 ms FFT, 32 ms CP, 353 DQPSK carriers 1-6.5 kHz, LFM chirps head and tail, conv r=1/2 + RS 32 | **Prototype, scorecard**: 166 B/s (2.5x turbo). 100% clean, 6 dB, 4.5 dB, reverb 0.3 s, 100/1000/3000 ppm, collision -6 dB 98%. 128 ms / 64 ms CP variant: 114 B/s, reverb 0.8 s 98% | ~350 lines (FFT, chirp sync, Doppler resample, header, conv r=1/2). CPU 10 ms per audio second at 16 kHz | **0%** at SNR <= 3 dB, on both same-level noise rows, on all dropout rows; 4-10% in 0 dB collisions; radio chain 0%. Needs a quality-gated switch (#5) | all rows; the new `X` rows; over-the-air at 0.5/1/3 m |
| 4 | **Ultrasonic OFDM** (17-19 kHz, 85 ms FFT, 32 ms CP, 171 carriers) | **Prototype**: 87 B/s vs `ultrasonic` 9.7 B/s. Same pass/fail pattern as #3, plus 100% at sigma 0.3 same-level noise (2 kHz band). Reverb 0.8 s 60% | Same code as #3 | Phone speaker and mic response at 17-19 kHz is **unverified** and the sim doesn't model it. Bluetooth/AAC paths cut it (see `research-channel-gemini.md`) | as #3, plus a phone-to-laptop run |
| 5 | **Quality-driven rate selection** (VARA-style): each ACK carries 1 byte of receiver quality (e.g. RS bytes corrected and the mean confidence margin), and the sender moves up or down the preset ladder per burst. The ladder today only steps down after SYN timeouts | **Estimate**: makes #3/#4 safe to use. Without it, an OFDM frame below about 5 dB SNR costs a full RTO | 1 header byte, ~40 lines in `link.ts` | Both sides must hear every preset in the ladder (already true: `browserAudioLink` runs one `Demodulator` per preset) | a link-level test: throughput over a scripted SNR ramp |
| 6 | **Static-key handshake** (Noise IK shape over X25519 keys derived from the Ed25519 identities): msg1 = e + enc(s) + tag = 96 B, msg2 = e + tag = 48 B, vs 134 + 96 B today | **Computed airtime**, `turbo`: SYN 2.07 to 1.69 s, SYN-ACK 1.69 to 1.21 s, total 3.76 to 2.90 s. With #2: about 3.2 s to connected (**estimate**) | ~80 lines in `handshake.ts`. Touches reviewed crypto: needs a new review | Ed25519-to-X25519 key reuse is common (libsodium, XEdDSA), but it is still cross-protocol key reuse. Handshakes are no longer signed (deniable) | `test/transport.test.ts` timing, over-the-air connect |
| 7 | **SYN timeout sized to the expected SYN-ACK**, not one max frame + 2 s | **Computed**: a lost SYN-ACK on `turbo` costs 4.8 s of RTO plus the retry. SYN-ACK airtime + 1 s = 2.7 s | ~5 lines in `LinkConn.connect` | A listener that is slow to answer (crypto on a slow phone) gets a duplicate SYN, which `Link.receive` already handles | connect time with 1 frame lost (room-time test) |
| 8 | **Timing tracking inside long frames** (early/late Goertzel every ~16 symbols) | **Measured failure**: `robust` 0% at 3000 ppm. A 19.6 s frame slips 59 ms, more than its 40 ms symbol. Voice (13.4 s) and every shorter preset pass | ~40 lines | Only matters for frames over ~10 s with motion or bad clocks | X drift 3000 ppm on `robust`, `voice`, `music` |
| 9 | **FT8-style subtraction (SIC) for collisions in reverb**: after decoding frame A, estimate A's per-tone amplitude from its own clean symbols, then subtract A's expected energy (tone plus a 1-2 symbol echo tail) from B's windows before deciding | **Ceiling**: the reverb-only rows, 90-96%, vs 6-56% today. Realistic gain **not measured** | ~80 lines; one re-synthesis per decoded frame | Energy-domain subtraction ignores the phase cross-term: a partial fix. WSJT-X subtracts in the waveform domain with fitted amplitude and phase | X collision 0 dB + reverb 0.3 s |
| 10 | **`robust` at rate 1/2** (unpunctured K=7) | Collision+reverb 72 to **86%**, collision 0 dB 100%, reverb 0.3/0.8 s 96/94 to 92/86% (inside the intervals). 6.0 to **4.5 B/s** | 1 option on `conv.ts` | -25% throughput for one row. Only for broadcasts into busy rooms | X collision + reverb |
| 11 | **Coded or soft-combined length header** | **Measured ceiling** with an oracle header (always the right length), pre-HEAD presets: robust reverb +2, voice +6 / 0, turbo +4 points; collision rows unchanged. **Not the ceiling it was thought to be** | ~40 lines | Low priority | reverb rows |
| 12 | **Cross-frame parity in `link.ts` bursts** (1 RS/XOR parity frame per 4) | **Estimate**: a 1 s hole on `turbo` kills 1.36 frames on average (1 s / 2.77 s per max frame + 1). Parity costs 2.77 s per 11.1 s burst. ARQ costs about 1.36 frames per hole. Break-even is one 1 s hole every ~15 s. **Don't build** | 1 frame per burst | Only worth it for latency-critical one-shot exchanges, and there #7 is cheaper | link throughput with Poisson 1 s holes |

Rejected or parked, with reasons:

- **k-of-N tones, a 4th band**: the new same-level noise rows already cost `tri` (66% at sigma 0.6) for
  splitting peak power three ways. More simultaneous tones go further in the wrong direction on real,
  peak-limited speakers.
- **Longer frames against 1 s dropouts**: on `turbo` 1 s is 100 codeword bytes. One RS(255) codeword
  can't absorb that (max parity 64). Interleaving two codewords across 5 s adds latency to every frame to
  save a retransmission that ARQ does anyway.
- **Schmidl-Cox sync for OFDM**: not tried. The chirp pair does sync *and* the Doppler/clock estimate,
  and its correlation peak stays sharp in the scorecard's rooms. See section 3.

## 2. Design sketches for the top 3

### 2.1 Unblock overlapping frames (proposal 1), measured

The diff against `src/modem.ts` at 2d667c7:

```ts
// process(), tail candidates: was `s - bodyLen >= this.lastEnd`
if (s - bodyLen >= this.bufStart && !this.wasDecoded(s - bodyLen) && !tails.some(...))
// tail decode success: also record the body start
this.done.push(body); if (this.done.length > 32) this.done.shift()
// tryHead: was `this.pending = this.pending.filter(p => p.body >= this.lastEnd)`
this.done.push(body); if (this.done.length > 32) this.done.shift()
this.pending = this.pending.filter(p => !this.wasDecoded(p.body))
// flushPending: was `if (p.body < this.lastEnd) continue`
if (this.wasDecoded(p.body)) continue
// fields
private readonly done: number[] = [] // body starts already decoded (head and tail of one frame deliver once)
private wasDecoded (body: number): boolean { return this.done.some(d => Math.abs(d - body) < this.c.sym * 2) }
```

`lastEnd` can then go. Why it works: in a collision, the frame that starts first is usually decoded
first. Its `lastEnd` then lies after our frame's head and tail, so both are refused, even though our body
is usually decodable (the counts: `tx ok / other ok` went from 0 to 28-75 out of 100). To check: run
`npm test`, plus the collision rows with `--trials 100`, plus one test that loops the same frame and
asserts exactly one delivery.

### 2.2 Answer turnaround and handshake bytes (proposals 2, 6, 7)

Where `turbo`'s measured 5 s goes (airtime computed with `modulate`, the rest estimated):

| step | seconds |
|---|---|
| SYN, 149 B (7 link + 8 tags + 134 msg1) | 2.07 |
| SYN-ACK, 111 B (7 + 8 + 96 msg2) | 1.69 |
| mic buffering, 2 x one 4096-sample `ScriptProcessor` block at 48 kHz | 0.17 |
| responder `clear()`: `busy()` is true during the SYN's 90 ms tail, so a 200-700 ms random wait | ~0.45 |
| crypto, scheduling, output latency | ~0.1-0.3 |
| **total** | **~4.5-4.7** (measured 5, rounded to whole seconds) |

Airtime per frame size (seconds, computed):

| frame | bytes | fast | dual | tri | turbo | OFDM 64 ms | OFDM 128 ms |
|---|---|---|---|---|---|---|---|
| SYN today | 149 | 7.96 | 4.14 | 2.88 | 2.07 | 0.80 | 1.22 |
| SYN-ACK today | 111 | 6.44 | 3.38 | 2.36 | 1.69 | 0.70 | 1.02 |
| SYN with IK msg1 | 111 | 6.44 | 3.38 | 2.36 | 1.69 | 0.70 | 1.02 |
| SYN-ACK with IK msg2 | 63 | 4.52 | 2.42 | 1.72 | 1.21 | 0.61 | 1.02 |
| pure ack | 7 | 2.28 | 1.30 | 0.98 | 0.65 | 0.42 | 0.83 |
| max frame | 219 | 10.76 | 5.54 | 3.80 | 2.77 | 0.90 | 1.22 |

Paths to a 2-3 s connection:

- #2 alone: about 4.5 s.
- #2 + #6: about 3.2 s.
- #2 + #6 + dropping the 4-byte from-tag in SYN-ACK (the conn id already matches it): about 3.1 s.
- The OFDM tier (#3) with today's handshake: 1.5 s of airtime, about 2 s connected. In practice that
  needs #5 to pick it, so the first connection in a room still pays the MFSK price.

Design for #2: `Demodulator` records `lastEnd` (sample index) of each decoded frame. `browser.ts`'s
`clear()` becomes "if every busy receiver's last decoded frame ends within 150 ms of now, wait until that
end + 30 ms; else the random backoff". The responder-priority rule in `link.ts` is unchanged.

Design for #7: `connect()` arms `duration(2 * TAG + expectedReplyBytes + HEADER) + 1` instead of
`rto()`. The SYN-ACK size is known to the dialer: tags, plus `MSG2` for the lean handshake.

### 2.3 OFDM near tier (proposal 3)

See section 3 for parameters and rows. Integration against our code:

- New `src/ofdm.ts` exporting `modulate`, `Demodulator`, `maxPayload` with the `src/modem.ts` signatures,
  so `AudioLink`, the scorecard and `browserAudioLink`'s per-preset demodulators take it unchanged. A
  preset gets `kind: 'ofdm'`.
- Reuse `rs.ts` and the CRC. Generalize `conv.ts` to a puncture pattern, because OFDM wants r=1/2: at
  r=2/3 the prototype dropped to 90% at 6 dB and 4% at RT60 0.8 s.
- The transport ladder uses it only for established connections, chosen by #5. Discovery, SYN/SYN-ACK and
  broadcasts stay on MFSK until over-the-air numbers say otherwise.
- Browser sample rates: the symbol is defined in seconds at a 16 kHz reference. The receiver already
  resamples each frame by the chirp-measured ratio, so it folds the 48 or 44.1 kHz to 16 kHz ratio into
  the same windowed-sinc step (k = measured ratio x 16000 / ctx.sampleRate). The transmitter synthesizes
  at 16 kHz and upsamples once.

## 3. OFDM feasibility

### Parameter set (prototype, scored)

| | `ofdm64c6` (default) | `ofdm128` (reverberant rooms) | `ofdmUS` (ultrasonic) |
|---|---|---|---|
| band | 1000-6500 Hz | 1000-6500 Hz | 17-19 kHz |
| FFT / spacing | 64 ms / 15.6 Hz | 128 ms / 7.8 Hz | 85.3 ms (4096 @ 48 kHz) / 11.7 Hz |
| cyclic prefix | 32 ms | 64 ms | 32 ms |
| carriers x bits | 353 x 2 (DQPSK) | 705 x 2 | 171 x 2 |
| modulation | time-differential DQPSK, Gray; no pilots | same | same |
| sync | 64 ms LFM chirp before and after the frame; quadrature (envelope) matched filter | 128 ms chirps | 85 ms chirps |
| clock / Doppler | head-to-tail chirp spacing gives the ratio; 2 refinements with a stretched template; windowed-sinc resample of the whole frame | same | same |
| header | 16 bits (len, ~len), DBPSK vs a known reference symbol, each bit repeated over 1/16 of the carriers | same | same |
| FEC | RS(len+4+32) outer; conv K=7 171/133 r=1/2 inner; seeded random interleaver over the frame; soft Viterbi on DQPSK max-log LLRs | same | same |
| PAPR | clipped to 6 dB over rms (6.4 dB measured) | same | same |
| 117 B frame | 0.70 s, **166 B/s** | 1.02 s, **114 B/s** | 1.34 s, **87 B/s** |
| CPU | 10 ms per audio s (16 kHz sim) | ~10 ms | 48 ms (time-domain tail search; an FFT correlator would cut it) |

### Scorecard rows (measured, 50 trials)

| row | ofdm64c6 | ofdm128 | ofdmUS | turbo (today) | turbo + #1 |
|---|---|---|---|---|---|
| clean / SNR 6 dB | 100 / 100% | 100 / 100% | 100 / 100% | 100 / 100% | 100 / 100% |
| X SNR 4.5 dB | 100% | 98% | 100% | 100% | 100% |
| X SNR 3 dB | **0%** | **0%** | **4%** | 100% | 100% |
| SNR 0 / -6 dB | **0 / 0%** | **0 / 0%** | **0 / 0%** | 100 / 80% | 100 / 80% |
| same-level noise sigma 0.3 / 0.6 | **0 / 0%** | **0 / 0%** | 100 / 0% | 100 / 94% | 100 / 94% |
| reverb RT60 0.3 s, DRR 0 dB | 100% | 100% | 98% | 90% | 90% |
| reverb RT60 0.8 s, DRR 0 dB | 42% | **98%** | 60% | 100% | 100% |
| X reverb 0.8 s, DRR +6 dB | 100% | 100% | 100% | 100% | 100% |
| X reverb 0.3 s + SNR 10 dB | 98% | 100% | 98% | 94% | 94% |
| drift 100 / 1000 ppm | 100 / 100% | 100 / 100% | 100 / 100% | 100 / 100% | 100 / 100% |
| X drift 3000 ppm (1 m/s) | 100% | 100% | 100% | 100% | 100% |
| collision -6 dB | 98% | 98% | 94% | 98% | 100% |
| collision 0 dB | **10%** | **4%** | **0%** | 78% | 96% |
| X collision 0 dB + reverb | 0% | 0% | 0% | 10% | 12% |
| radio chain | 0% | 0% | 0% | 0% | 0% |
| all 0.3 s / 1 s dropout rows | **0%** | **0%** | **0%** | 100% / 0% | 100% / 0% |

What these say:

- **Reverb is not OFDM's problem once the symbol is long.** The share of an echo that leaks into the next
  window is (delay - CP) / T_fft, so a long FFT tolerates echoes well past the CP. In the symbol-level
  probe: 32 ms FFT with 8 ms CP, 11/30 frames at RT60 0.3 s; 64/32 ms, 30/30; 128/64 ms, 30/30 at 0.3 s
  and 29/30 at 0.8 s.
- **SNR is OFDM's problem.** Each carrier gets 1/353 of the power. DQPSK + r=1/2 has a cliff at about
  4-5 dB in-band SNR (3 dB: 0%, 4.5 dB: 96-100%). Noncoherent MFSK puts all power in one bin and works
  below -6 dB. On the same-level noise rows OFDM fails where `turbo` passes. Those rows also favour
  presets simulated at 48 kHz by 4.8 dB (section 5), but the cliff is wider than that.
- **Equal-power collisions are hopeless for OFDM** (SIR 0 dB on every carrier). Listen-before-talk and
  responder priority keep a two-party link mostly collision-free (`test/collisions.test.ts`: 0 overlapping
  frames with responder priority). That is why this tier is for established connections only.
- **Dropouts kill the frame** because a 0.7 s frame has no time diversity: 0.3 s is half of it. Each lost
  frame is cheap to resend (0.7 s vs 2.77 s for a max `turbo` frame), so through ARQ the goodput under
  dropouts may still beat `turbo` (**estimate**, not measured).
- **Drift and walking-speed Doppler are solved by the chirp pair.** Before it, 1000 ppm passed only via a
  per-frame phase-slope fit and 3000 ppm failed. With the resample, 3000 ppm is 100%. Two details
  mattered:
  - The chirp correlation must use the envelope (a quadrature template). At 18 kHz / 48 kHz the real
    correlation's peak hops between carrier cycles 2.7 samples apart, a 43-130 ppm error.
  - The template must be stretched by the first estimate (LFM range-Doppler coupling).
- **PAPR is free to fix**: unclipped OFDM is 11.2 dB PAPR vs 3 dB for `fast` and 6 dB for `dual`/`turbo`.
  Hard clipping to 6.4 dB changed no row.

### Realistic rates and range (estimate)

- **1-7 kHz**: 115-165 B/s wherever the in-band SNR is above about 6 dB with margin. MFSK presets work
  about 10 dB lower. In free field, 10 dB is about 3x the distance. So if `turbo` works at 3 m, expect OFDM
  at about 1 m, and only in a quiet room. Past the critical distance, SNR stops falling with distance,
  but DRR falls below 0 dB, where the 128 ms variant is needed. Over-the-air distances are **unverified**.
  `notes/research-channel-gemini.md` section 3.2 has per-distance SNR estimates (also unverified) to
  check against.
- **17-19 kHz on phones**: about 87 B/s in simulation. LISNR rates its 1-2 kbit/s profiles at under 1 m
  and stationary; ours is about 0.7 kbit/s payload, so the same range class. Phone ultrasonic response and
  the OS pipelines are not modelled. Phone-to-laptop `ultrasonic` worked over the air (2026-10-29), so
  the band exists; the SNR doesn't yet have a number.
- **Walking**: the chirp-pair resample handled 3000 ppm in simulation. Real motion is not uniform over a
  frame, so for moving phones keep frames short (they already are: 0.7 s).

### Smallest version scorable in a day

What the prototype is, all in TypeScript:

- radix-2 FFT, 24 lines;
- K=7 conv code with puncture patterns, 41 lines;
- the modem, 279 lines.

Steps:

1. Copy the modem into `src/ofdm.ts`.
2. Add a preset kind.
3. Make the scorecard dispatch on it.
4. Run `npm run scorecard -- --preset ofdm64c6 --trials 50`.

The rows above should reproduce with seed 1 and the six `X` rows added in the same order.

## 4. What other systems do that we don't (yet)

| System | Technique | Status here |
|---|---|---|
| FT8 / WSJT-X (QEX 2020, verified) | **Multi-pass subtraction**: "the reconstructed signal is then subtracted from the received data … weaker signals can often be decoded on a second decoding pass" | Not done. Proposal 9 is its energy-domain cousin; proposal 1 removes the bookkeeping that stopped even a plain second decode |
| FT8 (same paper) | **A priori (AP) decoding**: known message fields lower the decode threshold | Not done. Our link frames have predictable bytes: `0xA0|type`, the conn id the receiver dialed, its own role, the expected seq/ack. With the conv inner code, pinning those bits in Viterbi is a real gain. With RS alone it is small. Estimate only |
| Underwater LFM Doppler (Sharif et al., IEEE JOE 2000) | Chirps bracket the packet; their spacing gives the compression factor; resample | **Built and measured** in the OFDM prototype (3000 ppm: 100%). The citation is verified; that the paper uses exactly a pre/post chirp pair is from memory (**unverified**) |
| VARA (HF/FM, **unverified** details) | OFDM with SNR-driven speed levels negotiated in ACKs | Proposal 5 |
| DVB-T2 (**unverified**, from memory) | Tone reservation / ACE for OFDM PAPR | Not needed: plain clipping to 6.4 dB cost nothing measurable |
| ZP-OFDM, underwater (Li, Stojanovic et al. 2008, **unverified**) | Zero-padding instead of CP, overlap-add at the receiver; eases resampling | Not needed in sim; CP + whole-frame resample worked |
| Quiet / liquid-dsp | OFDM profiles with conv inner + RS outer | The same FEC stack the prototype uses |
| JANUS | FH-BFSK + conv r=1/2 + interleaver | Already mirrored by rotation + `robust` |
| Acoustic OFDM (NTT DoCoMo 2008, via `research-audible-opus.md`, not read) | OFDM replacing a music band | A shaped-spectrum version of #3 could carry data under the jingle at OFDM rates (idea only) |
| LISNR, Chirp, ggwave, Sonos | Covered in the first note; nothing new found. Sonos's use of ultrasound is **unverified** and not researched | - |

## 5. Scorecard problems found on the way

- **`drift()` uses linear interpolation.** At 18 kHz / 48 kHz that leaves an image at 30 kHz which
  aliases back onto the signal, about 9 dB down and offset by the drift. It made ultrasonic OFDM fail at
  100 ppm, an artifact. With a 16-tap windowed sinc, ultrasonic OFDM passes. The audible presets were
  unchanged at 100/1000 ppm.
- **The `ultrasonic` MFSK preset fails at walking speed**: 0/50 at 3000 ppm with the sinc resampler. The
  shift is 54 Hz at 18 kHz on a 100 Hz grid. Moving phones can't use it today; a chirp-pair estimate
  (section 3) or a wider spacing would fix it.
- **The same-level noise rows are not the same level across sim rates.** `fixedNoise(sigma)` adds sigma
  per sample, so the noise density at 48 kHz is a third of that at 16 kHz (4.8 dB). `dual`, `tri`, `turbo`,
  `ultrasonic`, `music` and `hidden` run at 48 kHz, while `voice`, `fast` and `robust` run at 16 kHz. The
  multi-band presets get 4.8 dB of help on the rows meant to be fair to them. Fix: scale sigma by
  `sqrt(rate / 16000)`.
- **`(opts.rotate ?? 1 - 1)`** in the sim-rate rule parses as `opts.rotate ?? 0`, so `top` counts a whole
  spacing above the listed tones for rotate 3 instead of 2/3. Harmless today; it widens the noise band
  slightly.
- **New rows worth keeping**: collision 0 dB + reverb 0.3 s (the real room case, and the worst row in the
  table), drift 3000 ppm (walking), reverb 0.8 s at DRR +6 dB (near field), SNR 3 and 4.5 dB (where coded
  phase modulation has its cliff).

## 6. Sources

Read for this note:

- Franke, Somerville, Taylor, "The FT4 and FT8 Communication Protocols", QEX 2020: subtraction and multi-pass decoding, AP decoding (quotes checked in the PDF text): https://wsjt.sourceforge.io/FT4_FT8_QEX.pdf
- Sharif, Neasham, Hinton, Adams, "A computationally efficient Doppler compensation system for underwater acoustic communications", IEEE JOE 25(1), 2000, doi:10.1109/48.820736. Citation verified via search; the method details are **unverified**: https://ieeexplore.ieee.org/document/820736
- Follow-up confirming the block Doppler compensator and resampling by interpolation: https://digital-library.theiet.org/doi/10.1049/ip-rsn%3A20000665

Carried over, not re-read: Quiet profiles https://github.com/quiet/quiet ; LISNR Radius https://lisnr.com/ultrasonic-technology-overview-radius/ ; JANUS, CCSDS, Stojanovic (see `notes/research-throughput-opus.md`); Acoustic OFDM (see `notes/research-audible-opus.md`).

Unverified, from memory: VARA's modulation and speed levels; DVB-T2 tone reservation; ZP-OFDM (Li, Zhou, Stojanovic, Freitag, Willett, IEEE JOE 2008); phone response at 17-19 kHz; real in-band SNR at 1 and 3 m; where the 1.2 s of non-airtime in the 5 s connection goes (needs timestamps).

## Reproducing

All scripts were in the session scratchpad. To rebuild them:

- **Paired scorecard**:
  1. Copy `benchmarks/scorecard.ts` and point its import at a copy of `src/modem.ts`.
  2. Add the six `X` rows at the top of `CONDITIONS`, in the order of the section 3 table.
  3. Give `reverb()` a `drr` dB argument that scales `norm` by `10^(drr/20)`.
  4. Replace `drift()`'s linear interpolation with a 16-tap Hann-windowed sinc.
  5. Run `--trials 50 --no-late --preset <p>` for each preset.
- **Collision outcome counts**: record the colliding payload in `collide()` and count, per trial, whether
  each of the two payloads was delivered.
- **OFDM prototype**: section 3's table is the full spec. The decoder steps:
  1. FFT matched filter (threshold 0.2) for the head chirp.
  2. Search the tail chirp at each possible symbol count.
  3. Quadrature-template refinement twice with the stretched chirp.
  4. Resample the whole frame.
  5. Decode the header, check that it matches the symbol count, then the body.
