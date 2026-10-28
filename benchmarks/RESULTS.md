# Scorecard

Seed 1, 100 trials per cell, 117-byte frames, streamed in 4096-sample chunks.
Cells: frames decoded byte-exact, with Wilson 95% interval.

- voice: 9.7 B/s, 12.1 s per 117-byte frame
- chime: 6.5 B/s, 18.1 s per 117-byte frame
- ultrasonic: 9.7 B/s, 12.1 s per 117-byte frame

| condition | voice | chime | ultrasonic |
| --- | --- | --- | --- |
| clean (20 dB in-band SNR) | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| in-band SNR 6 dB | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| in-band SNR 0 dB | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| in-band SNR -6 dB | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| reverb RT60 0.3 s, DRR 0 dB | 77% (68-84) | 93% (86-97) | 72% (63-80) |
| reverb RT60 0.8 s, DRR 0 dB | 55% (45-64) | 64% (54-73) | 46% (37-56) |
| radio chain (300-3000 Hz, AGC, clip, -200 ms) | 100% (96-100) | 100% (96-100) | 0% (0-4) |
| clock drift 100 ppm | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| clock drift 1000 ppm | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| collision, other sender -6 dB | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| collision, other sender 0 dB | 72% (63-80) | 86% (78-91) | 72% (63-80) |
| 0.3 s silence in sync | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| 0.3 s silence in header | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| 0.3 s silence mid-body | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| 1 s silence mid-body | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| 0.3 s loud noise burst mid-body | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| 1 s loud noise burst mid-body | 100% (96-100) | 100% (96-100) | 100% (96-100) |

## Late join

A transmitter loops one 117-byte message forever. A listener tunes in at a random moment and listens
for the same budget under both strategies: twice the whole-frame loop (about 23 s for voice). Cell: share decoded
within that budget, and median seconds from tuning in to decoding (successful trials only).
Noise bursts: 0.5 s of loud noise, on average every 4 s.

| condition | voice | chime | ultrasonic |
| --- | --- | --- | --- |
| repeat whole frame, quiet | 100% (96-100), median 16.1 s | 100% (96-100), median 25.6 s | 100% (96-100), median 17.5 s |
| fountain 60 B chunks, quiet | 100% (96-100), median 20.2 s | 100% (96-100), median 29.4 s | 99% (95-100), median 19.1 s |
| repeat whole frame, noise bursts | 48% (38-58), median 17.7 s | 52% (42-62), median 27.9 s | 52% (42-62), median 17.7 s |
| fountain 60 B chunks, noise bursts | 55% (45-64), median 20.5 s | 61% (51-70), median 31.0 s | 62% (52-71), median 19.4 s |

CPU (this machine):
- voice: 12.5 ms per audio second normal, 6.9 ms under looped sync tones (sim rate 16 kHz)
- chime: 6.1 ms per audio second normal, 7.4 ms under looped sync tones (sim rate 16 kHz)
- ultrasonic: 19.4 ms per audio second normal, 23.2 ms under looped sync tones (sim rate 48 kHz)
