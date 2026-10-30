# Backlog

Ranked. Each item names where it came from and what "done" looks like. Move finished items to the iteration log in
[`roadmap.md`](roadmap.md) with their numbers. Sources: `notes/review-2026-10-30.md` (three-reviewer review),
the follow-up round (Codex, Gemini, Grok asked independently what to do next), `notes/research-*.md`.

## Now

1. **Recorded hardware corpus, thin first.** One session: laptop and phone, both directions, `voice`, `fast`,
   `ultrasonic`, Westminster `tune`; quiet desk, lively room, one clipped level; keep failures; WAV + exact payload
   + device/rate/level/distance in a sidecar. Replay through `Demodulator` in CI (`npm test` or
   `scorecard --corpus`). Done when every file decodes or fails for a reason readable in the waveform. Precondition:
   Zoom closed (it holds the audio device; `pgrep zoom.us`). Grok, Codex and Gemini all rank this first among the
   evidence items; Grok puts the `tune` re-run ahead of everything.
2. **Wire-format fixture that round-trips.** Deferred: recorded per-preset waveforms would be megabytes in the repo, and a decoder regression against *old transmitters* only matters once there are receivers we cannot update; until then the hash fixture plus the round-trip tests cover it. Revisit with item 11.
3. ~~Tail-only recovery drift~~ and 4. ~~half-open SYN exhaustion~~: done 2026-10-30, roadmap item 33.
5. ~~Transport ladder tests at a valid rate~~: done 2026-10-30 (ladder at 48 kHz for tri/turbo; `config()` rejects a top tone at or above Nyquist).

## Next

6. **Scorecard realism.** Done 2026-10-30: per-purpose RNG streams keyed by (seed, trial), rooms keyed by seed (another
   `--seed` is a held-out bank), both colliders scored, reflection density scaling with RT60 (moved nothing: 0.8 s
   above 0.3 s for short symbols is the constant-DRR model), radio row with an 8th-order cutoff and receiver hiss, a
   laptop-speaker-to-phone-mic row (roadmap 35, 38). Paired statistics done (roadmap 39: `--save`/`--compare`, exact McNemar). Still open: a measured device
   response once the corpus exists.
7. **Browser capture off the main thread.** AudioWorklet capture, worker decoding; measure callback p95/p99 and
   missed buffers on a phone. The per-push full copy in `Demodulator.push` is gone (2026-10-30: growable buffer,
   amortized trim; Node CPU unchanged, the point was allocation churn: ~6 MB per push per decoder at 48 kHz before).
   Gemini: worklet only if the phone still drops.
8. ~~Mute the local decoder while the node's own speaker plays?~~ Measured 2026-10-30 in the timed room with nodes hearing their own speaker at 0.5 (louder than the room's 0.3): two connections still complete on 3 seeds, 2/2, 143-166 s on air, the only overlaps same-step pairs. The link drops own-role frames; no mute needed (Grok's position held).
9. **Timed room.** Self-audio and per-path gain/delay are in (2026-10-30, roadmap 37 and 40). Still open: per-path impulse response (the scorecard's room model), per-device clock drift, recording each overlap's cause, a spread wide enough (30 dB+) to produce hidden terminals.
10. **Candidate lifecycle in `tryHead`/`flushPending`/`pending`.** Partly done 2026-10-30: one `deliver()` for the three success paths and one `retuned()` context for detector state (no more save-mutate-restore). Still open: an explicit delivered / failed / waiting state with one cluster per sync carrying its candidate lengths and alignments.
11. ~~Format versioning policy~~: written down in roadmap.md (transport open items), 2026-10-30. Nothing on the air; a preset generation when an un-updatable receiver exists.
12. ~~Charge! in tune mode~~: measured a higher ladder floor (F7) and 1 note per beat, 10-27% in reverb either way; Charge has no tune form now (`Jingle.tune: false`, 2026-10-30).
13. **Tune over the air.** Re-run `benchmarks/over-the-air-tap.mjs 'jingle:westminster:-6:tune'` with the audio
    device free; then decide between the signature preamble (`notes/research-audible-opus.md` 2.2) and dropping
    the mode.
14. **`chime` second set by ear.** Black keys (+6 semitones) measure 86 → 91% at 0.8 s reverb but alternate white and
    black keys every 60 ms; in-key D pentatonic kept. Listen to both (roadmap item 29).
15. **Phone tests of `fast`, `dual`, `tri`, `turbo`.** Untested over the air on a phone.
16. **Unsigned ACK/FIN/RST** (threat T21): an attacker can remove inflight data or reset a connection. Only worth
    bytes if targeted disruption shows up.

## Later / parked

- `src/ofdm.ts` out of `src/` (experimental, unwired). Register the `/audio` multicodec. Audio ↔ Meshtastic
  gateway. Reticulum interface. IPNS record broadcast. Fountain repeat-vs-chunk choice in the demo's Loop button for
  one-frame messages (fountain trails the repeat there, roadmap weak-spot table).

## Stopped until a recording shows the failure

More parity sweeps, more bands or faster symbols, OFDM integration, more Chase combinations, more points on the
current room bank.
