# Throughput, reverb, collisions and dropouts: what to try next

Researched 2026-10-29 against `src/modem.ts` at 473061d plus the uncommitted per-preset `parity` change.
Question: how to get more throughput, fewer frame errors in reverb and collisions, and better dropout
recovery on the speaker-to-mic channel, in browser TypeScript with no native code.

Two kinds of numbers below:

- **measured**: I ran them for this note, either (a) a symbol-level probe (scorecard's reverb and
  collision models, true timing, 30 random rooms x 600 symbols, 20 dB floor, 16 kHz) that reports
  symbol error rate (SER), how often the right tone was the runner-up, and the information per
  symbol with hard decisions vs with a soft metric (generalized mutual information of a softmax over
  the 16 normalized scores); or (b) the real `benchmarks/scorecard.ts` with extra preset definitions,
  100 trials, seed 1.
- **estimate**: reasoned or textbook, marked as such. Each needs a scorecard row before it counts.

## The headline

1. **Reverb errors come from the previous symbols' echo landing in the same 16 bins, and rotating the
   tone set per symbol removes most of it.** Three interleaved 16-tone sets, offset by one Goertzel
   bin (66.7 Hz at 20 ms), used in turn, take `fast` from 75% to 91% at RT60 0.3 s and from 87% to
   99% at RT60 0.8 s in the real scorecard, with no airtime cost. That configuration runs through
   today's modem unchanged: it is music mode with `barSymbols: 1`.
2. **Soft decisions are worth about 1 bit per symbol in collisions and almost nothing in reverb.**
   In a 0 dB collision the right tone is the runner-up in 96-100% of errors. A soft metric carries
   3.58 bits per 4-bit symbol against 2.58 with hard decisions. In reverb the gap is 0.05-0.1 bit
   once differential detection is on. So a soft inner code is a collision fix, not a reverb fix.
   This contradicts the assumption in `notes/fec-and-coding.md` section 5 item 3.
3. **Dropouts are just arithmetic.** A frame survives a dropout only if the bytes it covers fit in the
   parity. Today 16 parity bytes cover 0.3 s on `fast` and `dual` (15 and 15 bytes) but not on `tri`
   (22) or `turbo` (30). The per-preset `parity` change in progress is the right fix. Size it as
   bytes in 0.3 s plus about 8 for scattered errors, which means 40 for `turbo`, not 32.
4. **The ceiling of 1-of-16 MFSK is about 0.19/r bit/s per Hz**, where r is the tone spacing in
   Goertzel bins: 4 bits per symbol over 16 tones spaced r/(0.75 T). Today r = 2.25 (150 Hz at
   20 ms). r = 3 with rotation uses 33% more bandwidth per band. In the roughly 9 kHz a phone
   speaker passes, that is 70-100 B/s raw for any MFSK variant. Going beyond that needs phase
   modulation (OFDM-DQPSK), which only works in the near field. LISNR rates its own 1-2 kbit/s
   profiles at under 1 m, stationary.

## 1. Ranked proposals

Current numbers for comparison (scorecard, 100 trials, this session): `fast` reverb 0.3 s 75%,
0.8 s 87%, collision 0 dB 69%, SNR -6 dB 89%. At 40 trials (pre-parity change): `dual` 43/58/43%,
`tri` 50/55/50%, `turbo` 25/85/38% for reverb 0.3 / reverb 0.8 / collision 0 dB. 0.3 s silence
mid-body: `fast`/`dual` 100%, `tri`/`turbo` 0%.

| # | Proposal | Expected gain | Cost | Trade-offs | Scorecard rows that prove it |
|---|---|---|---|---|---|
| 1 | **Tone-set rotation**: 3 interleaved sets per band, offset 1/T_win (66.7 Hz at 20 ms), body symbol k uses set k mod 3 (JANUS/Olivia-style hopping in its smallest form) | **Measured, `fast`**: reverb 0.3 s 75 to 91%, 0.8 s 87 to 99%, collision 0 dB 69 to 82%, SNR -6 dB 89 to 100% (partly an artifact, see section 3). Symbol level: SER 4.3 to 0.46% (0.3 s), 3.9 to 0.23% (0.8 s) | 0 airtime. Spacing 150 to 200 Hz, so +33% bandwidth per band. Single band: a preset only. Multi-band: about 20 lines (`setFor`, `modulate`, `wholeSymbolAt`, `byteConfidence`) | **Collision -6 dB went 100 to 95%**: a small regression, check it before shipping. `tri` no longer fits under 8 kHz (3 x 3.2 kHz). 2 sets at 150/75 Hz is the narrow fallback (measured 79/93% reverb, 79% collision) but it lost 18 points at -6 dB | reverb RT60 0.3 / 0.8, collision 0 / -6 dB, in-band SNR -6 dB, plus the equal-noise-density row in section 3 |
| 2 | **Parity sized to airtime** (in progress): P >= bytes in 0.3 s + 8 | 0.3 s silence/burst rows from 0% to about 100% on `tri`/`turbo` (**estimate**: 22 and 30 bytes of erasures fit in 32/40) | `tri` 52 to 48 B/s at P=32. `turbo` 74 to 64 B/s at P=40 | P=32 on `turbo` covers 30 erased bytes and leaves only 1 error of slack, so any reverb error on top fails | 0.3 s silence in sync / header / mid-body, 0.3 s loud burst mid-body, per preset |
| 3 | **Spend the reverb margin on speed**: rotated `turbo` (10 ms, 2 sets, 266.7 Hz spacing, offset 133.3 Hz) and rotated 15 ms `tri` | **Measured, symbol level**: rotated 10 ms SER 0.77% (0.3 s) / 0.20% (0.8 s), against 4.3% / 3.9% for today's 20 ms `fast`. The current 74 B/s preset would then be more reverb-robust than today's 19 B/s one. 15 ms, 2 sets: 1.8% / 1.0%. Rotated tri at 15 ms is about 64 B/s at P=32 (**estimate**) | Rotated `turbo` spans 1.0-9.5 kHz. 15 ms rotated `tri` spans 0.7-9.2 kHz. Same code as #1 | Depends on phone speaker and mic response up to 9.5 kHz (**unverified per device**). Scorecard must simulate at 48 kHz | reverb rows at 48 kHz, plus a new "speaker rolloff above 8 kHz" condition |
| 4 | **Soft inner code for collisions**: max-log bit LLRs from the 16 energies (FT8 formula), conv K=7 r=1/2 punctured to 2/3, frame-long block interleaver, soft Viterbi; RS+CRC stay outer (CCSDS / Quiet `v27`+`rs8` layout) | **Measured**: information per symbol at 0 dB collision is 2.58 bits hard vs 3.58 soft, or 3.40 vs 3.86 with rotation. Inside the overlapped half of the frame, hard is about 1 bit/symbol (SER ~50%) and soft about 3 bits (**estimate**, a 2-way ambiguity). A rate-2/3 code fits under soft but not hard. Frame gain is **not measured** | -33% (r=2/3) or -50% (r=1/2) throughput. About 200 lines. A 64-state Viterbi at about 1 kbit/s is about 10^5 add-compare-selects per second: negligible | No reverb gain expected (soft gap under 0.1 bit). Ship as a `robust` rung or for broadcasts in busy rooms | collision 0 dB (target > 95%), in-band SNR -6 dB (coding gain), plus a new "collision 0 dB, 3 senders" row |
| 5 | **Energy-flagged erasures**: mark a byte as erased when its symbols' total energy is far below (silence) or far above (burst) the frame median, before confidence ranking; step erasures by 2, not 4 | Recovers dropouts right at the parity limit, where confidence ranking spends erasures on reverb-weak bytes instead of the hole (**estimate**: a few points on the 0.3 s rows) | About 25 lines in `decodeBody`. A few more RS calls | None | 0.3 s silence and burst mid-body, on `tri`/`turbo` at their new P |
| 6 | **Chase-style RS retries**: for the L least confident symbols, substitute the runner-up tone and retry RS errors-and-erasures | **Measured**: the runner-up is right in 52-91% of reverb errors and 96-100% of collision errors. A correct substitution fixes a byte without spending parity. Frame gain small after #1 (**estimate**) | About 30 lines, up to about 2L extra RS decodes per failing frame | CRC-32 guards false decodes. More tries cost more CPU per false sync | reverb rows, collision 0 dB |
| 7 | **4th band** (16 bits per symbol) on 48 kHz devices | +33% bits per symbol over `tri` (60 B/s at 20 ms, 80 B/s at 15 ms, P=32, **estimate**) | Per-tone amplitude 0.8/4 vs 0.8/3 (-2.5 dB). Spectrum to about 12 kHz with rotation | Phone speakers above 10 kHz vary. Peak-limited, so the loss is real (section 3) | SNR rows at equal noise density, new rolloff row |
| 8 | **k-of-N tones**: 2 of 16 per band = 120 combinations, 6 bits used | +50% bits per band (**estimate**) | Per-tone power -3 dB average-normalized, -6 dB peak-limited. Twice the echo energy per symbol. A wrong tone corrupts the whole 6 bits | Worse in reverb and collisions, untested. Probe at symbol level before building | SNR -6, reverb, collision |
| 9 | **OFDM-DQPSK near-field preset** (Quiet `audible-7k-channel`: 48 subcarriers, CP 8, conv `v29` + RS) | 1-4 kbit/s at short range (**estimate**; LISNR's 1000/2000 bps profiles are rated under 1 m and stationary) | 600+ lines: FFT, Schmidl-Cox sync, CFO, pilots, soft demap, inner code | At DRR 0 dB the CP must hold the echo. The share of reverb energy past a CP of length T is e^(-13.8 T/RT60), so -12 dB needs a 60 ms CP at RT60 0.3 s. Hand motion of 0.5 m/s gives Doppler of about 12 Hz at 8 kHz | New rows: reverb at DRR +15 dB, 0.5 m/s motion |
| 10 | **Soft-combine looped frames**: sum per-tone energies of two copies aligned by their syncs before deciding | Helps collisions and noise (a different interferer per copy). Does **not** help static room reverb (same impulse response both times) | Buffering about 2 frames. About 60 lines | RLNC already combines at the frame level | late join with collisions (new) |
| 11 | **Timing tracking inside the frame** (early/late Goertzel at +/- hop) | Nothing today. Drift rows are 100% (`fast` at 1000 ppm, measured) | About 40 lines | Only matters for 255-byte `turbo` frames at 1000 ppm (2.75 ms drift vs 1.25 ms guard) | clock drift 1000 ppm with a 235-byte payload |

**Rejected, with reasons:**

- **Chirp / CSS as the data modulation.** After dechirping, an echo at delay d appears as a peak
  shifted by d times the slope, which is another symbol. Reverb becomes ISI again. Chirps are good
  for sync, not for this channel's data.
- **RaptorQ / LT for the fountain layer.** See `notes/fec-and-coding.md`: no overhead gain at our K,
  plus licensing and provenance issues.
- **RS across frames.** That is what RLNC already does.
- **Window and detector tweaks.** All measured, symbol level, `fast`, RT60 0.3 s with differential
  detection:
  - A Hann window is worse (5.5% vs 4.3% SER).
  - Moving the window to the last 3/4 of the symbol: no change (4.2%).
  - Spacing tones at exact bin multiples (133.3 Hz) without rotation: no gain (5.3%), and 52% vs
    75% frames in the scorecard.
  - A min-of-two-half-windows "steadiness" detector against misaligned interferers: no gain in
    either reverb (4.5%) or collisions (19.5%).
  - Subtracting a decaying max of the last 3 symbols instead of 0.5 x the previous one: 3.7% vs
    4.3%, not worth it on its own.

## 2. Design sketches for the top 3

### 2.1 Tone-set rotation (proposal 1)

Mechanism: with RT60 0.3 s, about 60% of the reflected energy arrives within one 20 ms symbol of
the direct sound (energy decays as e^(-13.8 t/RT60), so the share within 20 ms is
1 - e^(-0.92) = 0.6). Today that echo sits in the same 16 bins the next symbol is read from.
Differential detection subtracts 0.5 x the previous symbol and roughly halves SER (9.5 to 4.3%).
With 3 interleaved sets, the echoes of symbols n-1 and n-2 sit on other sets' frequencies, which
are orthogonal to set n's bins over the window: offset = exactly 1/T_win. Only echo from n-3 and
older lands on the same set, and it is about 12 dB weaker at RT60 0.3 s. The `music` preset's
reverb lead (78% at 0.8 s vs `chime` 64%) was the same effect, by accident, every 8 symbols.

Format:

- Preamble, header and tail stay on set 0, unchanged.
- Body symbol k plays band b's tone from `sets[b][k % R]`, where
  `sets[b][r][t] = base_b + t * R / T_win + r / T_win` and `T_win = 0.75 * symbolSeconds`
  (the window `tonesAt` already uses).
- At 20 ms: R = 3 gives spacing 200 Hz with offsets 66.7 and 133.3 Hz; one band spans
  16 x 200 = 3.2 kHz.

Code changes (`src/modem.ts`):

- `ModemOptions.rotate?: 1 | 2 | 3` (default 1 = today). `config()` builds `sets` as
  `bands x rotate` arrays from the base tones.
- Make `setFor(c, k)` return `k % c.rotate` (it already does `floor(k / bar) % sets.length` for
  music; the `bands > 1 ? 0` branch is what blocks multi-band rotation). Index sets as
  `[band][rotation]`.
- `modulate`: the tone is `c.sets[b][inBody ? setFor(c, k) : 0][nibble]`.
- `wholeSymbolAt`, `byteConfidence`, `scoresAt`: pass `(band, rotation)`. The energy cache key
  becomes `start * (bands * rotate) + band * rotate + rotation`.
- Differential detection: keep `prev` on the *same* set, i.e. `tonesAt(start - sym, sameSet)`. The
  probe showed differential still helps a little with rotation (1.30-1.77% vs 2.56% SER for 2 sets).
- CPU: unchanged per symbol (16 x bands Goertzels). The cache holds R times more keys only if the
  sync search probes the body.

Test in under an hour (the single-band case needs no code change, which is what I ran):

```ts
const lin = (b, s) => Array.from({ length: 16 }, (_, i) => b + i * s)
const alt3 = { tones: lin(1000, 200), toneSets: [lin(1000, 200), lin(1000 + 200 / 3, 200), lin(1000 + 400 / 3, 200)], barSymbols: 1, symbolSeconds: 0.02 }
```

Add it to `PRESETS` locally and run
`npm run scorecard -- --trials 100 --preset alt3 --no-late --only reverb` (likewise `collision`,
`SNR`). Measured results for comparison:

| condition | fast | alt3 (3 sets, 200 Hz) | alt150 (2 sets, 150/75 Hz) | fastAlt (2 sets, 133.3 Hz) |
|---|---|---|---|---|
| reverb RT60 0.3 s | 75% | **91%** | 79% | 81% |
| reverb RT60 0.8 s | 87% | **99%** | 93% | 94% |
| collision 0 dB | 69% | **82%** | 79% | 79% |
| collision -6 dB | 100% | 95% | 96% | 96% |
| in-band SNR -6 dB | 89% | 100% | 71% | 32% |
| clean, 0 dB, drift 100/1000 ppm, 0.3 s silence | 100% | 100% | 100% | 100% |

For multi-band, apply the 20-line change and run `dual`/`tri`/`turbo` at a 48 kHz sim rate.

### 2.2 Soft inner code for collisions (proposal 4)

Format: body = RS(len + 4 + P) codeword as today. The codeword's bits go through a rate-1/2 K=7
convolutional encoder (polynomials 171/133 octal, 6 tail bits), are punctured to 2/3 (pattern
`[1 1; 1 0]`), then pass through a row-column block interleaver that spans the whole body. The
symbols are packed as today (`toSymbols`). The header stays a 3-copy vote and is not coded.

Decoder loop in `decodeBody(start, n)`:

1. For each body symbol and band, take scores `s_t` (plain or diff) normalized by total band
   energy. For each of the 4 bits, compute LLR =
   `lambda * (max over t with bit = 0 of s_t - max over t with bit = 1 of s_t)` (FT8's max-log
   demapper). Use Gray-coded tone order so a runner-up neighbor costs one bit. lambda is about
   20-40 (the best GMI lambda in the probe).
2. Deinterleave, depuncture (LLR 0 for punctured bits), soft Viterbi (64 states), output hard
   codeword bytes plus a per-byte reliability (the path metric difference).
3. Run RS errors-only first, then erasures from the Viterbi reliabilities as today, then the CRC.

New code: `src/conv.ts` with `convEncode(bits)` and `viterbi(llr)`, about 120 lines. Modem changes
are about 60 lines, behind `ModemOptions.inner?: 'conv23' | 'conv12'`.

Test in under an hour: a pure function harness, no audio first. Feed the symbol-level probe's score
vectors (collision 0 dB, `fast`) into demap + Viterbi + RS and count codeword successes against
hard-decision RS at the *same airtime* (soft r=2/3 + P=16 vs hard + P=16 + 1/3 more payload
replaced by parity). Only if that wins, wire it in and run the collision rows.

### 2.3 Spend the margin on speed (proposal 3)

Rotated `turbo` (dual band, 10 ms):

- Sets: `lin(1000, 266.7)` with offset 133.3 Hz, and `lin(5400, 266.7)` with the same offset.
  R = 2, T_win = 7.5 ms, so 1/T_win = 133.3 Hz.
- Spans 1.0-9.5 kHz. Same code as 2.1.
- Measured at symbol level, one band: SER 0.77% at RT60 0.3 s, 0.20% at 0.8 s. Today's `turbo`
  band: 3.7% / 3.4%.
- Expect `turbo`-class throughput (64-74 B/s depending on P) with reverb behavior at least as good
  as today's `fast`.

Rotated 15 ms `tri`:

- R = 2, 177.8 Hz spacing, 88.9 Hz offset; 3 x 2.84 kHz bands from 700 Hz to about 9.2 kHz.
- Symbol-level SER 1.8% / 1.0%.
- 117-byte frame with P = 32: 102 body symbols + 20 overhead = 1.83 s, about 64 B/s (**estimate**).

Test:

1. Change the scorecard's sim rate rule from "48 kHz only for ultrasonic" to "48 kHz when any tone
   is above 7 kHz". This also fixes a `tri` artifact (section 3).
2. Add a rolloff condition (for example a 2nd-order low-pass at 8 kHz, to model a weak phone
   tweeter).
3. Run the reverb, collision and SNR rows for `turbo`, rotated `turbo`, `tri` and rotated 15 ms
   `tri`.

The real gate is over the air: an iPhone and a laptop at 1 m and 3 m, same as
`benchmarks/OVER-THE-AIR.md`. A simulation cannot tell us whether 9 kHz survives a phone speaker.

## 3. Things we are probably doing wrong today

- **The same 16 bins every symbol** (`setFor` returns 0 for every non-music preset, and always for
  `bands > 1`). This is the main reverb cap; see 2.1. Differential detection is a partial
  workaround for a problem the tone plan creates.
- **Tone spacing is not the problem, and neither is the window.** Exact-bin spacing, Hann, and a
  later window were all measured: none helps. Leave `tonesAt` alone.
- **Hard decisions are thrown away where they matter: collisions.** `symbolAt` keeps the argmax.
  `confidenceAt` only ranks erasures. In collisions the runner-up is right 96-100% of the time, and
  nothing uses it.
- **Fixed 16-byte parity regardless of byte rate** (being fixed). Erasures also step by 4 and come
  only from confidence ranking. A silence hole competes with reverb-weak bytes for the same erasure
  budget (proposal 5).
- **The scorecard's in-band SNR depends on the tone span**: `addNoise` scales noise to the band
  `min tone - 200 .. max tone + 200`. Presets with different spans see different noise densities at
  the same "SNR".
  - 133.3 Hz spacing has 0.43 dB more noise density than 150 Hz at nominal -6 dB.
  - `fast` at -6.43 dB drops from 89% to 77% (measured), so the -6 dB rows sit on a cliff, and small
    span differences move them 10-60 points.
  - **Add an equal-noise-density row** (fixed absolute noise vs fixed peak amplitude) for comparing
    presets.
- **The SNR rows normalize to average power, not peak.** Real speakers are peak-limited, and
  `modulate` plays each tone at `0.8 / tones.length`. So `tri`'s per-tone power is 9.5 dB below a
  single tone at the same peak, while the scorecard credits 4.8 dB of that back. Multi-tone presets
  will do worse over the air than their SNR rows suggest. The same equal-density, equal-peak row
  covers this.
- **`tri` is simulated at 16 kHz with a 7950 Hz top tone.** Its image at 8050 Hz is 100 Hz away, and
  a 15 ms window leaks it at about -13.5 dB, so some of `tri`'s 53% at -6 dB may be a simulation
  artifact. Simulate any preset with tones above about 7 kHz at 48 kHz.
- **Reverb rows have high variance.** Per-room SER at RT60 0.3 s ranges from 0.2% to 11% (measured,
  30 rooms): frequency-selective fading from a static impulse response decides most outcomes. At 40
  trials `turbo` scored *better* at RT60 0.8 s than at 0.3 s. Use 200+ trials for reverb rows, or a
  fixed bank of room impulse responses so A/B comparisons share rooms.
- **No timing tracking after sync.** The guard is sym/8 on each side. That is fine for every current
  row (1000 ppm: 100%), but a 255-byte `turbo` frame drifts 2.75 ms at 1000 ppm against a 1.25 ms
  guard. Low priority; real device clocks are probably tens of ppm (**unverified**).
- **Preamble length is not the problem.** Sync loss rows are 100% except where the hole spills into
  the body past the parity budget (`turbo` 0.3 s "in sync" = 23 erased body bytes). It is a parity
  problem with a sync label.

## 4. What other systems do (short, with the lesson)

| System | What | Rate | Lesson |
|---|---|---|---|
| ggwave | 6 simultaneous tones, 4 bits each, 3 bytes per frame, 96 bins at 46.875 Hz over 4.5 kHz (F0 1875 Hz audible, 15 kHz ultrasonic), RS | 8-16 B/s (README) | Same family as `tri`. Our `dual`/`tri`/`turbo` already exceed it |
| Quiet (libquiet / liquid-dsp) | `audible`: GMSK + conv `v27`. `audible-7k-channel`: OFDM 48 subcarriers, CP 8, `arb16opt`, `v29` inner + `rs8` outer. `cable-64k`: QAM1024 OFDM | Not stated on the README; "7k" in the name | Soft conv inner + RS outer is the standard pairing. Fast profiles are OFDM and target cables or short range |
| LISNR Radius | Zone 66 (66.6 bps, walking pace), Zone 266, Point 1000/2000 (1-2 kbit/s, under 1 m, stationary) | 66-2000 bps | High rate comes only with near field and no motion. Plan an OFDM preset that way, if at all |
| Chirp (Arm white paper) | Real-world rates "in the hundreds of bits per second"; 1 cm to 100 m depending on rate | ~100s bps | Same ceiling as our MFSK family. Original Chirp.io tone details **unverified** |
| FT8 | 8-GFSK, LDPC(174,91), max-log soft demap, three Costas syncs | 77 bits / 15 s | The soft demapper formula used in 2.2 |
| JANUS | FH-BFSK over 13 tone pairs, conv r=1/2 K=9, interleaver | 80 bit/s | Hopping is the standard echo answer, and the measured win in 2.1 |
| MIL-STD-188-110, CCSDS | Conv K=7 r=1/2 + interleaver (+ RS outer) | 75-4800 bit/s | The inner code sketched in 2.2 |
| ARDOP / VARA | ARDOP: FSK/PSK/QAM, RS; ARDOP_3 Viterbi inner + RS. VARA: OFDM + turbo codes | Up to about 8.5 kbit/s (VARA, **unverified**) | HF radio channels with ms of delay spread, not 300 ms. Their rates don't transfer to rooms |
| minimodem | Bell 103 / 202 AFSK (300 / 1200 baud) | 300-1200 bit/s on a cable | Coherent-ish FSK at high baud fails in rooms. Nothing to adopt (**not re-checked**) |
| Underwater (Stojanovic; Chitre 2008) | Robust: noncoherent FSK + hopping + guard times. Fast: OFDM with long CP + Doppler resampling | bit/s to tens of kbit/s | Same split: hopping MFSK for reverb, OFDM only where delay spread fits in the CP |
| DVB MPE-FEC, ATSC 3.0 | CRC flags erasures for a cross-frame RS; LDPC per frame + RaptorQ across | Mbit/s | Already mirrored by CRC-32 + RLNC |

## 5. Sources

Fetched for this note:

- ggwave README, modulation and rates: https://github.com/ggerganov/ggwave
- Quiet profiles (modulation, OFDM, FEC per profile): https://raw.githubusercontent.com/quiet/quiet/master/quiet-profiles.json ; README: https://github.com/quiet/quiet
- LISNR Radius tone profiles: https://lisnr.com/ultrasonic-technology-overview-radius/
- Chirp / Arm data-over-sound white paper (from the search summary only, not fetched, **unverified** in detail): https://armkeil.blob.core.windows.net/developer/Files/pdf/white-paper/chirp-arm-data-over-sound.pdf

Carried over from `notes/fec-and-coding.md` (verified there, not re-checked here):

- FT8/FT4 QEX paper (max-log soft demap, LDPC, OSD): https://wsjt.sourceforge.io/FT4_FT8_QEX.pdf
- JANUS: https://www.researchgate.net/profile/John-Potter-3/publication/265594031_The_JANUS_underwater_communications_standard/links/547f1d880cf2d2200edeb8a1/The-JANUS-underwater-communications-standard.pdf
- MIL-STD-188-110B: https://hflink.com/standards/MIL_STD_188_110B.pdf
- CCSDS 131.0-B-5: https://ccsds.org/Pubs/131x0b5.pdf
- ARDOP spec: https://winlink.org/sites/default/files/downloads/_ardop_specification.pdf
- Stojanovic, underwater physical layer: https://stuff.mit.edu/people/millitsa/resources/pdfs/garmisch.pdf.pdf ; Chitre et al. 2008: https://arl.nus.edu.sg/wp-content/publications/Chitre2008b.pdf
- DVB MPE-FEC (EBU): https://tech.ebu.ch/docs/techreview/trev_301-dvb-h.pdf

Not verified from a primary source: VARA's codes and peak rate; minimodem's room performance;
original Chirp.io tone parameters; typical phone audio clock error in ppm; phone speaker response
above 9 kHz.

## Reproducing the measurements

- Frame-level rows: copy `benchmarks/scorecard.ts`, replace `PRESETS` in the preset loop with the
  definitions in 2.1, and run with `--trials 100 --no-late --only <condition>`.
- Symbol-level probe: about 150 lines.
  - Signal: random 4-bit symbols, continuous-phase tones, the scorecard's `reverb()` and an
    equal-power, sub-symbol-misaligned interferer for collisions, 20 dB in-band noise floor.
  - Detection: Goertzel over the middle 3/4 of each symbol at true timing.
  - Reported: SER, runner-up share, hard capacity `4 - H(p) - p log2 15`, and the soft GMI
    `4 + E[log2 softmax(lambda s)_true]`, maximized over lambda.
  - It lived in the session scratchpad; rewrite it from this description if needed.
