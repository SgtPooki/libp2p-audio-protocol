# Review: channel-measured retry in the demodulator (2026-10-29)

Diff reviewed: `git diff 3f96876 0249ee6 -- src/modem.ts` (roadmap items 22-23). Reviewers: Codex (default model, medium reasoning) and Gemini 4 Argon (medium) via `agy`, asked for correctness bugs only. Both read the full file and Codex ran repros against it.

## Findings, all fixed in the following commit

1. **A longer corrected length dropped the retry** (both). When the nominal detector under-read the header and the retuned re-read gave a longer length whose tail was not buffered yet, `tryHead` returned without re-queuing. Now re-queued with the corrected length.
2. **The tail search read past the buffer and cached NaN energies** (both). Readiness only required audio through `expectTail + 6 sym`, but the search probed up to `expectTail + sym` and each probe reads 6 symbols. When no retune happened the NaNs landed in the live `energies` cache and survived later pushes. Readiness now covers every probe window.
3. **±1 symbol could not cover the advertised drift on long frames** (Codex, with a repro: a max-size `robust` frame at 3000 ppm moves its tail 2.34 symbols; 0 deliveries at ±1, delivered at ±4). The search now spans ±4000 ppm of the head-to-tail distance, at least a symbol. Regression test added: `a max-size robust frame survives a 3000 ppm clock offset`.
4. **`pitch === 1` was a float comparison on an accumulated sum** (Gemini): `0.996 + 4 × 0.001` is not exactly 1, so the no-drift case always retuned and dropped the cache. The scale is now `1 + i / 1000`, exactly 1 at i = 0.
5. `tryHead`'s re-queue had no cap while `process()` caps `pending` at 64 (Gemini). Capped.

## Checked and holding (both reviewers)

`finally` restores `period`, `coefs` and `energies` on every exit path before `onFrame` runs; pending entries terminate as audio arrives (no infinite re-queue, no duplicates within a flush); the buffer trim keeps a pending head's sync in `buf` (longest frame + 2 s margin); the corrected length reaches `decodeBody` and `lastTailEnd` while dedupe keys on the body position only; every delivered payload still passes RS and CRC-32; the retry is bounded per head (54 Goertzel calls for the pitch estimate, one header read, the tail probes, one body decode).

Noted but left: `flushPending`'s body-only readiness check means a retry entry is spliced and re-pushed once per push while its tail is still arriving (one array op per chunk).
