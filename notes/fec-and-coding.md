# Error correction and fountain coding for libp2p over audio

Researched October 2026. Question: what FEC and fountain coding should this project use, and what do governments, militaries, broadcasters and space agencies use on similar one-way, low-rate, hostile links?

Items marked **UNVERIFIED** could not be confirmed from a primary source. Gain figures marked **estimate** are textbook or reasoned values, not measurements on our channel; each one needs a scorecard row before it counts.

## Where we are

| Layer | Today | Source |
|---|---|---|
| Modulation | MFSK-16, 40 ms symbols, 4 bits/symbol, hard decision per symbol (argmax of 16 Goertzel energies) | `src/modem.ts` |
| Sync | 10-symbol preamble at the frame start only; receiver matches the last 6 | `src/modem.ts` |
| Header | `len, len^0xff`, 2 bytes, no FEC | `src/modem.ts` |
| Frame FEC | CRC-32 + RS over GF(256), 16 parity bytes; retries with the 4..16 least confident bytes as erasures, then with differential detection | `src/modem.ts`, `src/rs.ts` |
| Message FEC | Dense systematic RLNC over GF(256), seeded coefficients, incremental Gaussian elimination; K = 2..8 blocks of 60 B in practice | `src/broadcast.ts` |

The scorecard (`benchmarks/RESULTS.md`) says the weak spots are **not** raw SNR: every preset decodes 98-100% at -6 dB in-band SNR. They are structural:

1. Losing 0.3 s of sync or header: 0%. Nothing protects them.
2. Reverb RT60 0.8 s: 51-57%. Delay spread is 10-20 symbols long; differential detection removes only the previous symbol's echo.
3. Equal-power collisions: 60-88%.
4. Late join with noise bursts: 70-80%. Mostly the same cause as (1): a burst that lands on a chunk's sync or header loses that whole chunk.

So a stronger code alone will not fix the worst rows. Most real systems below learned the same thing: protect sync and header with redundancy, spread errors with interleaving or hopping, and put an erasure code across frames.

## 1. Fountain and rateless codes

| Code | Overhead to decode | Decode cost | Notes |
|---|---|---|---|
| LT ([Luby, FOCS 2002](https://doi.org/10.1109/SFCS.2002.1181950)) | K + O(sqrt(K) ln^2(K/delta)): large at small K | O(K ln K) | Bad at K < 100; the base for Raptor. |
| Online codes ([Maymounkov, NYU TR2002-833](https://pdos.csail.mit.edu/~petar/papers/maymounkov-online.pdf)) | (1+epsilon)K | O(K) | Outer code + sparse inner; same small-K problem as LT. No maintained JS implementation found. |
| Raptor R10 ([RFC 5053](https://www.rfc-editor.org/rfc/rfc5053)) | Near K | O(K) | Mandated in 3GPP MBMS download (below). Superseded by RaptorQ. |
| RaptorQ ([RFC 6330](https://www.rfc-editor.org/rfc/rfc6330)) | Sec. 5.8: decode failure at most 1/100 with K' symbols, 1/10,000 with K'+1, 1/1,000,000 with K'+2 | O(K), K up to 56,403 per block | Patent-encumbered: Qualcomm [IPR disclosure #2554](https://datatracker.ietf.org/ipr/2554/). Terms for non-cellular devices **UNVERIFIED** (the page text was cut off in research); see [raptorq issue #116](https://github.com/cberner/raptorq/issues/116). |
| Wirehair ([catid/wirehair](https://github.com/catid/wirehair), BSD-3) | "about N + 0.02 packets" on average; README says it may need N+1, N+2 | O(N), N up to 64,000 | README: "fairly inefficient" for N under about 128. |
| Dense RLNC over GF(256) (ours) | P(fail at K+h) about 1/256^(h+1), same as RaptorQ's figure | O(K^2 (K + blocksize)) | Unique property: a relay can **recode** (mix received chunks) without decoding. |
| Sparse RLNC | Slightly above dense | Lower | Only notable library, [Steinwurf Kodo](https://www.steinwurf.com/kodo-research-license-1-2), is research-only licensed. Avoid. |

**Measured: our own RLNC at file sizes.** A scratch benchmark fed `src/broadcast.ts` only repair chunks (worst case, no systematic chunks) on this laptop (Node 26):

| Message | Block | K | Total decode time | Extra chunks beyond K |
|---|---|---|---|---|
| 480 B | 60 B | 8 | 1 ms | 1 |
| 3 KB | 60 B | 50 | 3 ms | 0 |
| 20 KB | 60 B | 334 | 150 ms | 0 |
| 20 KB | 200 B | 100 | 18 ms | 0 |
| 60 KB | 60 B | 1000 | 2.6 s | 0 |

At 10 B/s, 20 KB is about 33 minutes of airtime and 60 KB about 100 minutes. The decoder spends 150 ms to 2.6 s of CPU across that whole span (phones are maybe 3-5x slower, **estimate**). CPU is not the bottleneck until K is several thousand, and dense GF(256) RLNC already has the best possible overhead. RaptorQ and Wirehair only win on CPU at large K, which our bitrate never reaches. Our format caps a message at 65,535 bytes (`msgLen u16`), which is about K = 1,092 at 60 B blocks.

**JS / WASM implementations:**

| Package | License | Status |
|---|---|---|
| [cberner/raptorq](https://github.com/cberner/raptorq) (Rust) | Apache-2.0 | Well maintained, fast (README: about 2.5-5.9 Gbit/s decode on a desktop). No official WASM build. |
| npm [`raptorq`](https://www.npmjs.com/package/raptorq/v/1.7.4) | Apache-2.0 | wasm-bindgen build of the crate, but not published by the crate author; provenance questioned in [QRCraftly-web #1174](https://github.com/fderuiter/QRCraftly-web/issues/1174). Don't depend on it unchecked. |
| [`@raptorqr/raptorq-wasm`](https://github.com/infrost/RaptorQR) | **UNVERIFIED** | cberner crate compiled to WASM for an animated-QR transfer app (same one-way, lossy problem as ours). |
| [kig/wirehair-wasm](https://github.com/kig/wirehair-wasm) (npm `wirehair-wasm`) | BSD-3 (upstream) | README: about 33 kB gzipped, up to 2.9 GB/s encode / 900 MB/s decode on Apple M2. Third-party port; check the build. |
| `src/broadcast.ts` | ours | 117 lines, zero deps, already tested. |

## 2. Physical-layer FEC better than hard-decision RS

| Technique | Who uses it | What it buys us | Expected gain vs our hard RS |
|---|---|---|---|
| Soft-decision demapping (per-bit log-likelihood from all 16 tone energies) | FT8: `L = K(max over tones with bit=1 - max over tones with bit=0)` ([FT8/FT4 QEX paper](https://wsjt.sourceforge.io/FT4_FT8_QEX.pdf)) | Decoder knows "this nibble was 7 or 5" instead of "7"; reverb and collision errors are usually a strong runner-up, exactly what soft metrics capture | About 2 dB for the same code in AWGN, the classic soft vs hard figure (**estimate**). Our erasure retries already capture part of this. |
| Convolutional r=1/2, K=7 + soft Viterbi | CCSDS 131.0, MIL-STD-188-110, 802.11 | Simple (about 100 lines), tiny CPU at 100 bit/s | Several dB in AWGN over uncoded (**estimate**); halves throughput unless punctured (MIL-STD-188-110 FH uses r=2/3) |
| RS outer + convolutional inner + interleaver | CCSDS 131.0 "concatenated", Voyager-era deep space; ARDOP_3 ("Viterbi inner, RS outer", [ardop group](https://ardop.groups.io/g/users/topic/ardop_500_1_0_2_5_compared/30822546)) | RS cleans up the Viterbi decoder's burst output; our existing RS + CRC stay | About 2 dB more than the convolutional code alone at BER 1e-5 (JPL 1981 figure quoted in a patent, **UNVERIFIED** against CCSDS text) |
| LDPC with BP + OSD | FT8 LDPC(174,91); ATSC 3.0 (16200/64800 bits); CCSDS (8176,7156) | Best known gain; FT8 decodes at -20.8 dB SNR in 2500 Hz (AWGN), and block detection + OSD add 1.2 dB over plain BP (QEX Table 5) | Highest, but FT8's code carries only 77 payload bits; we'd need a longer code and there is no JS LDPC library worth reusing |
| Turbo codes | CCSDS 131.0, VARA ("Turbo", proprietary) | Similar to LDPC | Same as LDPC; nothing open to reuse in JS |
| Interleaving | MIL-STD-188-110 (0.6 s / 4.8 s), JANUS, MPE-FEC, Olivia | Turns a reverb or collision burst into scattered errors a convolutional / LDPC code can fix | Only helps with a soft code. RS over bytes already handles contiguous bursts well (`1 s silence mid-body`: 100%). |
| Frequency hopping across a wider tone set | JANUS (13 tone pairs, FH-BFSK), Olivia scrambling | The next symbol avoids the tone slots still ringing from the last ones, so long echo stops looking like a valid symbol | Directly targets reverb; size unknown, test it |

Key fact for us: the decoder that wins is always **soft decisions + a code built for them + a CRC to catch false decodes**. We already have the CRC and the soft information (`tonesAt` gives all 16 energies); we throw it away at `symbolAt`.

## 3. What real systems do

| System | Modulation | FEC / coding | Rate | Lesson for us |
|---|---|---|---|---|
| FT8 ([QEX 2020](https://wsjt.sourceforge.io/FT4_FT8_QEX.pdf)) | 8-GFSK, 6.25 Hz spacing | 77-bit message + CRC-14, LDPC(174,91), soft BP then OSD, optional a priori bits | 77 bits per 15 s | **Three Costas sync arrays: start, middle and end.** The paper notes missing the middle one "has little effect". Fixed-length frame, so no length header to lose. |
| JS8Call ([user guide](https://js8call.com/JS8Call-improved/d6/d14/md_docs_2user__guide_2JS8Call__User__Guide.html)) | FT8-derived 8-GFSK | LDPC(174,87) + CRC-12 (per third-party repos) | Slow to "turbo" submodes, -28 to -18 dB | Same code, trades speed for SNR by submode. A "robust" preset is normal practice. |
| Olivia ([fldigi](https://www.w1hkj.org/modes/olivia.htm), [SP9VRC](https://www.qsl.net/aa3eu/oliviamixw.htm)) | 32-tone MFSK, 31.25 baud | Walsh-Hadamard, rate 7/64, scrambled, spread diagonally over 64 symbols, Gray coded | 2.44 chars/s, about -12 dB | Closest relative of our modem. Spends most of its rate on code and interleaving; no explicit sync, it searches time and frequency. |
| ARDOP ([spec](https://winlink.org/sites/default/files/downloads/_ardop_specification.pdf)) | 4FSK / PSK / QAM, 200-2000 Hz | Frame type byte sent twice (second XORed with session id) with "selective soft decoding"; CRC-16 per carrier; RS; ARDOP_3 preview: Viterbi inner + RS outer | Adaptive | Header sent twice with soft decoding. FEC (broadcast) mode exists alongside ARQ. |
| VARA ([sigidwiki](https://www.sigidwiki.com/wiki/VARA_HF), [author](https://rosmodem.wordpress.com/2017/09/03/vara-hf-modem/)) | OFDM, FSK to 32QAM | Turbo codes per third-party descriptions (**UNVERIFIED**) | Up to about 8.5 kbit/s | Proprietary shareware. Nothing to reuse. |
| MIL-STD-188-110 / STANAG 4539 ([110B](https://hflink.com/standards/MIL_STD_188_110B.pdf)) | 8-PSK serial tone, 1800 Hz, 2400 baud | Conv r=1/2 K=7; repetition at 150/300 bit/s; block interleaver of 0 / 0.6 / 4.8 s; interleave setting is signaled by the sync pattern | 75-4800 bit/s | Interleaver length is a robustness knob chosen per link. Header info can ride in **which** sync pattern is sent. |
| STANAG 5066 ([Isode overview](https://www.isode.com/whitepaper/stanag-5066-the-standard-for-data-applications-over-hf-radio/), [Ed.4 draft](https://www.isode.com/wp-content/uploads/2024/04/Main.pdf)) | Rides 188-110 / 4539 | Non-ARQ broadcast D_PDUs with CRC; segments carry C_PDU id + offset; broadcast data repeated; receivers can pass up C_PDUs with known bad parts marked | Up to 4096 B per broadcast C_PDU | Militaries still do one-way delivery by plain repetition. A fountain code beats it (scorecard: 72% vs 39% under bursts). |
| 2G ALE, MIL-STD-188-141 ([141B](https://hflink.com/standards/ALE_standard_188_141B.pdf)) | 8-FSK, 125 baud, 250 Hz spacing | Golay(24,12), interleaved, each word sent **3 times**, bit-by-bit 2/3 majority vote | 375 bit/s raw | Tiny control words get heavy, simple redundancy. Good model for our 2-byte header. |
| NOAA SAME / EAS ([NWS 10-1712](https://www.weather.gov/media/directives/010_pdfs_archived/pd01017012a.pdf), [FCC 12-7](https://transition.fcc.gov/Daily_Releases/Daily_Business/2012/db0110/FCC-12-7A1.pdf)) | AFSK 520.83 bit/s, 1562.5 / 2083.3 Hz | None; header sent 3 times with 1 s gaps, 2-of-3 match, else bitwise majority | Header of a few hundred bits | Time diversity with 1 s gaps survives a burst that kills one copy. Works on any receiver. |
| 3GPP MBMS ([TS 26.346](https://www.arib.or.jp/english/html/overview/doc/STD-T63v11_00/5_Appendix/Rel12/26/26346-c50.pdf)) | LTE | FLUTE/ALC download; UE "shall support a decoder for the Raptor FEC scheme" (RFC 5053) | Broadcast files | One-way file delivery to phones standardized on a fountain code at the application layer. |
| ATSC 3.0 ([A/322](https://www.atsc.org/wp-content/uploads/2021/04/A322-2021-Physical-Layer-Protocol.pdf), [A/331](https://www.atsc.org/wp-content/uploads/2025/06/A331-2025-06-Signaling-Delivery-Sync-FEC.pdf)) | OFDM | Physical: LDPC 16200 / 64800 bits + BCH or CRC outer. Delivery: ROUTE with optional RaptorQ repair flows | Mbit/s | Two layers: strong soft code per frame, erasure code across frames. Same split as ours. |
| DVB data broadcasting ([EN 301 192](https://dvb.org/wp-content/uploads/2019/12/a027_dvb-data_spec.pdf), [EBU on DVB-H](https://tech.ebu.ch/docs/techreview/trev_301-dvb-h.pdf)) | DVB-T/H | Carousels repeat objects. MPE-FEC: RS(255,191) across a table of IP sections; CRC-32 per section marks erasures, so 64 erasures are fixable instead of 32 errors | Mbit/s | Exactly our CRC-flags-erasures trick, applied across frames. |
| CCSDS deep space ([131.0-B-5](https://ccsds.org/Pubs/131x0b5.pdf), [130.1-G-3](https://ccsds.org/Pubs/130x1g3e1.pdf)) | BPSK/QPSK | Conv K=7 r=1/2; RS(255,223) with interleave depth I=1..8; RS+conv concatenation; turbo; LDPC | bit/s to Mbit/s | Agencies moved from hard RS, to RS+soft Viterbi, to turbo/LDPC, each step for more dB at the same power. |
| Othernet / Outernet ([rtl-sdr.com](https://www.rtl-sdr.com/outernet-3-0-implementation-details-71572km-lora-world-record/)) | LoRa CSS on Ku-band | LoRa's Hamming 4/5..4/8 + interleaving; file-level FEC or carousel **UNVERIFIED** | About 30 kbit/s | Chose an interference-tolerant, spread modulation over raw speed. |
| JANUS / NATO ANEP-87, ex STANAG 4748 ([JANUS paper](https://www.researchgate.net/profile/John-Potter-3/publication/265594031_The_JANUS_underwater_communications_standard/links/547f1d880cf2d2200edeb8a1/The-JANUS-underwater-communications-standard.pdf), [SWiG 2025](https://subseawirelessgroup.com/?mdocs-file=407)) | FH-BFSK, 13 tone pairs, 9.44-13.6 kHz | 56 bits + CRC-8, conv r=1/2 constraint length 9, interleaved over 144 chips; 32-chip preamble | 80 bit/s | **The closest standard to an echoey room.** Slow, noncoherent FSK, hopping across tones, a soft convolutional code and an interleaver. A source quoting a 62.5 ms chip is inconsistent with 80 bit/s; 6.25 ms fits. |

## 4. Analogous problem categories

| Category | Problem shared with us | Standard answer | Take |
|---|---|---|---|
| Underwater acoustic ([Stojanovic, physical layer](https://stuff.mit.edu/people/millitsa/resources/pdfs/garmisch.pdf.pdf); [Chitre et al. 2008](https://arl.nus.edu.sg/wp-content/publications/Chitre2008b.pdf)) | Long multipath spread compared with the symbol, Doppler, sound-speed channel | Robust links use noncoherent FSK with frequency hopping and guard times; fast links use adaptive equalizers or OFDM | Our room is a short underwater channel. Copy the JANUS recipe for a robust mode; equalizers are out of scope in browser JS. |
| Deep space | Low SNR, power limited | Concatenated codes, then turbo/LDPC with soft decisions | Only matters once SNR is the binding limit. Today it isn't. |
| Broadcast file delivery (MBMS, ATSC, DVB) | One-way, no feedback, late joiners | Fountain code (Raptor/RaptorQ) or RS across frames, plus carousel repetition | Already done with RLNC. Extend it to files and CIDs. |
| Delay-tolerant networking ([RFC 9171 Bundle Protocol](https://www.rfc-editor.org/rfc/rfc9171), [RFC 5326 LTP](https://www.rfc-editor.org/rfc/rfc5326)) | Store-and-forward over intermittent links | Bundles, custody transfer, LTP with reliable "red" and unreliable "green" parts | Our relay roadmap item. RLNC lets a relay recode and forward chunks before it can decode, which RaptorQ can't. |

## 5. Recommendation

Priority is by scorecard impact per unit of effort. Each item lands only with a scorecard row that shows it.

| # | Change | Layer | Targets | Expected impact | Effort | Reuse |
|---|---|---|---|---|---|---|
| 1 | **Sync and header redundancy.** Add sync blocks in the middle and at the end of the frame (FT8 Costas pattern) so the receiver can lock on any one of them. Protect the length: send it 3 times with a majority vote (ALE / SAME), or move it inside the RS codeword with a few fixed frame sizes signaled by which sync pattern is used (MIL-STD-188-110). | Physical | Sync/header rows (0%), late join under bursts | 0% rows toward 90%+ (**estimate**, matches the roadmap target); late join gains because chunk frames stop dying on bursts | Low. About +0.5 s per frame. | None needed; small change in `modem.ts` |
| 2 | **Keep dense RLNC, extend it to files.** It already has optimal overhead and measured decode of 150 ms at K = 334 (20 KB). Use bigger blocks when frames allow (200 B: K = 100, 18 ms). Add relay recoding later. Do not adopt RaptorQ (patent questions, no first-party WASM, no overhead gain). Only consider [wirehair-wasm](https://github.com/kig/wirehair-wasm) (BSD-3) if a message needs K well above 1,000. | Message | Files, CID broadcasts, collisions as erasures | Files of tens of KB with K + 0 to 1 chunks | Low | `src/broadcast.ts` as is; widen `msgLen` past u16 only when needed |
| 3 | **Soft decisions into the decoder.** Compute per-bit metrics from the 16 energies with FT8's max-log formula, then use them in an inner convolutional code (r=1/2 K=7, CCSDS/802.11 polynomials 171/133 octal, soft Viterbi) behind a frame-long block interleaver, keeping RS + CRC-32 as the outer code (CCSDS concatenation). Ship it as a `robust` preset first, since r=1/2 halves throughput to about 5 B/s; try r=2/3 puncturing after. | Physical | Reverb 0.8 s, collisions, low SNR | Several dB in AWGN (**estimate**); reverb and collision gains unknown and the main reason to measure | Medium. About 150 lines with a test. | No maintained JS Viterbi found; [ft8_lib](https://github.com/kgoba/ft8_lib) (MIT, C) is the cleanest reference for soft demapping and LDPC BP if we try LDPC later |
| 4 | **Tone hopping (JANUS style).** Offset each symbol's tone by a known per-position sequence across a wider grid (for example 24 tones in 300-3000 Hz for the `voice` preset) so a tone isn't reused while it is still ringing. | Physical | Reverb, and it whitens repeated symbols that currently cancel in differential mode | Unknown; JANUS and Olivia both rely on it | Low to medium | None needed |
| 5 | **Listen before talk with random backoff** in `AudioLink`. FEC cannot separate two equal-power senders; avoiding the overlap and letting the fountain layer absorb the rest can. | Link | Collisions | Fewer collisions in practice; no airtime cost | Low | None needed |

Not recommended now: LDPC or turbo at the physical layer (no reusable JS, and SNR isn't our limit), RaptorQ (licensing, provenance, no gain at our K), sparse RLNC or Kodo (research-only license), LT or Online codes (worse than what we have at small K).

### Open questions

- Qualcomm's RFC 6330 licensing terms for devices that are not cellular handsets (**UNVERIFIED**; read [IPR #2554](https://datatracker.ietf.org/ipr/2554/) in full before any RaptorQ use).
- Whether soft Viterbi helps reverb as much as it helps AWGN. Reverb errors are correlated with the previous symbols, not random, so interleaver depth matters; measure at RT60 0.3 and 0.8 s.
- Othernet's file-level FEC and VARA's code are undocumented in primary sources.
