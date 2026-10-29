# Next modem experiments: what fails in reverb, and three measured fixes (2026-10-29)

Scope from the lead: the weakest scorecard cells after items 1-26, excluding the ultrasonic radio chain. Everything
below was measured on a scratch copy of `src/` and `benchmarks/` (nothing in the repo was edited), 100 trials per
cell, seed 1, paired: an A/B pair shares the same rooms because the same `--only` row consumes the RNG the same way.

## Headline

1. **The reverb cells in `RESULTS.md` are mostly room draws, not preset quality.** A `--only reverb` run draws
   different rooms than the full table. Same code, 50 trials (table) vs 100 trials (`--only`): fast 0.3 s 86 vs 95,
   ultrasonic 0.3/0.8 s 78/64 vs 89/94, voice 0.3 s 96 vs 84. The Opus note already said per-room SER spans 0.2-11%.
   Precondition for every experiment below: a fixed room bank (give `reverb()` its own `mulberry32(roomSeed + trial)`
   so every preset and every A/B sees the same 100 rooms; ~5 lines in `benchmarks/scorecard.ts`).
2. **Most reverb failures never reach the body.** Instrumented voice at RT60 0.3 s (16 failures of 100): 11 decoded the
   length header as 165, 119 or 122 instead of 117 and never tried the right body; 3 never found a sync at all; only 5
   failed in the body, and those had 18-38 wrong bytes, past anything Chase or 32 parity can reach. Fast at 0.3 s: 3 of
   5 failures had no sync, 1 had the wrong length, 1 had 34 wrong bytes.
3. **Why the length vote lies.** The header is `len, len^0xff, len` on tone set 0, no rotation. Copies 1 and 3 both
   follow a symbol 10 (the sync's last symbol, and copy 2's last symbol). In reverb the echo of that 10 turns the first
   nibble of both copies into 10: 0x75 reads 0xA5 twice, the two wrong copies agree, and `lengthAt` returns 165 from
   plain detection without ever consulting the differential read, which usually has it right.
4. **0 dB collisions are at the hard-decision ceiling.** Voice 95/100: all 5 failures had sync 1.00 and length 117, and
   bodies with 19-47 wrong bytes (runner-up right in about half). Nothing under 30 lines moves this; `robust` is the
   answer for busy rooms. No experiment proposed.

## Experiment 1: length candidates from both detection modes (receiver only, ~10 lines)

**Hypothesis.** When plain and differential header reads disagree, the differential one is often right in reverb;
offering both lengths as frame candidates recovers the frames in finding 3 at no cost on the common path (the CRC
rejects a wrong length as it rejects any wrong body).

**Change** in `src/modem.ts`:

```ts
private lengthAt (start: number): number | undefined { return this.lengthsAt(start)[0] }  // retry path keeps one
/** Length candidates from the 3-copy vote: plain detection, then differential when it disagrees. */
private lengthsAt (start: number): number[] {
  const out: number[] = []
  for (const diff of [false, true]) {
    const [a, b, c] = this.bytesAt(start, 3, diff)
    const votes = [a, b ^ 0xff, c]
    const len = votes.find(v => votes.filter(w => w === v).length >= 2)
    if (len != null && len !== 0 && len <= this.c.max && !out.includes(len)) out.push(len)
  }
  return out
}
// process(): wrap the heads/tails push in `for (const len of this.lengthsAt(header)) { ... }`
```

**Measured** (100 trials, RT60 0.3 / 0.8 s, before -> after): voice 84/93 -> 93/95, ultrasonic 89/94 -> 95/96,
hidden 82/95 -> 86/97, chime 94/77 -> 98/78, music 96/78 -> 98/82, fast 95/98 -> 97/99, dual 97/99 -> 98/99,
turbo 96/99 -> 97/99, tri 92/97 -> 92/97. Collision 0 dB unchanged (voice 95, fast 99, dual 98). CPU unchanged
(voice 7.8 -> 7.7 ms per audio second; hostile 5.8 -> 6.0).

**Cost.** One extra body attempt per frame only when the two reads disagree. No airtime, no audible change.
Run `npm test` (the tail copy and the pending list see two candidates per sync now).

**Option, not recommended by default:** tolerating 2 sync misses instead of 1 (`++misses > 2` in `syncScore`)
adds voice 93/95 -> 95/96 on top but costs +30% decoder CPU on the normal path (7.8 -> 10.3 ms per audio second)
from false syncs. The on-air alternative (rotate the header symbols so no copy shares a predecessor tone) was not
validated: my patch was a no-op because of finding 3 in experiment 3 below.

## Experiment 2: musical rotation inside the bar for `music` and `chime` (~5 lines + preset data)

**Hypothesis.** `music` reuses one 16-tone set for 8 notes, so at 60 ms symbols the previous note's echo sits in the
current note's own bin at about -6 dB (RT60 0.8 s). `chime` alternates C and D pentatonic, but those share D, E and A:
60% of its "rotation" lands on the same frequencies. Alternating note to note between two sets with no shared pitch
class should recover most of the 0.8 s row. The roadmap's "chord tones a semitone apart" explanation (item 24) does
not hold: add9 voicings with no semitone pairs measured 74 vs 78.

**Change.** A `alt` option: sets per bar used in turn note to note.

```ts
alt?: number                      // ModemOptions; default 1
const setFor = (c, k, b = 0) => b * c.rotate + (Math.floor(k / c.bar) * c.alt + k % c.alt) % c.rotate
// music: toneSets = PROGRESSION.flatMap(ch => [ch, partner(ch)]), alt: 2, barSymbols: 8 (sets must be bands*rotate)
// chime: toneSets: [PENTATONIC, PENTATONIC.map(f => f * 2 ** (6 / 12))]   (no code change: --opts works today)
```

**Measured, music** (0.3 / 0.8 s; baseline 96/78): chord change every note (`barSymbols: 1`) 86 at 0.8 s; bar
alternating the chord with its tritone transposition 99/91; with its semitone transposition 99/91; with the next
diatonic 7th (Cmaj7/Dm7, G7/Am7, Am7/Bm7b5, Fmaj7/G7, in key, 1 shared pitch class per pair) 99/86. Stacked with
experiment 1: diatonic 100/93, tritone 100/96.

**Measured, chime** (second set n semitones up; 0.3 / 0.8 s): +2 (today) 94/77, +3 (Eb pentatonic, shares G and C)
96/82, +6 (black keys, disjoint) 96/87; +6 stacked with experiment 1: 99/88. Collision 0 dB 97 -> 98.

**Cost.** Airtime none. Audible: the character changes. Diatonic pairs keep `music` in C major (ii/I, vi/V, vii/vi,
V/IV planing); the tritone version is bitonal. Chime at +6 alternates white keys and black keys (Petrushka colour),
+3 is a C blues colour. Pick by ear between 93 and 96 (music) and 82 and 87 (chime); the data says disjointness is
what counts (chime: 60% shared 77, 40% 82, 0% 87).

**Test.** `--opts '{"toneSets": [...]}'` for chime today; music needs the 3-line `alt` change, then
`node benchmarks/scorecard.ts --preset music --trials 100 --no-late --only reverb --opts '{"alt":2,"toneSets":[...]}'`.

## Experiment 3: rotate every symbol, as the option says (1 line)

**Finding.** `setFor` is `floor(k / bar) % rotate` and `barSymbols` defaults to 8, so every `rotate` preset without an
explicit `barSymbols` (voice, dual, tri, turbo, ultrasonic, hidden, robust) changes tone set every 8 symbols, not
every symbol as the `rotate` doc and the preset comments claim. Only `fast` sets `barSymbols: 1`.

**Change.** In `config`: `barSymbols = opts.toneSets != null ? 8 : 1` (or set `barSymbols: 1` on the seven presets).

**Measured** with `--opts '{"barSymbols":1}'`, 0.3 / 0.8 s: voice 84/93 -> 87/96, robust 88/89 -> 90/93,
hidden 82/95 -> 85/96, ultrasonic 89/94 -> 90/94, dual 97/99 -> 97/99, tri 92/97 -> 91/97, turbo 96/99 -> 95/100.
-6 dB and 0 dB collision rows unchanged on voice and dual. Stacked with experiment 1, voice reaches 95/97.

**Cost.** None on air; the receiver's energies cache already keys by set. Small gain, but it makes the code do what it
documents, and the header-rotation idea in experiment 1 depends on it.

## Measured and not worth doing

- **Decision-directed per-tone gain normalization** (divide scores by each tone's median winning energy, as a third
  decode pass): fast 95/98 -> 95/98, dual 97/99 -> 98/99. Fading is not what fails; the header is.
- **`fast` at 400 Hz spacing** (rotation offsets of 2 bins): 95/98 -> 93/97.
- **add9 voicings for `music`**: 78 -> 74 at 0.8 s.
- **Chase or parity for the remaining body failures**: they carry 18-47 wrong bytes with the runner-up right in half;
  a rate-1/2 soft inner code (`robust`) is the only tool for those frames.

## Reproducing

Scratch copy: `cp -r src benchmarks <dir>/`, apply the snippets, then from `<dir>`:
`node benchmarks/scorecard.ts --preset voice --trials 100 --no-late --only reverb`. The failure anatomy came from
logging, per failed trial, the best `syncScore` within half a symbol of the true head and tail sync, `lengthAt` at the
header that follows, and the byte distance of the plain and differential reads from `rsEncode(withCrc(payload))`.
