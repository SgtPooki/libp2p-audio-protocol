# Scorecard

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
| reverb RT60 0.3 s, DRR 0 dB | 71% (61-79) | 94% (88-97) | 68% (58-76) |
| reverb RT60 0.8 s, DRR 0 dB | 54% (44-63) | 57% (47-66) | 51% (41-61) |
| radio chain (300-3000 Hz, AGC, clip, -200 ms) | 100% (96-100) | 100% (96-100) | 0% (0-4) |
| clock drift 100 ppm | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| clock drift 1000 ppm | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| collision, other sender -6 dB | 100% (96-100) | 100% (96-100) | 99% (95-100) |
| collision, other sender 0 dB | 60% (50-69) | 88% (80-93) | 67% (57-75) |
| 0.3 s silence in sync | 0% (0-4) | 0% (0-4) | 0% (0-4) |
| 0.3 s silence in header | 0% (0-4) | 0% (0-4) | 0% (0-4) |
| 0.3 s silence mid-body | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| 1 s silence mid-body | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| 0.3 s loud noise burst mid-body | 100% (96-100) | 100% (96-100) | 100% (96-100) |
| 1 s loud noise burst mid-body | 100% (96-100) | 100% (96-100) | 100% (96-100) |

## Late join

A transmitter loops one 117-byte message forever. A listener tunes in at a random moment and listens
for 2 loops. Cell: share decoded within those 2 loops, and median seconds from tuning in to decoding.
Noise bursts: 0.5 s of loud noise, on average every 4 s.

| condition | voice | chime | ultrasonic |
| --- | --- | --- | --- |
| repeat whole frame, quiet | 100% (96-100), median 16.9 s | 100% (96-100), median 26.6 s | 100% (96-100), median 16.8 s |
| fountain 60 B chunks, quiet | 100% (96-100), median 18.4 s | 100% (96-100), median 28.9 s | 100% (96-100), median 18.9 s |
| repeat whole frame, noise bursts | 39% (30-49), median 18.2 s | 40% (31-50), median 26.9 s | 50% (40-60), median 17.8 s |
| fountain 60 B chunks, noise bursts | 72% (63-80), median 22.3 s | 70% (60-78), median 31.5 s | 80% (71-87), median 22.4 s |

CPU (this machine):
- voice: 1.4 ms per audio second normal, 5.2 ms under looped sync tones (sim rate 16 kHz)
- chime: 1.2 ms per audio second normal, 5.3 ms under looped sync tones (sim rate 16 kHz)
- ultrasonic: 4.7 ms per audio second normal, 17.8 ms under looped sync tones (sim rate 48 kHz)
