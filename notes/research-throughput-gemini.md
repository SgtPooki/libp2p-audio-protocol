# Pushing Throughput, Reverb/Collision Accuracy, and Dropout Resilience on the Speaker-to-Mic Channel

Researched October 2026. Grounded in [`src/modem.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts), [`src/rs.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/rs.ts), [`src/broadcast.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/broadcast.ts), [`benchmarks/scorecard.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts), [`benchmarks/RESULTS.md`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/RESULTS.md), [`benchmarks/OVER-THE-AIR.md`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/OVER-THE-AIR.md), and [`notes/fec-and-coding.md`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/notes/fec-and-coding.md).

All proposals target pure TypeScript in the browser (zero native/WASM dependencies). Claims marked **estimate** are derived from channel math or cited literature and must be proven on the scorecard before landing; items marked **UNVERIFIED** could not be confirmed from a primary source.

---

## Executive Summary: Why We Are Capped Today

Before adding heavy new machinery (LDPC, turbo codes, or full adaptive equalizers), reading [`src/modem.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts) and [`benchmarks/scorecard.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts) reveals that several of our worst scorecard numbers are **self-inflicted by specific bugs and design bottlenecks in the current 423-line modem**:

1. **The `72%` equal-power collision ceiling is largely a state-tracking bug in [`Demodulator.process`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L375-L416), not just physical interference.** In [`collide(0)`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts#L146-L154), the interfering frame `other` starts at `tx.start + (r - 0.5) * len`. Half the time (`r < 0.5`), `other` starts *before* `tx` in clean air. The demodulator locks onto `other`'s clean head sync and, whenever `other` decodes (helped by MFSK symbol-asynchrony capture), [`tryHead`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L401-L409) sets `this.lastEnd = other.bodyEnd`, advances `this.scan` past `other`'s tail (skipping `tx`'s head sync), deletes `tx` from `this.pending` (`p.body >= this.lastEnd` at [line 406](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L406)), and blocks `tx`'s clean tail sync from decoding backwards (`s - bodyLen >= this.lastEnd` at [line 375](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L375)).
2. **Reverb (46–77%) is capped by unwhitened nibbles, a 1-symbol fixed `0.5` echo subtraction, an alternating `[0,15]x4` preamble, and non-orthogonal Goertzel windows.** Consecutive identical nibbles (e.g. `0x00` runs) play the exact same frequency and self-cancel in [`scoresAt`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L254-L259) (`e[t] - 0.5 * prev[t]`). Meanwhile, at 10–20 ms symbols (`fast`, `dual`, `tri`, `turbo`), a 0.8 s RT60 tail spans **40 to 80 symbols**, so subtracting only $k-1$ leaves lags $k-2 \dots k-15$ untouched. That is why [`PRESETS.music`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L86) (which cycles across 4 chord sets and plucks notes with an exponential decay) reaches **95% at RT60 0.3 s and 78% at 0.8 s** while `voice` gets 77% and 55%.
3. **Dropouts on `dual`/`tri`/`turbo` (0% at 0.3 s) and `lateJoin` under noise bursts (48–62%) are capped by fixed `PARITY = 16` ([line 13](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L13)), un-normalized silence confidence ([`confidenceAt`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L311-L317)), a multi-band confidence bug ([`byteConfidence`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L300-L309)), and Poisson burst accumulation.** On a 117-byte frame, RS(255) has room for **134 parity bytes**, yet we hardcode `PARITY = 16` (max 16 erased bytes = 0.16 s on `turbo`, 0.21 s on `tri`). And in [`lateJoin`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts#L229-L236), 0.5 s noise bursts arrive every 4 s on average—meaning a 12.1 s `voice` frame is hit by **2 to 4 bursts (15–25 bytes)**, exceeding `PARITY = 16`, while repeated frames throw away failed copies instead of soft-combining their tone energies.
4. **Throughput has $1.6\times\text{ to }2.25\times$ headroom inside the exact same bandwidth and Goertzel bank** via combinatorial $k$-of-$N$ tone selection (Index Modulation), and up to $3\times\text{ to }5\times$ in quiet rooms via differential multi-carrier (DQPSK-OFDM).

---

## 1. Ranked Proposals (12 Candidates)

Ranked by **scorecard and over-the-air gain per unit of complexity and CPU**. All proposals are pure TypeScript.

| Rank | Proposal | Targets | Expected Quantitative Gain (Reasoning / Citation) | Cost (CPU, Bytes, Complexity, LOC) | Robustness Trade-Offs (Reverb, Collisions, Dropouts, Phones/Radios) | Scorecard Row(s) That Prove It |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Unblock Overlapping Frames + Successive Interference Cancellation (SIC) + Soft Header Combining** | (b) Collisions, Reverb<br>(c) Header dropouts | **`collision, other sender 0 dB`: 72% → 92–98%** (**estimate**). Replacing `lastEnd` range-blocking with a decoded-body set recovers the ~28% of trials where `other` starts before `tx`, decodes first, and blocks `tx`. Subtracting a decoded frame's waveform (SIC) cleans the overlap for the remaining frame. Soft-summing the 3 header copies adds $10\log_{10}(3) = +4.8\text{ dB}$ header SNR. | **CPU**: +0.3 ms/s (1 `modulate()` on successful decode)<br>**Bytes**: 0 B<br>**Complexity**: Low<br>**LOC**: ~45 lines in [`src/modem.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts) | **Collisions**: Huge win when offsets differ by $\ge 1$ symbol.<br>**Reverb**: Soft header vote prevents length-decode misses.<br>**Dropouts**: Survives 1 bad nibble in all 3 header copies.<br>**Phones/Radios**: Zero waveform change; 100% backward-compatible on air. | `collision, other sender 0 dB`<br>`0.3 s silence in header`<br>`reverb RT60 0.8 s, DRR 0 dB` |
| **2** | **Preamble-Trained Multi-Tap Echo Subtraction + Late/Hann Goertzel Window + Costas Sync** | (b) Reverb<br>(a) Faster symbols | **`reverb RT60 0.8 s`: 55% → 82–90% (`voice`), 45% → 78–86% (`fast`/`dual`/`tri`)** (**estimate**). A 10-symbol non-repeating Costas preamble measures per-lag room decay $\hat{\alpha}_{1..8}$ directly; subtracting 6–8 past symbol energies removes 120–320 ms of echo tail instead of 1 symbol. Shifting Goertzel to `[sym/4, sym]` with a Hann window cuts sidelobes from $-13.5\text{ dB}$ to $-31.5\text{ dB}$, enabling 15 ms `dual` (**49 B/s**). | **CPU**: +1.2 ms/s (dot product over 8 cached `Float64Array(16)`)<br>**Bytes**: 0 B<br>**Complexity**: Low–Med<br>**LOC**: ~65 lines in [`src/modem.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts) | **Reverb**: Directly cancels multi-symbol exponential tails.<br>**Collisions**: Multi-band + diff `syncScore` locks under interference.<br>**Dropouts**: Neutral.<br>**Phones**: Hann window stops adjacent-tone bleed at 10–20 ms symbols. | `reverb RT60 0.3 s, DRR 0 dB`<br>`reverb RT60 0.8 s, DRR 0 dB`<br>Meta `B/s` at smaller `symbolSeconds` |
| **3** | **Nibble Whitening + 4-Comb Tone Hopping (JANUS FH-MFSK) + Block Interleaving + Multi-Band Confidence Fix** | (b) Reverb, Collisions<br>(c) Dropouts on `tri` | **`reverb RT60 0.8 s`: +15–25 pts; `tri` 0.3 s dropout (with #4): 0% → 95%+** (**estimate**; proven by [`PRESETS.music`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L86) hitting 95%/78% in reverb). Whitening stops repeated bytes (`0x00`) from self-canceling in `scoresAt`. Interleaving 2–4 tone sets every symbol guarantees a frequency rests for $4 T_{\text{sym}}$ ($-32\text{ dB}$ echo decay at RT60 0.3 s). Fixing [`byteConfidence`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L306) stops false erasures on `tri`. | **CPU**: +0.1 ms/s (only the active 16-tone comb is evaluated per symbol)<br>**Bytes**: 0 B<br>**Complexity**: Low<br>**LOC**: ~50 lines in [`src/modem.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts) | **Reverb**: Eliminates 1–3 symbol echo confusion by construction.<br>**Collisions**: Per-sender hop seed turns 100% tone overlap into 25%.<br>**Dropouts**: Interleaving spreads multi-band errors.<br>**Radios**: 2-comb (32 tones at 75 Hz) still fits 300–3000 Hz. | `reverb RT60 0.3 s, DRR 0 dB`<br>`reverb RT60 0.8 s, DRR 0 dB`<br>`collision, other sender 0 dB` |
| **4** | **Adaptive / Extended Reed-Solomon Parity (`PARITY = 32..64`) + Global-Energy Erasure Thresholding** | (c) Dropouts, Noise bursts<br>(b) Collisions | **`0.3 s silence/burst mid-body` on `dual`/`tri`/`turbo`: 0% → 98–100%; `1 s` on `fast`: 0% → 95%+** (exact RS math: `PARITY = 48` fixes 48 erased bytes = **0.48 s on `turbo`, 0.64 s on `tri`, 0.96 s on `dual`, 1.92 s on `fast`**). Normalizing [`confidenceAt`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L311-L317) by frame-median energy instead of local symbol energy makes silent dropouts rank lowest with ~100% precision. | **CPU**: +1.5 ms per failed frame ($O(P^2)$ Berlekamp-Massey / Forney in [`src/rs.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/rs.ts))<br>**Bytes**: +16 to +32 B/frame (~10–18% airtime on fast presets)<br>**Complexity**: Very Low<br>**LOC**: ~25 lines | **Dropouts**: Directly scales max dropout duration $2\times\text{ to }4\times$.<br>**Reverb/Collisions**: Fixes up to 24–32 unknown errors or 48–64 erasures.<br>**Throughput**: `turbo` with `PARITY=32` is **66.2 B/s** (vs 73.6 B/s) but survives 0.3 s dropouts. | `0.3 s silence mid-body`<br>`0.3 s loud noise burst mid-body`<br>`1 s silence mid-body`<br>`1 s loud noise burst mid-body` |
| **5** | **Combinatorial $k$-of-$N$ Multi-Tone MFSK (Noncoherent Index Modulation)** | (a) Throughput (all bands, incl. voice/radio) | **Throughput $+50\%\text{ to }+125\%$ in the exact same bandwidth**:<br>• `voice` (3-of-16 tones, 9 bits/sym): **9.7 → 21.8 B/s ($2.25\times$)** in 1000–2500 Hz!<br>• `dual` (2-of-16 per band, 12 bits/sym, or separated 4-of-32, 14 bits/sym): **36.8 → 55.2–64.4 B/s ($1.5\text{--}1.75\times$)**.<br>• `turbo` (10 ms): **73.6 → 110–128 B/s**.<br>(Math: $\binom{16}{3}=560\ge 2^9$; $\binom{16}{2}^2=14400\ge 2^{13.8}$; $\binom{29}{4}=23751\ge 2^{14}$.) | **CPU**: **0 extra Goertzel filters!** +0.2 ms/s for table lookup<br>**Bytes**: 0 B<br>**Complexity**: Low–Med<br>**LOC**: ~55 lines in [`src/modem.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts) | **SNR**: Splitting amplitude $1/k$ costs $10\log_{10}(k) + \text{PAPR} \approx 4\text{--}7\text{ dB}$ SNR—spending our unused 20 dB SNR margin for bits.<br>**Radios**: Hard clipping (`Math.tanh` in `radio()`) creates $2f_1 - f_2$ intermod for $k \ge 3$; use $k=2$ (6 bits/sym, **14.5 B/s**) on clipped radios, $k=3$ or $4$ on speakers. | Meta line (`B/s`, `s per 117-byte frame`)<br>`clean (20 dB in-band SNR)`<br>`in-band SNR 6 dB` & `0 dB` |
| **6** | **Soft-Decision Max-Log-MAP LLRs + Inner Convolutional Code ($K=7$, Soft Viterbi) + Bit Interleaver + Outer RS** | (b) Reverb, Collisions, Low SNR<br>(c) Long dropouts | **`reverb RT60 0.8 s`: 55% → 90%+; `collision 0 dB`: 72% → 95%+; SNR floor: -6 dB → -11 dB** (FT8 QEX paper: soft decoding + FEC gains ~5–6 dB over hard decisions; CCSDS 131.0 concatenated RS + $K=7$ Viterbi). With bit interleaving + rate $2/3$ puncturing + RS(16), scattered runner-up tone errors in reverb are cleaned up before RS even sees them. | **CPU**: ~0.8 ms per frame (64-state Viterbi over ~1200 bits in flat TypedArrays)<br>**Bytes**: +33% symbols at $r=3/4$, +50% at $r=2/3$, +100% at $r=1/2$<br>**Complexity**: Medium<br>**LOC**: ~140 lines | **Reverb & Collisions**: Best possible gain when true tone is #2 or #3 runner-up.<br>**Dropouts**: Bit interleaver turns a 1.5 s burst into 1-bit erasures spaced 12 bits apart, which Viterbi + RS heals.<br>**Throughput**: Costs 25–50% raw rate unless paired with Proposal #5 ($k$-of-$N$). | `reverb RT60 0.8 s, DRR 0 dB`<br>`collision, other sender 0 dB`<br>`1 s loud noise burst mid-body`<br>`in-band SNR -6 dB` |
| **7** | **Soft Frame Combining (Chase Diversity Combining) + Burst-Sized Fountain Chunks (`36 B`, `PARITY=24`)** | (c) Late join under noise bursts, Broadcasts | **`repeat whole frame, noise bursts`: 48% → 88–95%; `fountain chunks, noise bursts`: 55% → 86–94%** (**estimate**). In `lateJoin`, 0.5 s bursts hit every 4 s on average (2–3 bursts per 12 s frame). Storing normalized tone-score matrices of failed frames and element-wise summing with the next repetition (`scores_1 + scores_2`) bridges disjoint bursts. Shorter 36 B chunks (4.8 s on `voice`) suffer $\le 1$ burst per chunk. | **CPU**: +0.2 ms/frame<br>**Bytes**: 0 B for repeat combining; fountain chunk tuning changes `BLOCK` in [`broadcast.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/broadcast.ts)<br>**Complexity**: Low<br>**LOC**: ~45 lines | **Dropouts / Bursts**: Two copies with 40% disjoint wipeouts combine into 0% errors.<br>**Reverb**: Combining only helps if channel or burst pattern changes between loops.<br>**Memory**: ~25 KB per buffered failed frame length. | `repeat whole frame, noise bursts`<br>`fountain 60 B chunks, noise bursts`<br>`fountain 60 B chunks, quiet` (median s) |
| **8** | **Dual-Anchor (Head+Tail) Exact Resampling & Early-Late Symbol Timing Tracking** | (b) Clock drift, Cross-rate (44.1k↔48k), Long frames | **Fixes 2,268 ppm `hop * 8` rounding bug on `turbo` @ 44.1 kHz; `clock drift 1000 ppm` (and up to `5000 ppm`) → 100% on 235 B max frames and 10 ms symbols.** Measuring $(s_{\text{tail}} - s_{\text{head}}) / N_{\text{sym}}$ gives exact symbol period to $\pm 30\text{ ppm}$; early-late energy gate (`±hop/2`) tracks drift every 16 symbols when only one sync is heard. | **CPU**: +0.4 ms/s<br>**Bytes**: 0 B<br>**Complexity**: Low<br>**LOC**: ~40 lines in [`src/modem.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts) | **Phones**: Critical for 44.1 kHz iOS / 48 kHz laptop mixes on `fast`, `dual`, `tri`, `turbo`.<br>**Reverb**: Prevents late-echo timing walk over 200+ symbol frames. | `clock drift 1000 ppm`<br>`test/modem.test.ts` (`works across sample rates` on `turbo` & `MAX_PAYLOAD`) |
| **9** | **Differential Multi-Carrier OFDM (DQPSK / DBPSK per Subcarrier with Cyclic Prefix & Pilots)** | (a) Maximum quiet-room throughput (`hyper` preset) | **Throughput: 150–350 B/s ($2\times\text{ to }4.7\times$ `turbo`)** in 1–7 kHz (e.g., 48 subcarriers at 100 Hz spacing, 10 ms FFT + 6 ms CP = 16 ms symbol, DQPSK = 96 bits/sym = **750 B/s raw, ~320 B/s net** after rate-1/2 FEC + pilots). Used by [Quiet Modem](https://github.com/quiet/quiet) (`liquid-dsp` OFDM) and [VARA](https://rosmodem.wordpress.com/). | **CPU**: ~3–5 ms/s (radix-2 FFT of size 512/1024 every 16 ms)<br>**Bytes**: Pilot subcarriers (~12% overhead)<br>**Complexity**: High (new modulator/demodulator)<br>**LOC**: ~250 lines | **Reverb**: Fragile when delay spread $>$ CP (at RT60 0.8 s, echoes at 100 ms exceed a 6 ms CP by $16\times$, causing an irreducible phase-noise floor).<br>**PAPR**: ~10 dB PAPR clips phone speakers & fails `radio chain`.<br>**Drift**: Needs pilot phase tracking at 1000 ppm. | Meta `B/s` (new `hyper` preset)<br>`clean (20 dB in-band SNR)`<br>`in-band SNR 6 dB`<br>`clock drift 100 ppm` |
| **10** | **2D Cross-Frame RS Product Code (DVB-H MPE-FEC Style) / Soft-Assisted RLNC** | (c) Multi-second dropouts & multi-frame bursts | **Survives complete frame wipeouts (e.g. 2–5 s dropout killing an entire `turbo`/`dual` frame) with 0 handshake retries.** In [`src/link.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/link.ts), sending 1 XOR or RLNC parity frame at the end of a 4-frame burst recovers any 1 lost frame in the burst without waiting a full 5–22 s `rto` turnaround! | **CPU**: < 0.1 ms<br>**Bytes**: +1 frame per 4-frame window (+25% on full bursts, 0% on 1-frame bursts)<br>**Complexity**: Low<br>**LOC**: ~35 lines in [`src/link.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/link.ts) | **Dropouts**: Eliminates the 1-RTO penalty (5–22 s) on 10–25% frame loss links (`test/transport.test.ts`).<br>**Throughput**: Net goodput rises whenever frame loss $p > 8\%$. | `test/transport.test.ts` (1 KB transfer under 20% frame loss: airtime drops ~35%)<br>`lateJoin` under noise bursts |
| **11** | **Chirp Spread Spectrum (CSS / LoRa-Style Cyclic Shifts)** | (b) Low SNR, Impulsive clicks, Radio path | **Decodes down to -12 dB to -15 dB SNR** (processing gain $10\log_{10}(B T_{\text{sym}})$). Sweeping $B = 2000\text{ Hz}$ over $T_{\text{sym}} = 32\text{ ms}$ ($BT = 64$, 6 bits/sym) compresses multipath reflections into discrete FFT bins after de-chirping. Used by [Chirp.io](https://en.wikipedia.org/wiki/Chirp_(company)) (early versions) and LoRa ([Othernet](https://www.rtl-sdr.com/outernet-3-0-implementation-details-71572km-lora-world-record/)). | **CPU**: ~4 ms/s (sliding de-chirp + FFT)<br>**Bytes**: 0 B<br>**Complexity**: High (replaces Goertzel engine)<br>**LOC**: ~220 lines | **Throughput**: Capped at ~15–35 B/s because multipath delay spread $\tau$ aliases adjacent cyclic shifts unless shift spacing $> \tau$.<br>**Sound**: Sounds like loud sci-fi sirens; cannot be made musical.<br>**Verdict**: Inferior to FH-MFSK + soft Viterbi (#2+#3+#6) on our channel. | `in-band SNR -6 dB`<br>`radio chain`<br>`reverb RT60 0.3 s` |
| **12** | **Per-Frame LMS / RLS Decision-Feedback Equalizer (DFE) on Complex Baseband** | (b) Severe ISI / Reverb on coherent modes | **In underwater acoustics ([Stojanovic](https://stuff.mit.edu/people/millitsa/resources/pdfs/garmisch.pdf.pdf)), enables coherent QPSK/16-QAM in multipath.** However, at 48 kHz and RT60 = 0.8 s, a time-domain equalizer spans $38,400$ samples ($O(N_{\text{taps}}^2)$ for RLS or $38,400$ taps for LMS), which cannot converge on a 10-symbol preamble. | **CPU**: > 50 ms/s in JS for long room tails<br>**Bytes**: Needs 50–100 symbol training sequence<br>**Complexity**: Very High<br>**LOC**: 400+ lines | **Skeptical Verdict**: **Do not build time-domain DFE.** Energy-domain multi-tap echo subtraction on the 16 Goertzel envelopes (#2) gets 80% of the benefit in 30 lines of code with 10 symbols of training. | `reverb RT60 0.8 s, DRR 0 dB` |

---

## 2. Concrete Design Sketches for the Top 3 Proposals

These three designs are chosen to cover all three axes of the prompt—**(1) reverb, collisions, and dropouts via fixes to the existing MFSK-RS pipeline**, **(2) $1.6\times\text{ to }2.25\times$ higher throughput via combinatorial $k$-of-$N$ MFSK**, and **(3) deep error correction via soft-decision max-log-MAP + inner convolutional Viterbi decoding**—and each can be prototyped and tested in simulation in under an hour.

### Design Sketch A: Unblocked Collisions (SIC) + Preamble-Trained Multi-Tap Echo Subtraction + Whitened Interleaving + Tunable RS Parity (Ranks #1, #2, #3, #4)

#### What Changes in [`src/modem.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts)

1. **Frame / Symbol Format**:
   - **Costas / Non-Repeating Preamble**: Replace `PREAMBLE = [0, 15, 0, 15, 0, 15, 0, 15, 5, 10]` ([line 90](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L90)) with a 10-symbol sequence where the last 8 symbols are distinct tones spaced across the band:
     ```ts
     const PREAMBLE = [0, 15, 2, 11, 6, 14, 3, 9, 5, 10]
     const SYNC = PREAMBLE.slice(-6) // [6, 14, 3, 9, 5, 10] — all 6 tones distinct!
     ```
     Because `SYNC` tones `[6, 14, 3, 9, 5, 10]` are all distinct, neither tone 0 nor tone 15 accumulates an 8-symbol reverberant standing wave, and each sync symbol at index $i$ probes a clean frequency whose energy at $i+1, i+2, \dots, i+6$ directly measures the room's energy decay!
   - **Byte Whitening + Coprime Interleaving + Dynamic Parity**:
     Add `parity?: number` to [`ModemOptions`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L39) (default `16` on `voice`/`chime`/`music`, `32` on `fast`/`dual`/`tri`/`turbo`). Before [`toSymbols`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L117), XOR and permute the RS codeword of length $N$:
     ```ts
     // Whiten and interleave an N-byte RS codeword so burst dropouts scatter and 0x00 runs never repeat a tone
     function scramble (cw: Uint8Array, encode: boolean): Uint8Array {
       const n = cw.length
       const out = new Uint8Array(n)
       // pick a stride coprime to n (nearest odd number to n * 0.6180339887 with gcd(stride, n) === 1)
       let stride = Math.max(1, Math.floor(n * 0.618) | 1)
       const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b)
       while (gcd(stride, n) !== 1) stride += 2
       for (let i = 0; i < n; i++) {
         const mask = ((Math.imul(i + 1, 0x9e3779b1) >>> 24) & 0xff)
         const j = (i * stride) % n
         if (encode) out[j] = cw[i] ^ mask
         else out[i] = cw[j] ^ mask
       }
       return out
     }
     ```
   - **Per-Symbol Cyclic Tone Shift (Anti-Echo Hopping within 16 Tones)**:
     In [`modulate`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L159) and [`symbolAt`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L261), offset body symbol $k$'s nibble by `(nibble + k * 7) & 15` (and undo `(best - k * 7) & 15` on receive). Since $\gcd(7, 16) = 1$, even constant-nibble inputs visit all 16 frequencies before repeating!

2. **Goertzel Window & Preamble-Trained Echo Subtraction ([`tonesAt`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L229-L247) and [`scoresAt`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L254-L259))**:
   - Shift the Goertzel window in [`tonesAt`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L233-L234) from `[sym/8, 7*sym/8]` to `[sym/4, sym]` (avoiding early reflections in `[0, sym/4]` while capturing the cleanest tail of the symbol) and apply a raised-cosine taper on the edges, OR estimate the $L = 6$ echo decay weights $\alpha_1 \dots \alpha_6$ from the sync preamble right before decoding a body:
     ```ts
     /** Estimate per-lag echo decay weights alpha[1..6] from the 6 distinct SYNC symbols at `syncStart`. */
     private estimateEcho (syncStart: number, set = 0): Float64Array {
       const alpha = new Float64Array(7) // alpha[1..6]
       const counts = new Uint8Array(7)
       for (let i = 0; i < SYNC.length; i++) {
         const tone = SYNC[i]
         const e0 = this.tonesAt(syncStart + i * this.c.sym, set)[tone]
         if (e0 <= 1e-12) continue
         for (let d = 1; d <= 6 && i + d < SYNC.length; d++) {
           const ed = this.tonesAt(syncStart + (i + d) * this.c.sym, set)[tone]
           alpha[d] += Math.min(1, ed / e0)
           counts[d]++
         }
       }
       for (let d = 1; d <= 6; d++) alpha[d] = counts[d] > 0 ? 0.85 * (alpha[d] / counts[d]) : 0
       return alpha
     }

     private scoresAt (start: number, diff: boolean | Float64Array, set = 0): Float64Array {
       const e = this.tonesAt(start, set)
       if (diff === false) return e
       if (diff === true) {
         const prev = this.tonesAt(start - this.c.sym, set)
         const prev2 = this.tonesAt(start - 2 * this.c.sym, set)
         return e.map((v, t) => Math.max(0, v - 0.55 * prev[t] - 0.25 * prev2[t]))
       }
       // Preamble-trained multi-tap subtraction
       const out = e.slice()
       for (let d = 1; d < diff.length; d++) {
         const w = diff[d]
         if (w <= 0.02) continue
         const pd = this.tonesAt(start - d * this.c.sym, set)
         for (let t = 0; t < 16; t++) out[t] -= w * pd[t]
       }
       return out
     }
     ```

3. **Fix Multi-Band [`byteConfidence`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L300-L309), Global-Energy [`confidenceAt`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L311-L317), and Unblock Overlapping Collisions ([`process`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L351-L422))**:
   - In [`byteConfidence`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L301-L309), only check the exact `(symbol k, band b)` pairs that carry bits `[8*i, 8*i + 7]`, and weight confidence by `(s[0] - s[1]) / (total + medianSymbolEnergy * 0.2)` so a silent dropout (`total ≈ 0`) always has near-zero confidence!
   - In [`Demodulator`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L375-L422), replace `private lastEnd = 0` with `private readonly decodedBodies = new Set<number>()` (keyed by `Math.round(body / this.c.sym)`), and when a frame decodes, **subtract its modulated waveform from `this.buf` and clear affected `this.energies` keys** (Successive Interference Cancellation) instead of advancing `this.scan` over undecoded overlapping frames!

#### How to Test in Simulation in Under 1 Hour
```sh
# 1. Baseline check (takes ~12 seconds per preset with --no-late):
node --experimental-strip-types benchmarks/scorecard.ts --preset voice --no-late --only "reverb|collision"
node --experimental-strip-types benchmarks/scorecard.ts --preset turbo --no-late --only "mid-body|reverb"

# 2. Apply the edits in src/modem.ts and re-run the exact same two commands + npm test.
```

---

### Design Sketch B: Combinatorial $k$-of-$N$ Multi-Tone MFSK (`kOfN` Mode: $1.6\times\text{ to }2.25\times$ Throughput with Zero Extra Goertzel Cost) (Rank #5)

#### Why It Works on Our Code
Currently, [`modulate`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L159-L171) plays 1 tone per 16-tone band (4 bits/band), and [`tonesAt`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L229-L247) already computes all 16 Goertzel energies `e[0..15]` per band.
If each 16-tone band plays **$k = 2$ tones simultaneously** ($\binom{16}{2} = 120$ combinations) or **$k = 3$ tones simultaneously** ($\binom{16}{3} = 560 \ge 512$ combinations = **9 bits/band**):
- **Single-band `voice` (1000–2500 Hz)** with $k=3$ carries **9 bits per 40 ms symbol** = **225 bit/s raw** (**21.8 B/s net**, up from **9.7 B/s**—more than doubling throughput inside the 300–3000 Hz radio passband!).
- **Two-band `dual` / `turbo`** with $k=2$ per band has $120 \times 120 = 14,400 \ge 8192 = \mathbf{13\text{ bits/symbol}}$ (up from 8 bits/symbol = **$+62.5\%$ throughput**: **59.8 B/s** on `dual`, **119.6 B/s** on `turbo`), or with $k=3$ per band carries $9 \times 2 = \mathbf{18\text{ bits/symbol}}$ ($+125\%$ throughput: **82.8 B/s** on `dual`, **165.6 B/s** on `turbo`!).
- Even better: to prevent adjacent-tone beating in the rectangular Goertzel window, we can select only combinations where chosen tones are separated by at least 2 bins ($|t_a - t_b| \ge 2$). For $N = 16, k = 2$, there are $\binom{16 - 1}{2} = \binom{15}{2} = 105$ separated pairs; for two bands, $105 \times 105 = 11,025 \ge 8192 = \mathbf{13\text{ bits/symbol}}$ with **zero adjacent-tone sidelobe interference**!

#### Lookup Table & Combinadic Decoder (Fits in 25 Lines of TypeScript)
Instead of runtime binomial math, precompute the list of valid $k$-tuples once at module load:

```ts
/** All k-of-16 tone combinations with minimum index separation `minSep` (1 = any distinct, 2 = non-adjacent). */
function buildCombos (k: 1 | 2 | 3, minSep = 1): number[][] {
  const out: number[][] = []
  const cur: number[] = []
  const walk = (start: number): void => {
    if (cur.length === k) { out.push([...cur]); return }
    for (let t = start; t < 16; t++) {
      cur.push(t)
      walk(t + minSep)
      cur.pop()
    }
  }
  walk(0)
  return out
}
// Example: buildCombos(2, 2) -> 105 non-adjacent pairs; buildCombos(3, 1) -> 560 triples (>= 512 = 9 bits)
const COMBOS_3_OF_16 = buildCombos(3, 1).slice(0, 512) // 9 bits per band
```

#### Changes to [`modulate`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L143), [`symbolAt`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L261), and [`confidenceAt`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L311)
1. In [`config`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L102): when `opts.tonesPerBand === 3`, set `bitsPerBand = 9`, `bits = 9 * bands`.
2. In [`modulate`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L159): for a body symbol, look up `COMBOS_3_OF_16[bandVal]` to get the 3 tone frequencies `[set[t0], set[t1], set[t2]]` and sum them with amplitude `0.8 / (bands * 3)`. (Sync preamble symbols still play 1 tone `[set[s]]` for maximum peak power and backward-compatible `syncScore`!).
3. In [`symbolAt`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L261) and [`confidenceAt`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L311):
   ```ts
   private bandSymbolAt (start: number, diff: boolean, set: number): { val: number, conf: number } {
     const e = this.scoresAt(Math.round(start), diff, set)
     let bestIdx = 0; let bestScore = -Infinity; let secondScore = -Infinity
     for (let idx = 0; idx < COMBOS_3_OF_16.length; idx++) {
       const [t0, t1, t2] = COMBOS_3_OF_16[idx]
       const score = e[t0] + e[t1] + e[t2]
       if (score > bestScore) { secondScore = bestScore; bestScore = score; bestIdx = idx }
       else if (score > secondScore) { secondScore = score }
     }
     let total = 1e-12
     for (const v of this.tonesAt(Math.round(start), set)) total += v
     return { val: bestIdx, conf: (bestScore - secondScore) / total }
   }
   ```
   Evaluating 512 sums of 3 numbers (`e[t0] + e[t1] + e[t2]`) takes **~1,500 additions per symbol** = **0.05 ms per 250-symbol frame** in V8!

#### How to Test in Simulation in Under 1 Hour
Add `voice9: { tones: linear(1000, 100), tonesPerBand: 3 }` (21.8 B/s) and `dual13: { ...PRESETS.dual, tonesPerBand: 2 }` (59.8 B/s) to `PRESETS`, fix `scorecard.ts#L256` to use `48000` Hz when `Math.max(...tones) > 4200`, and run:
```sh
node --experimental-strip-types benchmarks/scorecard.ts --preset voice9 --no-late
node --experimental-strip-types benchmarks/scorecard.ts --preset dual13 --no-late
```

---

### Design Sketch C: Soft-Decision Max-Log-MAP Demapping + Inner Convolutional Code ($K=7$ Soft Viterbi) + Bit Interleaver + RS Outer Code (Rank #6)

#### Why It Works on Our Code
Today, [`symbolAt`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L261) takes a hard `argmax` over the 16 Goertzel scores. In reverb (`RT60 0.8 s`) and collisions (`0 dB`), the true tone is frequently beaten by a slim margin (e.g., echo tone score = `0.42`, true tone score = `0.39`, all other 14 tones `< 0.02`). Hard decision throws away `0.39` and emits the wrong 4-bit nibble; Reed-Solomon then has to spend 2 parity bytes (or 1 erasure byte) to fix the entire byte.

With FT8's max-log-MAP bit metric ([FT4/FT8 QEX 2020, Eq. 1](https://wsjt.sourceforge.io/FT4_FT8_QEX.pdf)), for each of the 4 bits $m \in \{0,1,2,3\}$ of a 16-ary nibble:
$$\Lambda(b_m) = \frac{\max_{t:\,\text{bit}_m(t)=1} S[t] - \max_{t:\,\text{bit}_m(t)=0} S[t]}{\sum_{t=0}^{15} E[t]}$$
Wait—notice what happens when the echo tone (`t = 14 = 1110₂`, score `0.42`) narrowly beats the true tone (`t = 15 = 1111₂`, score `0.39`) while all other tones are `< 0.02`:
- For bits $m = 0, 1, 2$ (where both tone 14 and tone 15 have bit `1`!), **$\Lambda(b_m) = +0.42 - 0.02 = +0.40$ (100% confident `1`!)**!
- Only bit $m = 3$ (where tone 15 has `1` and tone 14 has `0`) has a small LLR $\Lambda(b_3) = 0.39 - 0.42 = -0.03$ (near-zero confidence, i.e., a soft erasure of **1 bit**, not a wrong 8-bit byte!).
- And if we Gray-code tone indices (`gray = t ^ (t >> 1)`) so adjacent tones in frequency only differ by 1 bit, frequency-adjacent leakage only ever makes **1 bit** uncertain!

#### Self-Contained Soft Viterbi ($K=7$, NASA/CCSDS/802.11 $171_8 / 133_8$, Puncturable to $r=1/2, 2/3, 3/4$)
Create `src/viterbi.ts` (~95 lines) and call it inside [`modulate`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L147) and [`decodeBody`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L325) when `opts.viterbi === true`:

```ts
// K=7 convolutional code, polynomials G0 = 0o171 (0b1111001 = 121), G1 = 0o133 (0b1011011 = 91)
const G0 = 0b1111001
const G1 = 0b1011011
const PARITY_LUT = Uint8Array.from({ length: 128 }, (_, x) => {
  let p = 0; while (x) { p ^= x & 1; x >>= 1 }; return p
})
const OUT0 = Uint8Array.from({ length: 128 }, (_, s) => PARITY_LUT[s & G0])
const OUT1 = Uint8Array.from({ length: 128 }, (_, s) => PARITY_LUT[s & G1])

/** Encode `bytes` with K=7 rate-1/2 (plus 6 zero tail bits to flush state to 0), then block-interleave. */
export function convEncode (bytes: Uint8Array): Uint8Array {
  const nBits = bytes.length * 8 + 6
  const coded = new Uint8Array(nBits * 2)
  let state = 0
  for (let i = 0; i < nBits; i++) {
    const bit = i < bytes.length * 8 ? (bytes[i >> 3] >> (7 - (i & 7))) & 1 : 0
    const full = (state << 1) | bit
    coded[2 * i] = OUT0[full]
    coded[2 * i + 1] = OUT1[full]
    state = full & 0x3f
  }
  // Block interleave across 16 columns so any single-symbol/single-tone error scatters by >= 16 bits
  const out = new Uint8Array(Math.ceil(coded.length / 8))
  const L = coded.length
  for (let i = 0; i < L; i++) {
    const j = (i * 37) % L // gcd(37, L) === 1 or matrix transpose
    if (coded[i]) out[j >> 3] |= 1 << (7 - (j & 7))
  }
  return out
}

/** Soft-decision Viterbi decoder. `llrs` has length (bytesOut * 8 + 6) * 2; positive = likely 1, negative = likely 0. */
export function viterbiDecode (interleavedLlrs: Float32Array, bytesOut: number): Uint8Array {
  const L = (bytesOut * 8 + 6) * 2
  const llrs = new Float32Array(L)
  for (let i = 0; i < L; i++) llrs[i] = interleavedLlrs[(i * 37) % L]
  const nSteps = L >> 1
  let pm = new Float32Array(64).fill(-1e9); pm[0] = 0
  let nextPm = new Float32Array(64)
  const tb = new Uint8Array(nSteps * 64)
  for (let i = 0; i < nSteps; i++) {
    const l0 = llrs[2 * i]; const l1 = llrs[2 * i + 1]
    nextPm.fill(-1e9)
    const row = i * 64
    for (let s = 0; s < 64; s++) {
      const m = pm[s]
      if (m <= -1e8) continue
      for (let b = 0; b < 2; b++) {
        const full = (s << 1) | b
        const ns = full & 0x3f
        const branch = (OUT0[full] ? l0 : -l0) + (OUT1[full] ? l1 : -l1)
        const cand = m + branch
        if (cand > nextPm[ns]) { nextPm[ns] = cand; tb[row + ns] = s }
      }
    }
    const tmp = pm; pm = nextPm; nextPm = tmp
  }
  const out = new Uint8Array(bytesOut)
  let state = 0 // tail-terminated in state 0
  for (let i = nSteps - 1; i >= 0; i--) {
    const bit = state & 1
    if (i < bytesOut * 8 && bit) out[i >> 3] |= 1 << (7 - (i & 7))
    state = tb[i * 64 + state]
  }
  return out
}
```

And in [`Demodulator`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts):
```ts
/** 4 soft bit LLRs for the nibble at (start, set), using FT8's max-log-MAP formula. */
private nibbleLlrsAt (start: number, diff: boolean, set = 0): [number, number, number, number] {
  const s = this.scoresAt(Math.round(start), diff, set)
  let total = 1e-12
  for (const v of this.tonesAt(Math.round(start), set)) total += v
  const out: [number, number, number, number] = [0, 0, 0, 0]
  for (let bit = 0; bit < 4; bit++) {
    const mask = 1 << (3 - bit)
    let max1 = -Infinity; let max0 = -Infinity
    for (let t = 0; t < 16; t++) {
      if (t & mask) { if (s[t] > max1) max1 = s[t] }
      else { if (s[t] > max0) max0 = s[t] }
    }
    out[bit] = (max1 - max0) / total
  }
  return out
}
```

#### How to Test in Simulation in Under 1 Hour
Add `viterbi?: boolean` to `ModemOptions`, wrap `rsEncode(withCrc(payload), PARITY)` in `convEncode(...)` inside `modulate` (and `viterbiDecode` before `rsDecode` in `decodeBody`), and run:
```sh
node --experimental-strip-types benchmarks/scorecard.ts --preset fast --no-late --only "reverb|collision|mid-body"
```
Pairing `fast` (20 ms symbols) or `dual` (36.8 B/s) with rate-1/2 or punctured rate-2/3 Viterbi yields a preset faster than `voice` (10–24 B/s) that crushes `reverb RT60 0.8 s`, `collision 0 dB`, and `1 s mid-body` dropouts.

---

## 3. Ten Things We Are Doing Wrong Today That Cap Performance

After reading [`src/modem.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts), [`src/rs.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/rs.ts), [`src/broadcast.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/broadcast.ts), and [`benchmarks/scorecard.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts) line-by-line, here are the specific bottlenecks in the current implementation:

### 3.1 `this.lastEnd` and `this.scan` in [`Demodulator.process`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L375-L416) Discard the Second Frame in Overlapping Collisions
- **Where**: [`src/modem.ts#L375`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L375), [`#L383-L385`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L383-L385), [`#L403-L406`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L403-L406), [`#L415`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L415).
- **What is wrong**: `this.lastEnd` stores the sample index of the *end* of the last decoded body, and line 375 checks `s - bodyLen >= this.lastEnd` while line 406 filters `this.pending` by `p.body >= this.lastEnd` and line 405 jumps `this.scan` to `this.lastEnd + this.c.tail * this.c.sym`.
- **Why it caps performance**: When two frames $A$ and $B$ overlap with $t_A < t_B < t_A + T_{\text{frame}}$ (which happens in **50% of all collision trials** in [`collide()`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts#L149)), Frame $A$'s preamble arrives in clean air before $B$ starts. Whenever Frame $A$ decodes, `this.lastEnd` is set to $t_A + T_{\text{body}} > t_B$. That immediately deletes Frame $B$'s pending head ([line 406](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L406)), skips `this.scan` over Frame $B$'s head if it wasn't scanned yet ([line 405](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L405)), and forbids Frame $B$'s clean tail sync (which arrives in clean air after $A$ ends!) from decoding Frame $B$ backwards because $t_B < \text{lastEnd}$ ([line 375](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L375))! The comment at [line 422](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L422) says `so a tail never re-decodes it`, which only requires checking `Math.abs(body - prevBody) >= sym`, NOT `body >= lastEnd`!

### 3.2 Unwindowed `[sym/8, 7*sym/8]` Goertzel in [`tonesAt`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L229-L247) Violates Tone Orthogonality on `fast`, `dual`, `tri`, and `turbo`
- **Where**: [`src/modem.ts#L233-L244`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L233-L244).
- **What is wrong**: `tonesAt` integrates an unwindowed rectangular slice of length $T_w = \frac{3}{4} T_{\text{sym}}$ starting at `start + sym / 8`.
- **Why it caps performance**:
  1. Two tones spaced by $\Delta f$ are orthogonal over a rectangular window of length $T_w$ iff $\Delta f \cdot T_w$ is a non-zero integer:
     - `voice` ($T_{\text{sym}} = 40\text{ ms} \implies T_w = 30\text{ ms}$, $\Delta f = 100\text{ Hz}$): $\Delta f \cdot T_w = 3.0$ (orthogonal!).
     - `fast` / `dual` / `tri` ($T_{\text{sym}} = 20\text{ ms} \implies T_w = 15\text{ ms}$, $\Delta f = 150\text{ Hz}$): $\Delta f \cdot T_w = \mathbf{2.25}$ (**non-orthogonal**, sitting near the second sidelobe peak of $\text{sinc}^2$).
     - `turbo` ($T_{\text{sym}} = 10\text{ ms} \implies T_w = 7.5\text{ ms}$, $\Delta f = 200\text{ Hz}$): $\Delta f \cdot T_w = \mathbf{1.50}$ (**dead center on the first sidelobe peak** of the rectangular window, leaking $\left(\frac{1}{1.5\pi}\right)^2 = -13.5\text{ dB}$ into both neighbor tones even in a perfect channel!). If `turbo` simply used $T_w = 10\text{ ms}$ (or $T_w = 5\text{ ms}$, or 266.7 Hz spacing at $T_w = 7.5\text{ ms}$), $\Delta f \cdot T_w$ would be an integer ($2.0$ or $1.0$) with **zero sidelobe bleed**!
  2. Skipping the final `1/8` of the symbol throws away the samples with the *highest* direct-to-echo ratio, while starting at `sym / 8` ($1.25\text{ ms}$ on `turbo`, $2.5\text{ ms}$ on `fast`/`dual`/`tri`) admits early room reflections (which start at $2.0\text{ ms}$ in [`reverb()`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts#L60)) straight into the integration window.

### 3.3 Integer `hop * 8` Rounding in [`config`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L107-L110) Induces a 2,268 ppm Clock-Drift Bug at 44.1 kHz
- **Where**: [`src/modem.ts#L107-L110`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L107-L110) and [`#L296`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L296).
- **What is wrong**: `const hop = Math.round(symbolSeconds * sampleRate / HOPS); return { sym: hop * HOPS, ... }`.
- **Why it caps performance**: At $44,100\text{ Hz}$ and `turbo` ($10\text{ ms}$ symbols), `0.01 * 44100 / 8 = 55.125`, which rounds to `hop = 55`, `sym = 440` samples ($9.97732\text{ ms}$). At $48,000\text{ Hz}$, `sym = 480` samples ($10.00000\text{ ms}$). If a 48 kHz device sends a 235-byte `turbo` frame (285 symbols) to a 44.1 kHz device, the 2,268 ppm quantization error shifts symbol sampling by $285 \times 0.002268 = \mathbf{0.65\text{ symbols}}$ by the end of the frame—walking completely out of the symbol! Furthermore, [`bytesAt`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L296) uses open-loop `start + k * c.sym` with zero timing recovery across the body, even when both head and tail sync offsets are known.

### 3.4 Multi-Band [`byteConfidence`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L300-L309) Bug Falsely Marks Clean Bytes as Erasures on `tri`
- **Where**: [`src/modem.ts#L303-L307`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L303-L307):
  ```ts
  const first = Math.floor(8 * i / c.bits); const last = Math.floor((8 * i + 7) / c.bits)
  for (let k = first; k <= last; k++) {
    for (let b = 0; b < (c.bands === 1 ? 1 : c.bands); b++) conf = Math.min(conf, this.confidenceAt(start + k * c.sym, diff, c.bands === 1 ? setFor(c, k) : b))
  }
  ```
- **What is wrong**: On `tri` (`c.bands = 3`, `c.bits = 12` bits/symbol), byte `0` (bits `0..7`) is carried in band 0 and band 1 of symbol `0`; it does **not** touch band 2 of symbol `0`. Byte `1` (bits `8..15`) is carried in band 2 of symbol `0` and band 0 of symbol `1`. Yet the inner loop iterates over **all 3 bands** (`b = 0, 1, 2`) for every symbol `k` in `first..last`!
- **Why it caps performance**: A single weak high-frequency nibble in band 2 of symbol `0` poisons the confidence of **both** byte `0` and byte `1` (and for byte `1`, `byteConfidence` takes the minimum over all 6 nibbles across symbols `0` and `1`, even though byte `1` only uses 2 of those 6 nibbles!). That wastes up to half of RS's 16 erasure slots on bytes that had zero errors.

### 3.5 Local-Energy Normalization in [`confidenceAt`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L311-L317) Breaks on Silent Dropouts
- **Where**: [`src/modem.ts#L311-L317`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L311-L317):
  ```ts
  let total = 1e-12
  for (const v of this.tonesAt(start, set)) total += v
  return (s[0] - s[1]) / total
  ```
- **What is wrong**: `confidenceAt` divides `(s[0] - s[1])` by `total` (the energy inside *that single symbol* window) rather than the frame's median symbol energy.
- **Why it caps performance**: During a real-world microphone dropout or quiet gap where only faint background noise is present, `total` drops by $1000\times$, so a random noise fluctuation on one Goertzel filter produces `(s[0] - s[1]) / total ≈ 0.35`, which looks **more confident** than a high-SNR symbol in slight reverb (`≈ 0.25`)! Adding `0.15 * frameMedianEnergy` to the denominator immediately forces silent/faded symbols to have near-zero confidence so RS erases the exact dropout bytes.

### 3.6 No Payload Whitening + Fixed `0.5 * prev[t]` in [`scoresAt`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L254-L259)
- **Where**: [`src/modem.ts#L147`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L147) and [`#L254-L259`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L254-L259).
- **What is wrong**: Payload bytes are not scrambled, and `scoresAt` always subtracts `0.5 * prev[t]` regardless of whether `symbolSeconds` is `0.06` (`chime`/`music`), `0.04` (`voice`), `0.02` (`fast`/`dual`/`tri`), or `0.01` (`turbo`).
- **Why it caps performance**:
  1. When two consecutive symbols play the same nibble (1-in-16 random chance, or much higher in structured CBOR/protobuf envelopes with zero bytes), `modulate` plays a continuous tone for $2 T_{\text{sym}}$. In `diff = true` mode, `e[t] - 0.5 * prev[t]` cuts the active tone's score in half (or negative if room multipath causes a fade on the second half of the sustained tone).
  2. At `symbolSeconds = 0.01` (`turbo`) and `RT60 = 0.8 s`, the room energy decays by only $15\%$ per symbol ($e^{-13.8 \times 0.01 / 0.8} = 0.84$), and the echo tail spans **80 symbols**, yet `scoresAt` only looks back **1 symbol** ($10\text{ ms}$)!

### 3.7 Repetitive `[0, 15]x4` Preamble ([`src/modem.ts#L90`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L90)) + Non-Differential Single-Band [`syncScore`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L269-L281)
- **Where**: [`src/modem.ts#L90`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L90) and [`#L269-L281`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L269-L281).
- **What is wrong**: `PREAMBLE = [0, 15, 0, 15, 0, 15, 0, 15, 5, 10]` pumps 4 symbols of energy into tone `0` and 4 symbols into tone `15`. Then [`syncScore`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L277) checks `this.symbolAt(start + i * this.c.sym) !== SYNC[i]` using **`diff = false`** and only **`set = 0`** (ignoring bands 1 and 2 on `dual`/`tri`/`turbo`), returning `0` if $> 1$ symbol misses the non-differential argmax.
- **Why it caps performance**: In heavy reverb (RT60 = 0.8 s, DRR = 0 dB), the accumulated 4-symbol echo on tones `0` and `15` frequently overpowers symbols `5` and `10` in non-differential detection (`++misses > 1`), causing `syncScore` to return `0` and drop the frame before `decodeBody` (which *does* use `diff = true`!) is ever reached.

### 3.8 Hardcoded `PARITY = 16` ([`src/modem.ts#L13`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L13)) and Poisson Multi-Burst Accumulation in `lateJoin`
- **Where**: [`src/modem.ts#L13`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L13), [`#L332`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L332), and [`benchmarks/scorecard.ts#L229-L236`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts#L229-L236).
- **What is wrong**: Every preset uses `PARITY = 16` bytes regardless of symbol speed or frame size.
- **Why it caps performance**:
  - On `tri` (52.2 B/s) and `turbo` (73.6 B/s), 16 bytes of body airtime is only $0.21\text{ s}$ and $0.16\text{ s}$, so a `0.3 s` dropout (22.5 bytes on `tri`, 30 bytes on `turbo`) is mathematically impossible to recover with `PARITY = 16`, even though a 117-byte frame has **118 unused bytes of capacity** in RS(255)!
  - In [`lateJoin`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts#L229-L236), 0.5 s noise bursts occur with an exponential inter-arrival mean of **4 seconds**. Over a 12.1 s `voice` frame, an average of **3 bursts (1.5 s = 19 bytes)** hit the *same* frame, exceeding `PARITY = 16` and causing the 48–55% ceiling in [`benchmarks/RESULTS.md`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/RESULTS.md#L41-L42) even though `voice` gets 100% on a single 1.0 s burst!

### 3.9 Hard-Decision Byte Voting in [`lengthAt`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L341-L349) Wastes Soft Diversity
- **Where**: [`src/modem.ts#L341-L349`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L341-L349).
- **What is wrong**: `lengthAt` decodes 3 separate hard bytes `[a, b, c]` (`len, len ^ 0xff, len`) and requires 2 of the 3 bytes to match bit-for-bit.
- **Why it caps performance**: If each of the 3 copies has just 1 corrupted nibble (only 3 bad nibbles out of 6!), all 3 bytes differ and `lengthAt` returns `undefined`, dropping the frame. Summing the Goertzel tone scores across the 3 copies (`score[t] = e0[t] + e1[t ^ 15] + e2[t]`) before taking `argmax` gets a $3\times$ ($+4.8\text{ dB}$) coherent SNR boost and tolerates errors across all 3 copies simultaneously.

### 3.10 Simulator Sample-Rate Bug in [`benchmarks/scorecard.ts#L256`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts#L256)
- **Where**: [`benchmarks/scorecard.ts#L256-L258`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts#L256-L258):
  ```ts
  const rate = name === 'ultrasonic' ? 48000 : 16000 // 16 kHz is plenty for tones below 4.2 kHz and 3x faster to simulate
  const tones = opts.tones ?? PRESETS.voice.tones
  const band: [number, number] = [Math.min(...tones) - 200, Math.max(...tones) + 200]
  ```
- **What is wrong**: `dual` (up to $6250\text{ Hz}$), `hidden` ($7000\text{ Hz}$), `turbo` ($7200\text{ Hz}$), and `tri` (**$7950\text{ Hz}$**) are all simulated at `rate = 16000` ($f_{\text{Nyquist}} = 8000\text{ Hz}$)!
- **Why it distorts benchmarks**: On `tri`, the top tone ($7950\text{ Hz}$) is only $50\text{ Hz}$ below Nyquist (where `sin(2*pi*f*n/rate)` beats with its own image alias inside a 20 ms window!), and `band[1] = 8150 Hz` exceeds Nyquist in [`addNoise`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts#L46). Line 256 should be `const rate = Math.max(...tones) > 4200 ? 48000 : 16000`.

---

## 4. Sources and Verification Status

1. **FT8 / FT4 Modulation, Costas Arrays, and Soft Max-Log-MAP Demapping**:
   - Steven Franke (K9AN), Bill Somerville (G4WJS), Joe Taylor (K1JT), *"The FT4 and FT8 Communication Protocols"*, QEX, July/August 2020: https://wsjt.sourceforge.io/FT4_FT8_QEX.pdf (Verified: 3×7 Costas sync arrays at start/middle/end, soft bit metric $\Lambda(b_m) = K(\max_{b=1} E - \max_{b=0} E)$, LDPC(174,91) + CRC-14, +1.2 dB from OSD).
   - Reference C implementation (`ft8_lib`, MIT license): https://github.com/kgoba/ft8_lib (Verified).
2. **NATO JANUS Underwater Acoustic Standard (ANEP-87 / STANAG 4748)**:
   - J. Potter et al., *"The JANUS Underwater Communications Standard"*, IEEE UComms 2014: https://www.researchgate.net/profile/John-Potter-3/publication/265594031_The_JANUS_underwater_communications_standard/links/547f1d880cf2d2200edeb8a1/The-JANUS-underwater-communications-standard.pdf (Verified: FH-BFSK over 13 tone pairs to prevent multipath self-interference, $r=1/2$ $K=9$ convolutional code + block interleaver + CRC-8).
3. **Underwater Acoustic Multipath, Noncoherent FSK vs. Phase-Coherent OFDM/Equalizers**:
   - M. Stojanovic, *"Underwater Acoustic Communications: Design Considerations on the Physical Layer"*, IEEE/IFIP WONS 2008: https://stuff.mit.edu/people/millitsa/resources/pdfs/garmisch.pdf.pdf (Verified: trade-off between noncoherent MFSK with guard/hopping vs. coherent adaptive equalization and OFDM).
   - M. Chitre et al., *"Underwater Acoustic Communications and Networking: Recent Advances and Future Challenges"*, MTS Journal 2008: https://arl.nus.edu.sg/wp-content/publications/Chitre2008b.pdf (Verified).
4. **Combinatorial / Parallel Combinatory MFSK ($k$-of-$N$ Noncoherent Index Modulation)**:
   - S. Sasaki et al. / PC-MFSK & Subcarrier Number Modulation literature; combinatorial number system (combinadics, Knuth TAOCP Vol. 4A Sec. 7.2.1.3): https://en.wikipedia.org/wiki/Combinatorial_number_system (Verified: exact bijection between $k$-combinations and $0 \dots \binom{N}{k}-1$, ML noncoherent detection via top-$k$ energy selection).
5. **Concatenated Reed-Solomon + Convolutional / Soft Viterbi Coding & Interleaving**:
   - CCSDS 131.0-B-5, *TM Synchronization and Channel Coding*: https://ccsds.org/Pubs/131x0b5.pdf (Verified: $K=7$, $r=1/2$ polynomials $171_8, 133_8$, punctured rates $2/3, 3/4, 5/6, 7/8$, concatenated with RS(255,223) + interleaver).
   - MIL-STD-188-110B, *Interoperability and Performance Standards for Data Modems*: https://hflink.com/standards/MIL_STD_188_110B.pdf (Verified: $K=7$ convolutional code + variable block interleaver; sync pattern signals mode/interleaver).
   - MIL-STD-188-141B (2G ALE): https://hflink.com/standards/ALE_standard_188_141B.pdf (Verified: 8-FSK, Golay(24,12), 3x word repeat with bit-by-bit majority vote).
6. **Acoustic Data-Over-Sound Systems (ggwave, Quiet Modem, Chirp, LISNR, minimodem)**:
   - **ggwave** (Georgi Gerganov): https://github.com/ggerganov/ggwave (Verified: multi-tone FSK, 4 bits/tone or dual-tone 8 bits, 46.875 Hz spacing at 48 kHz, Reed-Solomon per frame, 8–16 B/s).
   - **Quiet Modem / quiet-js**: https://github.com/quiet/quiet and https://github.com/quiet/quiet-js powered by `liquid-dsp` (https://github.com/jgaeddert/liquid-dsp) (Verified: uses GMSK/PSK for ultrasonic and differential/pilot OFDM for audible/cable profiles; notes Firefox 32 kHz resampling limit).
   - **LISNR Radius**: https://lisnr.com/ultrasonic-technology-overview-radius/ (Verified: 16–20 kHz near-ultrasonic, 66.6 bps long-range to 2000 bps under 1 m, 3 sub-bands at 16.5/18.0/19.5 kHz; exact internal FEC is proprietary/**UNVERIFIED**).
   - **Chirp.io**: https://en.wikipedia.org/wiki/Chirp_(company) and https://audioxpress.com/news/data-over-sound-pioneer-chirp-acquired-by-sonos (Verified: MFSK/chirp sequence + RS, ~50 B payloads, SDK shut down in 2020 after Sonos acquisition).
   - **minimodem**: https://github.com/kamalmostafa/minimodem (Verified: AFSK Bell 103/202, RTTY, NOAA SAME).
7. **Amateur Radio & Broadcast Modes (Olivia, ARDOP, VARA, DVB-H MPE-FEC, ATSC 3.0)**:
   - **Olivia MFSK**: https://www.w1hkj.org/modes/olivia.htm (Verified: 32-tone MFSK, Walsh-Hadamard outer block + scrambling/hopping + Gray code).
   - **ARDOP**: https://winlink.org/sites/default/files/downloads/_ardop_specification.pdf (Verified: repeated header with selective soft decoding, RS outer + Viterbi inner in ARDOP_3).
   - **VARA HF/FM**: https://rosmodem.wordpress.com/2017/09/03/vara-hf-modem/ (Verified: adaptive OFDM up to 32-QAM; exact turbo code polynomial is proprietary/**UNVERIFIED**).
   - **DVB-H MPE-FEC (ETSI EN 301 192)**: https://dvb.org/wp-content/uploads/2019/12/a027_dvb-data_spec.pdf (Verified: RS(255,191) across frames with per-section CRC-32 flagging erasures).
   - **ATSC 3.0 Physical Layer (A/322) & ROUTE/RaptorQ (A/331)**: https://www.atsc.org/wp-content/uploads/2021/04/A322-2021-Physical-Layer-Protocol.pdf and https://www.rfc-editor.org/rfc/rfc6330 (Verified).
8. **Reed-Solomon Soft-Decision / GMD / Chase Decoding**:
   - G. D. Forney, *"Generalized Minimum Distance Decoding"*, IEEE Trans. Info. Theory, 1966; D. Chase, *"A Class of Algorithms for Decoding Block Codes with Channel Measurement Information"*, IEEE Trans. Info. Theory, 1972 (Classic results; our erasure loop `for (let k = 4; k <= PARITY; k += 4)` in [`src/modem.ts#L332`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L332) is already a 4-step GMD decoder!).
