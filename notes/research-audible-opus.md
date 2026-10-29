# Audible quality: making the tones pleasant or unnoticeable (2026-10-29)

Question: how do we make audible transmissions pleasant or unnoticeable without giving up decode rate, for
(a) data that is the sound, (b) data hidden under music, (c) a short recognizable signature? Context from today:
audible presets sound like dial-up, `music` is an in-key arpeggio but no tune, and `hidden` at -18 dB under the
Westminster bells was audible as faint beeps and did not decode over the air, while ultrasonic under the same
jingle linked in 4.9 s.

Everything marked **sim** was run for this note against the real `src/modem.ts` / `src/jingle.ts` (scripts in the
session scratchpad, not in the repo; the model is described in "Masking model used" below so it can be rebuilt).
Everything marked **UNVERIFIED** is from memory or a search snippet I did not read in full.

## Bottom line

1. **The `hidden` preset is not masked; it is just quieter.** The bell jingles put almost no energy at 4-7 kHz, so
   the only threshold in that band is the threshold of hearing. Under a standard masking model the data at
   -18 dB sits **+46 to +64 dB above the masked threshold** (median ~55 dB, all four jingles). Even -30 dB is
   +38 to +52 dB over. Faint beeps are the expected result, and so is the over-the-air failure: to be inaudible
   the data would need to be ~55 dB quieter, and nothing decodes there. **sim**
2. **Real psychoacoustic hiding under music costs ~10x in rate with our MFSK.** If we give the jingle a masker in
   the data band (a shaker layer) and set each symbol at the masked threshold minus a margin `m`, decoding
   falls off a cliff at m ~ 0 dB: 100 ms symbols decode 100% at m = -3 (3 dB *over* threshold), 30% at m = 0,
   0% at m = +3; with the `conv` inner code, 70% at m = 0. That is ~3 B/s at the threshold of audibility. An
   inaudible margin (m = +3 to +6 dB, which you need because the model is only good to a few dB) is ~1 B/s or
   less. **sim**. Fine for a 4-8 byte tag. Not for a 140-byte signed envelope.
3. **So split the problem.** Invisible: ultrasonic (already the jingle default, measured). Pleasant: make the data
   *be* part of the music instead of hiding it under the music: a known melody carries the tune and the sync,
   the data plays the accompaniment, the percussion, or both. The ear tolerates random notes in an
   accompaniment far better than in a melody, because the melody, harmony and meter stay deterministic.
4. **The cheapest audibility win is volume.** The scorecard decodes every preset at -6 dB *in-band* SNR, which
   is +10 to +17 dB in the detector's bin. We very likely play 10-20 dB louder than we need to. A level ladder
   (start quiet, +6 dB per retry) costs ~30 lines.

## 1. Ranked proposals

Audibility gain is quantitative where a model exists; otherwise it says what a listening test must show.
Decode cost is against the current preset it replaces. LOC is a rough count against today's code.

| # | Proposal | Case | Audibility gain | Decode cost | LOC | Phones / reverb | How to test |
|---|---|---|---|---|---|---|---|
| 1 | **Level ladder**: play at the quietest level that works; start ~20 dB below today, +6 dB per link-layer retry, remember per peer | all | 10-20 dB quieter in the common case (from the scorecard's -6 dB in-band SNR margin; real room noise decides) | first frame may fail and cost one retry (~1 frame of airtime); no rate cost after | ~30 (`browser.ts`, `link.ts` retry hook) | phones: helps (less speaker distortion/AGC pumping at low level); reverb: neutral (DRR, not SNR, limits reverb) | OTA: lowest gain that decodes 5/5 at 0.5/1/2 m, and SPL at the listener with a phone meter app |
| 2 | **Tune-led accompaniment** (`tune` preset): the jingle melody plays as-is (0 bits); data is a 16-tone arpeggio over the *current chord of the tune*, notes on the tune's beat grid | a, c | not a masking claim. Musical salience: melody, harmony and meter are deterministic; only accompaniment note order is random. Needs ACR/MUSHRA test | same 4 bits/note as `music`; rate set by tempo: 8 notes per beat at 80 bpm = 94 ms = 5.3 B/s raw, vs `music` 6.5 B/s | ~200 (`jingle.ts` harmony + tempo-derived `toneSets`/`symbolSeconds`; sync on the melody) | phones: tones 520 Hz-8 kHz, phone speakers are weak below ~500 Hz (**UNVERIFIED**, typical); reverb: `music` is already the best preset at RT60 0.3 s (96%) | scorecard rows for the new preset; ACR listening test vs `music` and `voice` |
| 3 | **Signature preamble**: replace `[0,15]x4,5,10` with the first 2-3 s phrase of the jingle, detected by per-note energy matching; the variant played (key/transposition) carries 3 bits = which preset follows | c | turns the most "modem" part (fast alternating 0/15) into a recognizable motif | +1.5-2.5 s per *burst* (not per frame); detection gain is large: 250 ms notes give ~4 Hz bins, ~27 dB over a 2 kHz band | ~120 (`modem.ts` sync path, a `preamble` option) | robust: long notes survive reverb (energy spreads <1 bin); note amplitudes give a free channel-response probe for picking the preset | false-sync rate on 1 h of music/speech; sync detection vs SNR in the scorecard; "do you recognize it" after 5 exposures |
| 4 | **Shaker band** (band replacement, after Acoustic OFDM): the jingle gets a percussion layer at 4-9 kHz, and the data *is* that layer: many-band MFSK with a rhythmic amplitude envelope, no separate shaker noise | a, b | data sounds like hi-hat/shaker if it is dense enough to read as noise, rather than beeps. Unknown until listened to: 6 random tones per 30 ms may still sound like sizzle-with-pitch | in-band SNR is not masker-limited (nothing else lives there). 6 bands x 16 tones at 50 Hz over 4-8.8 kHz, 30 ms: 800 bit/s raw = 100 B/s; the envelope floor (-9 dB) costs SNR on off-beats | ~150 (`bands` beyond 3, envelope in `modulate`, shaker voice in `jingle.ts`) | phones pass 4-9 kHz (laptop measured to 10 kHz, phone untested); `hidden`-style 30 ms symbols are the worst preset in reverb (56%) so expect a reverb hit; `rotate` helps | scorecard + JINGLE.md rows; ABX "shaker with data vs shaker of plain noise" |
| 5 | **Symbol transition smoothing**: 3-5 ms frequency glide or raised-cosine amplitude dip at each symbol boundary on `voice/fast/dual/tri` | a | removes the hard pitch steps that make FSK sound like a modem; spectral splatter drops (sidelobes fall from 6 to 18 dB/oct for raised-cosine). Small perceptual gain, unquantified | ~0: the transition sits in the first 1/8 of the symbol, which the Goertzel window already skips | ~15 (`modulate`) | neutral | scorecard must stay identical; ABX vs current |
| 6 | **Octave-stacked (organ) timbre + octave-summed detection**: each symbol is a pitch class played at 2-3 octaves at once; the receiver sums Goertzel energy across the octaves | a | a sine beep becomes an organ-like note (pure sines are much of the "bleep"); timbre partials at octaves *help* instead of colliding with other tones | fewer symbols per spectrum: 8 diatonic classes = 3 bits (-25% vs 4) unless symbols shorten; frequency diversity: a speaker null in one octave no longer kills the symbol | ~60 (`modulate` + `tonesAt` sum) | phones: diversity helps with small-speaker roll-off; reverb neutral | scorecard; ACR test |
| 7 | **Stepwise-constrained melody**: next note within +/-3 places of the last on the 16-tone chord ladder (7 choices, 2.8 bits), decoded with Viterbi over the 16 ladder states | a | random 4-octave leaps become a contour that wanders; reads as "noodling" rather than random | -30% bits per note; the constraint gives soft-decision gain back (illegal transitions are detected), plausibly 1-3 dB (**estimate**) | ~120 (encoder + 16-state Viterbi, `conv.ts` is a template) | neutral | scorecard; ACR test vs `music` |
| 8 | **Masking mixer under a designed masker** (section 3): per symbol, tone at masked threshold - m | b | at m >= +3 dB, inaudible under the model; today's mix is +55 dB over | 100 ms symbols + conv: ~3 B/s at m = 0, ~0 at m = +3 (sim); ~1 B/s or less for a real margin | ~150 incl. a small masking model | thin margins die first in reverb and on phones | JINGLE.md rows at m = -6..+6; ABX per m |
| 9 | **Chord codebook** (Lopes & Aguiar's Digital Voices): a symbol = a diatonic chord (7 roots x maj/min x with/without 7th ~ 28 = 4.8 bits) | a | every symbol consonant, but random chord changes every symbol are not a progression; at < 150 ms per chord it sounds like stabs | ~5 bits per chord at >= 100 ms = ~6 B/s; ML detection over 28 codewords; a missing note doesn't kill the symbol | ~100 | chords resist a single-tone null | ACR test vs #2; likely loses to #2 |
| 10 | **Echo hiding / spread-spectrum watermark** | b | the classic inaudible watermarks | tens of bit/s at best over the air; echo hiding's 1-3 ms echoes compete with the room's own reflections | 300+ | poor in reverb (**UNVERIFIED** for our rooms); built for files, not speaker-to-mic | not recommended; listed so we don't revisit it |

Not proposed: **rhythm/pulse-position bits** (which sub-beat a note lands on). Random rhythm is the most
unmusical thing you can do to a tune, and a 1/4-beat shift is a few tens of ms, about the room's echo spread.
**Timbre bits** (harmonic recipes) depend on the speaker's frequency response, which varies by tens of dB across
phones.

Order of work: 1 and 5 now (cheap, no new preset); 2 + 3 together as the `tune` preset (the melody is both the
tune and the sync); 4 as the next `hidden`; 8 only if someone needs a truly inaudible audible-band tag.

## 2. Design sketches

### 2.1 `tune`: the melody plays, the data accompanies (proposal 2)

Why it should sound better than `music`: `music` already changes chord every 8 notes through I-V-vi-IV, so the
harmony is fine. What is missing is anything the ear can follow. Keep a melody the receiver already knows and
let the data fill the role listeners expect to be busy and patternless: arpeggiated accompaniment.

- **Jingle data** (`src/jingle.ts`): add `chords: number[][]` per note or per beat (pitch classes, e.g.
  Westminster in E: E, B, E, B ...) and keep `bpm`. A `Jingle` becomes melody + harmony + tempo.
- **Symbol grid**: `symbolSeconds = (60 / bpm) / notesPerBeat`. 8 per beat: Westminster (80 bpm) 94 ms, Shave
  (120) 63 ms, Charge (140) 54 ms. At 4 bits per note: 5.3, 8.0, 9.3 B/s raw before RS.
- **Codebook**: per beat, the 16 tones are the current chord's pitch classes over 4 octaves (the existing
  `chord()` helper, generalized to the jingle's chord), starting two octaves above the melody so the melody's
  fundamentals sit below the data. `toneSets` + `barSymbols` already give "tone set changes every N symbols"; set
  `barSymbols = notesPerBeat` and build `toneSets` from the jingle's chords. 4 bits/symbol, unchanged.
- **Collision with the melody**: the bell's partials (2.01x, 3x, 4.2x of 247-415 Hz = 0.5-1.75 kHz) land on the
  lowest data octave. Options, cheapest first: (i) start the data ladder at C6 (1046 Hz) and shorten the bell's
  upper partials; (ii) at the receiver, both sides know the melody note at every symbol after sync, so drop the
  1-2 tones within one bin of a melody partial from the argmax (the tone is still sent; it just competes with
  less). Measure (i) before building (ii).
- **`modulate`**: mix the melody (from `renderJingle`) into the frame at a fixed level above the data (e.g. +6 dB),
  locked to the symbol grid. The frame length is the data length rounded up to whole bars, so the music ends on a
  bar line and the fade lands musically (the `underJingle` fade is already 1.5 s).
- **`Demodulator`**: unchanged body path (argmax per symbol, RS, Chase, `conv` if wanted). Sync changes (2.2).
- **Pleasantness knob**: `notesPerBeat` 4 vs 8. 4 per beat halves the rate and sounds like a harp
  accompaniment rather than an arpeggiator. Let the ACR test choose.

Risk: random arpeggio order is still random. If the test says it still sounds like noodling, add the stepwise
constraint (proposal 7) on top; it composes because it only restricts which index follows which.

### 2.2 Signature preamble (proposal 3)

- **What plays**: the jingle's first phrase, 4-8 notes, 1.5-3 s (Westminster's first quarter is 4 notes at
  0.75 s = 3 s; Shave and a Haircut's first five notes ~1.5 s). One signature per burst, not per frame: the
  link layer sends bursts that end with an "over", so the signature starts the burst and frames inside the burst
  keep the short sync.
- **Detection**: the receiver knows the note frequencies and durations. For every hop, sum over notes
  `E_note(t + offset_k) / E_total` with Goertzel windows as long as each note (250-750 ms = 1.3-4 Hz bins). A
  note's energy integrated over 250 ms in a 4 Hz bin is ~27 dB over the noise in a 2 kHz band at equal power, so
  the signature is detectable well below the level of the music it is part of. Noncoherent per note, so 1000 ppm
  clock drift (scorecard row) and reverb don't hurt; long notes also outlast the RT60 0.3 s smear.
- **Bits in the signature**: play it in one of 8 transpositions (or 8 jingles) = 3 bits: which preset the body
  uses. The receiver tries all 8 (8x the cheap per-note work). This gives the "dial fast, fall back" ladder a way
  to announce the preset instead of guessing.
- **Free channel probe**: the received note amplitudes vs the sent ones give the speaker-to-mic response at 4-8
  frequencies. A receiver that sees -20 dB above 4 kHz should not be dialed with `tri`.
- **Recognizability**: sonic logos are 3-5 notes and work by repetition (Intel, NBC chimes). That they work is
  common knowledge; the research numbers on how many exposures it takes are **UNVERIFIED**. Test: after 5
  exposures, can listeners pick our signature out of 4 similar motifs?
- **`modem.ts` change**: a `preamble?: { notes: Array<[hz, seconds]> }` option; `modulate` prepends it;
  `Demodulator.process` runs a signature scan in front of the existing `syncScore` scan and, on a hit, sets
  `scan` to the burst start. Existing presets keep `PREAMBLE`.
- **Cost**: false syncs on music. The current sync is 6 symbols of a fixed pattern; a melody matcher will fire on
  people humming the jingle. RS + CRC still reject the frame, so the cost is CPU, not wrong data.

### 2.3 Shaker band: data as percussion (proposal 4)

NTT DoCoMo's Acoustic OFDM (Matsuoka et al. 2008) *replaces* the high band of the music with OFDM carriers
whose power follows the music's spectral envelope, at several hundred bit/s to phones ~3 m away. The point
for us: replacement, not addition. The data does not have to sit under a masker in its band; it is the band.
Here the bells have nothing above 4 kHz, so "replace" means "add a percussion layer that is the data".

- **Symbol format**: `bands: 6`, 16 tones per band at 50 Hz spacing, bands at 4.0, 4.8, 5.6, 6.4, 7.2, 8.0 kHz
  (each 800 Hz wide), 30 ms symbols (Goertzel window 22.5 ms, 44 Hz resolution, so 50 Hz spacing holds), `rotate`
  off at first. 24 bits per 30 ms = 800 bit/s raw = 100 B/s raw; with 32 parity on 117-byte frames, ~70 B/s.
  `config` already packs N bands; lift the `1 | 2 | 3` type and the `bits` packing limit (24 bits fits).
  Needs a 44.1/48 kHz path end to end (fine in browsers); the 16 kHz rate `benchmarks/jingle.ts` uses for
  `hidden` tops out at 8 kHz.
- **Envelope**: multiply the data by the shaker envelope (an 8th-note hit decaying with tau 80 ms to a 0.35
  floor), the same envelope the sim used. The receiver's argmax is per band and per symbol, so a level that
  changes symbol to symbol does not matter, except that off-beat symbols have ~9 dB less SNR. Their confidence
  is lower, which the erasure path already uses.
- **Sound**: 6 simultaneous random tones re-drawn every 30 ms, under a percussive envelope, at roughly
  -10 dB under the bells. Whether that reads as shaker or as "sizzle with pitch" is the one thing to listen
  for before writing the preset. Render a WAV first (`benchmarks/jingle.ts --wav` pattern), listen, then decide.
  If it is too pitched: shorter symbols (20 ms, 75 Hz spacing, 5 bands) are more noise-like.
- **What we lose**: 6 tones share the amplitude, so each tone is 7.8 dB below a single-tone frame at the same
  total power. Same trade as `dual`/`tri`, and the scorecard shows those hold to -6 dB in-band SNR.

## 3. The masking-based mixer, with numbers

### Masking model used

Simplified Johnston (1988) / MPEG-1 model 1, as presented in Painter & Spanias (2000):

- Hann FFT (512 at 16 kHz = 32 ms per symbol frame; 1024 for the margin survey), power per Bark band,
  `z(f) = 13 atan(0.00076 f) + 3.5 atan((f/7500)^2)`.
- Schroeder spreading `SF(dz) = 15.81 + 7.5(dz + 0.474) - 17.5 sqrt(1 + (dz + 0.474)^2)` dB.
- Offset per masker band j: tone-masking-noise `14.5 + j` dB, noise-masking-tone 5.5 dB, blended by a
  tonality from that band's spectral flatness. Johnston uses one SFM per frame; a per-band one stops the loud
  tonal bell from making the shaker band count as tonal (which would make the threshold ~25 dB too low).
- Floor: Terhardt's absolute threshold, calibrated so a full-scale sine = 85 dB SPL.
- Comparison: the data's energy in each Bark band vs that band's threshold. "Margin" = data minus threshold;
  positive = audible.

Known weaknesses: no temporal masking (conservative: forward masking after each bell strike would add headroom
for ~100-200 ms, Zwicker & Fastl, **UNVERIFIED** numbers), no cross-band summation (sub-threshold components in
several bands at once are easier to hear than one, so a multi-band design needs extra margin), ATH and SPL
calibration matter only where nothing masks. Model error of +/-3-5 dB is normal for this class of model.

### What today's mixes look like (sim)

| mix | median margin over threshold | 10th-90th pct |
|---|---|---|
| `hidden` -18 dB, ducked, Westminster | +55 dB | +49 to +60 |
| `hidden` -18 dB, ducked, Charge! | +52 dB | +37 to +62 |
| `hidden` -30 dB, ducked, Westminster | +43 dB | +37 to +48 |
| `ultrasonic` -18 dB, Westminster | -23 dB | -45 to -10 |

The 4-7 kHz threshold is the threshold of hearing because the bells put nothing there (spreading from 1.7 kHz
upward falls ~55 dB by 4 kHz). Ducking changes the level by a few dB; it cannot fix a 55 dB gap. Ultrasonic is
below threshold by Terhardt's curve, which describes typical adults. Young people are the exception: adults under
30 respond at 16-18 kHz in clinical studies, and one secondary source puts the most sensitive under-20 group
near 70 dB SPL at 18 kHz (**UNVERIFIED** level). Expect children and teenagers to hear `ultrasonic` at close
range and full volume.

### Mixer design

Inputs: the jingle bed `bed` (known in full before playback; we synthesize it), the modem frame, a margin `m`.

1. **Give the bed a masker in the data band.** Without one there is nothing to hide under. Sim: a shaker
   layer (band noise around 5.5 kHz, 8th-note hits, tau 80 ms, floor 0.35) at -10 dB under the bells.
2. **Per symbol** (the symbol grid is known: `at(i) = round(i * sym)`): compute the masked threshold of `bed`
   over the symbol, find the band each tone falls in, and scale the symbol so the tone's band energy is
   `threshold - m`. 2 ms gain ramps between symbols. Clamp to a ceiling (never louder than the masker band) and
   a floor (below it, the symbol is a known erasure).
3. **Multi-band variant**: one tone per Bark band (17, 18, 19 cover 3.7-6.4 kHz) at `threshold_b - m` each,
   i.e. `bands: 3` with bands aligned to Bark bands, not 16 x 200 Hz. Three times the bits at the same
   per-band margin (minus the cross-band summation penalty above).
4. **Receiver**: unchanged. It also knows the bed after sync, so it can compute the same per-symbol threshold and
   flag symbols that were sent near the floor as erasures before RS, or scale their LLRs for `conv`.

### Decode margin (sim, Westminster + shaker, 60-byte frames, quiet room)

Symbol error rate with ideal timing, one tone per symbol from the `hidden` set, and the Demodulator's sync
statistic (the sync tone's share of the 16-tone energy; `process()` needs >= 0.4):

| symbol | m = -6 dB | m = 0 | m = +6 | m = +10 |
|---|---|---|---|---|
| 30 ms (`hidden` today) | SER 7%, sync 0.52 | 53%, 0.25 | 84%, 0.12 | 90%, 0.08 |
| 60 ms | 1.5%, 0.66 | 30%, 0.37 | 72%, 0.17 | 87%, 0.11 |
| 100 ms | 0%, 0.77 | 11%, 0.50 | 57%, 0.25 | 74%, 0.16 |
| 200 ms | 0%, 0.84 | 5%, 0.62 | 40%, 0.32 | 68%, 0.18 |

Full frames through the real `Demodulator` (10 trials each; data level is relative to the bed's RMS):

| variant | m = -3 dB | m = 0 | m = +3 |
|---|---|---|---|
| `hidden` at 100 ms | 100% (data -19 dB) | 30% (-22 dB) | 0% (-25 dB) |
| `hidden` + `conv`, 60 ms | 90% | 0% | 0% |
| `hidden` + `conv`, 100 ms | 100% | 70% | 0% |

At 30 and 60 ms nothing decoded at m >= 0. The sync gate fails before Reed-Solomon does: at 30 ms, m = 0, the
sync share is 0.25 against a 0.4 gate. In a broadband masker, the 16-tone energy normalization in `syncScore`
is the first thing to break.

Why the cliff sits at the threshold: a noise masker hides a tone ~5.5 dB below the noise in its critical band
(the critical band at 5 kHz is ~900 Hz wide). The Goertzel bin is 1/T wide: 13 Hz at 100 ms, so the detector
gains 10 log10(900/13) = 18 dB over the ear. In-bin SNR at m = 0 is ~18 - 5.5 = 12.5 dB, about what
noncoherent 16-FSK needs for a few percent symbol errors. Each +6 dB of inaudibility margin has to be paid back
with 4x longer symbols. Rule of thumb: **in-bin SNR ~ 10 log10(CB x T) - 5.5 - m dB.**

Capacity check: at the threshold the data-to-masker ratio across the band is -5.5 dB. Over a 3 kHz band that is
~1 kbit/s Shannon capacity at m = 0 and ~300 bit/s at m = +6. We get ~27 bit/s at m = 0, so the gap is
noncoherent MFSK using one tone in one band at a time, not physics. OFDM-style designs (Acoustic OFDM) close part
of it, at 600+ LOC (see `notes/research-throughput-opus.md` #9).

What the mixer is good for, then: not invisibility (use ultrasonic), but **setting the level of audible data
relative to the music instead of guessing**. Today `-18 dB` means +55 dB over threshold under bells and could
mean "inaudible" under a rock track. A mixer that targets `threshold + 10 dB` (m = -10) under a shaker layer
decodes at full rate and stays tied to the music's loudness frame by frame. It is the dial between proposal 4
(m << 0, data is the percussion) and proposal 8 (m > 0, data is hidden).

## 4. How loud, and how to listen

**Loudness.** The scorecard's in-band SNR is noise power over the whole preset band. `voice` at 30-40 ms: the
1.5 kHz band over a ~33 Hz bin is +16.6 dB, so -6 dB in-band is about +10.6 dB in-bin, and every preset is at
100% there. In a quiet room (~30-40 dBA, mostly below 500 Hz) the 1-2.5 kHz noise is lower still, and phone
MEMS mic self-noise is ~30 dBA (**UNVERIFIED**, typical datasheet range). A rough budget says tones at 40-50 dB
SPL at the receiver (quiet conversation is ~50-60 dB SPL at 1 m) are enough in a quiet room. Measure it instead
of trusting this: proposal 1, with a phone SPL meter at the receiver.

**Listening tests we can run with 5 people.**

- **ABX for "can you hear it"** (cases b, and proposal 5): 16 trials per listener. Per-listener pass = 12/16
  (p = 0.038). Pooled 80 trials: 48 correct needed (p = 0.046). Power: if listeners really get 65% right,
  80 trials catch it 85% of the time; at 60%, only 55%. So 5 people x 16 trials detects a moderate effect, not a
  subtle one. Train first by playing the data alone, because people who know the beeps hear them (worst case,
  the one that matters). Fixed playback level, measured with an SPL meter at the listener's ear. Run both
  headphones (upper bound) and the real laptop/phone speaker at 1 m (the actual case).
- **ACR / MUSHRA-lite for "is it pleasant"** (cases a, c): 5-point absolute category rating (ITU-T P.800
  style) or a 0-100 slider per clip, clips shuffled, with a hidden reference (the plain jingle) and a low
  anchor (current `voice`). Compare `voice`, `chime`, `music`, `tune` (2), `tune`+stepwise (7), shaker (4).
  With 5 listeners only differences of ~15+ points on 100 will be meaningful (**estimate**); report per-listener
  scores, not just means.
- **Tooling**: a small page in `examples/` that plays A/B/X from pre-rendered WAVs (`benchmarks/render-sounds.ts`
  already renders them) and logs answers to JSON. No external service.

## 5. What survives phones and reverb

| technique | phone speaker / mic | reverb |
|---|---|---|
| ultrasonic 17.5-19 kHz | iPhone worked both ways (measured 2026-10-29); TV/PA/radio paths cut it | worst in the scorecard at RT60 0.8 s (52%) |
| audible 4-9 kHz bands (`hidden`, shaker) | should pass (laptop measured to 10 kHz; phones untested) | 30 ms symbols are weak: `hidden` 56% at RT60 0.3 s; more parity/`rotate` or 40+ ms |
| chord-tone / melody presets (`music`, `tune`) | lowest octave (C5, 523 Hz) is near small-speaker roll-off (**UNVERIFIED**); octave stacking (6) adds diversity | best in reverb (`music` 96% at RT60 0.3 s) because 60+ ms symbols and wide spacing |
| masking at m >= 0 | margin is a few dB, and phone EQ changes the ratio in-band | reverb adds the music's own tail into the data bins; expect worse than the quiet sim |
| signature preamble | long notes, robust | robust; notes outlast the smear |
| echo hiding | **UNVERIFIED**, likely poor | room reflections bury 1-3 ms echoes |

Also: phone voice processing (noise suppression, AGC) treats steady tones as noise. `browser.ts` turns it off
in the browser; native apps and calls won't. Melodic, dynamic signals may get through noise suppressors better
than steady tones (**UNVERIFIED**; worth one OTA row on a phone call).

## 6. Prior art, briefly

- **Chirp.io** (2012 audible protocol): 20 tones of 87.2 ms (1.7 s), 32 tones a semitone apart from 1760 Hz,
  chosen to sound like birdsong; RS over GF(32), 10-character shortcode resolved by a server. So the "pleasant"
  part was semitone spacing plus a fixed short length, not music, and a server lookup kept it to a few
  bytes. Later SDKs went to 50-byte audible/ultrasonic payloads. Sonos bought Chirp in 2020.
- **Lopes & Aguiar, Digital Voices (2001, 2003)**: they made the same diagnosis we did: raw ASK/FSK/SS
  "are immediately perceived as digital communications and are fairly aggressive." Pentatonic FSK from 1 kHz
  at 20 ms sounds like grasshoppers; at 100 ms, like flutes (80 bit/s). A chord scheme on the diatonic scale
  (maj/min, with/without 7th) carried 7-bit ASCII at ~5 chars/s. They also used a melodic hopping code from
  *Close Encounters*. That is the closest thing to our proposal 2, without a deterministic melody on top.
- **Google Nearby / Chromecast guest mode**: DSSS at 18.5-20 kHz, low level, short token, ~2 m in noisy offices,
  then a server check. Invisible by being ultrasonic, not by masking.
- **Acoustic OFDM (NTT DoCoMo, 2006-2008)**: replace the music's high band with OFDM shaped to the music's
  spectral envelope; several hundred bit/s (240-720 bps per a later paper) to phones at ~3 m, with subjective
  tests. The template for proposal 4.
- **LISNR**: ultrasonic profiles, a few hundred to 1-2 kbit/s rated at < 1 m (from our earlier throughput note,
  not re-checked here).

## Sources

- Painter & Spanias, "Perceptual Coding of Digital Audio," Proc. IEEE 88(4), 2000. Masking offsets, Schroeder
  spreading, Terhardt threshold, MPEG model 1: https://www.cns.nyu.edu/~david/courses/perceptionGrad/Readings/PainterSpanias-ProcIEEE2000.pdf
  (found; the 14.5 + z / 5.5 dB offsets are attributed to Johnston 1988; I did not check the exact equations in the PDF).
- Johnston, "Transform coding of audio signals using perceptual noise criteria," IEEE JSAC 6(2), 1988 (**UNVERIFIED**, from memory, no URL fetched).
- Zwicker & Fastl, *Psychoacoustics: Facts and Models* (temporal masking durations; **UNVERIFIED**, from memory).
- Lopes & Aguiar, "Aerial Acoustic Communications," WASPAA 2001: https://www.ee.columbia.edu/~dpwe/papers/LopesA01-aerialcomm.pdf ;
  "Acoustic modems for ubiquitous computing," IEEE Pervasive Computing 2(3), 2003: https://isr.tecnico.ulisboa.pt/wp-content/uploads/2015/05/415_2003-PERVASIVE.pdf
  (details from search summaries; PDFs not read in full).
- Chirp.io teardown: https://twocentstudios.com/2012/10/12/deconstructing-a-chirp-dot-io/ ; reimplementation:
  https://github.com/jonasbits/chirp.io/blob/master/chirp.py ; https://en.wikipedia.org/wiki/Chirp_(company)
- Google, "Ultrasonic Communication Using Consumer Hardware" (Nearby's DSSS protocol): https://www.researchgate.net/publication/320575022_Ultrasonic_Communication_Using_Consumer_Hardware (summary only).
- Matsuoka, Nakashima, Yoshimura, Kawahara, "Acoustic OFDM: Embedding High Bit-Rate Data in Audio," MMM 2008:
  https://link.springer.com/chapter/10.1007/978-3-540-77409-9_47 ; journal version IEICE Trans. E91.A(7):
  https://www.jstage.jst.go.jp/article/transfun/E91.A/7/E91.A_7_1652/_article ; quality analysis:
  https://www.researchgate.net/publication/263436111_An_Analysis_on_Audio_Quality_Deterioration_of_Acoustic_OFDM (not read).
- Extended high-frequency hearing by age: Wang et al. 2021, https://link.springer.com/article/10.1186/s40463-021-00534-w ;
  2026 cross-sectional study, https://link.springer.com/article/10.1186/s43163-026-01174-5 ;
  Rodríguez Valiente et al. 2014 (dB SPL reference, 645 subjects): https://www.researchgate.net/publication/261767650_Extended_high-frequency_9-20_kHz_audiometry_reference_thresholds_in_645_healthy_subjects
  (summaries only; the "~70 dB SPL at 18 kHz for under-20s" figure is a secondary-source snippet, **UNVERIFIED**).
- "Evaluating Acoustic Data Transmission Schemes for Ad-Hoc Communication Between Nearby Smart Devices,"
  arXiv 2602.02249: https://arxiv.org/pdf/2602.02249 (found, not read; may have comparable numbers).
- Listening-test standards: ITU-R BS.1116 (small impairments), https://www.itu.int/rec/R-REC-BS.1116 ; ITU-R BS.1534
  (MUSHRA), https://www.itu.int/rec/R-REC-BS.1534 ; ITU-T P.800 (ACR), https://www.itu.int/rec/T-REC-P.800 (not fetched).
- Audible harmonies patent (already in `notes/LabWeek23.md`): https://smus.com/patents/2017%20-%20Communicating%20Data%20with%20Audible%20Harmonies.pdf (not re-read).
- Echo hiding (Gruhl, Lu, Bender 1996) and perceptual spread-spectrum watermarking (Boney, Tewfik, Hamdy 1996):
  **UNVERIFIED**, from memory; cited only for proposal 10.
- Not found: a published, measured recipe for "musical" data over the air with listening-test scores. Digital
  Voices is the closest, and it reports impressions, not tests.

Repo measurements used: `benchmarks/RESULTS.md` (scorecard), `benchmarks/JINGLE.md`, `benchmarks/OVER-THE-AIR.md`
(the -18 dB `hidden` failure and the 4.9 s ultrasonic link).
