# Scorecard baseline

Captured before any robustness work (modem as of commit 3b6882f). The late-join section was added to the scorecard afterwards; its "repeat whole frame" rows are the late-join baseline. Regenerate with `npm run scorecard -- --out benchmarks/RESULTS.md`.

Seed 1, 100 trials per cell, 117-byte frames, streamed in 4096-sample chunks.
Cells: frames decoded byte-exact, with Wilson 95% interval.

- voice: 10.2 B/s, 11.5 s per 117-byte frame
- chime: 6.8 B/s, 17.3 s per 117-byte frame
- ultrasonic: 10.2 B/s, 11.5 s per 117-byte frame

| condition | voice | chime | ultrasonic |
| --- | --- | --- | --- |
| clean (20 dB in-band SNR) | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| in-band SNR 6 dB | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| in-band SNR 0 dB | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| in-band SNR -6 dB | 100% (96-100) | 100% (96-100) | 98% (93-99) |
| reverb RT60 0.3 s, DRR 0 dB | 22% (15-31) | 49% (39-59) | 31% (23-41) |
| reverb RT60 0.8 s, DRR 0 dB | 15% (9-23) | 25% (18-34) | 21% (14-30) |
| radio chain (300-3000 Hz, AGC, clip, -200 ms) | 100% (96-100) | 100% (96-100) | 0% (0-4) |
| clock drift 100 ppm | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| clock drift 1000 ppm | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| collision, other sender -6 dB | 100% (96-100) | 100% (96-100) | 99% (95-100) |
| collision, other sender 0 dB | 51% (41-61) | 87% (79-92) | 64% (54-73) |
| 0.3 s silence in sync | 0% (0-4) | 0% (0-4) | 0% (0-4) |
| 0.3 s silence in header | 0% (0-4) | 0% (0-4) | 0% (0-4) |
| 0.3 s silence mid-body | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| 1 s silence mid-body | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| 0.3 s loud noise burst mid-body | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| 1 s loud noise burst mid-body | 100% (96-100) | 100% (96-100) | 100% (96-100) |

CPU (this machine):
- voice: 1.4 ms per audio second normal, 5.4 ms under looped sync tones (sim rate 16 kHz)
- chime: 1.3 ms per audio second normal, 5.4 ms under looped sync tones (sim rate 16 kHz)
- ultrasonic: 4.8 ms per audio second normal, 19.1 ms under looped sync tones (sim rate 48 kHz)
