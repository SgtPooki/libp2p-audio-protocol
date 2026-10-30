# Scorecard

Seed 1, 50 trials per cell, 117-byte frames, streamed in 4096-sample chunks.
Cells: frames decoded byte-exact, with Wilson 95% interval.

- voice: 8.8 B/s, 13.4 s per 117-byte frame
- chime: 6.5 B/s, 18.1 s per 117-byte frame
- ultrasonic: 8.8 B/s, 13.4 s per 117-byte frame
- fast: 17.5 B/s, 6.7 s per 117-byte frame
- dual: 33.4 B/s, 3.5 s per 117-byte frame
- tri: 48.0 B/s, 2.4 s per 117-byte frame
- turbo: 66.9 B/s, 1.8 s per 117-byte frame
- hidden: 11.7 B/s, 10.0 s per 117-byte frame
- music: 6.5 B/s, 18.1 s per 117-byte frame
- robust: 6.0 B/s, 19.6 s per 117-byte frame

| condition | voice | chime | ultrasonic | fast | dual | tri | turbo | hidden | music | robust |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| clean (20 dB in-band SNR) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| white noise, same level for every preset (sigma 0.3) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 98% (90-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| white noise, same level for every preset (sigma 0.6) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 0% (0-7) | 0% (0-7) | 0% (0-7) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| in-band SNR 6 dB | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| in-band SNR 0 dB | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| in-band SNR -6 dB | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 92% (81-97) | 76% (63-86) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| reverb RT60 0.3 s, DRR 0 dB | 94% (84-98) | 98% (90-100) | 94% (84-98) | 86% (74-93) | 86% (74-93) | 96% (87-99) | 100% (93-100) | 92% (81-97) | 98% (90-100) | 98% (90-100) |
| reverb RT60 0.8 s, DRR 0 dB | 100% (93-100) | 80% (67-89) | 96% (87-99) | 100% (93-100) | 96% (87-99) | 98% (90-100) | 98% (90-100) | 98% (90-100) | 96% (87-99) | 100% (93-100) |
| radio chain (300-3000 Hz, AGC, clip, -200 ms) | 100% (93-100) | 100% (93-100) | 0% (0-7) | 100% (93-100) | 0% (0-7) | 0% (0-7) | 0% (0-7) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| clock drift 100 ppm | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| clock drift 1000 ppm | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| clock drift 3000 ppm (walking speed) | 100% (93-100) | 100% (93-100) | 96% (87-99) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| collision, other sender -6 dB | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| collision, other sender 0 dB | 98% (90-100) | 100% (93-100) | 98% (90-100) | 94% (84-98) | 98% (90-100) | 98% (90-100) | 90% (79-96) | 98% (90-100) | 100% (93-100) | 100% (93-100) |
| 0.3 s silence in sync | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| 0.3 s silence in header | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| 0.3 s silence mid-body | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| 1 s silence mid-body | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 0% (0-7) | 0% (0-7) | 0% (0-7) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| 0.3 s loud noise burst mid-body | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| 1 s loud noise burst mid-body | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 0% (0-7) | 0% (0-7) | 0% (0-7) | 100% (93-100) | 100% (93-100) | 100% (93-100) |

## Late join

A transmitter loops one 117-byte message forever. A listener tunes in at a random moment and listens
for the same budget under both strategies: twice the whole-frame loop (about 23 s for voice). Cell: share decoded
within that budget, and median seconds from tuning in to decoding (successful trials only).
Noise bursts: 0.5 s of loud noise, on average every 4 s.

| condition | voice | chime | ultrasonic | fast | dual | tri | turbo | hidden | music | robust |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| repeat whole frame, quiet | 100% (93-100), median 17.9 s | 100% (93-100), median 25.1 s | 100% (93-100), median 18.6 s | 100% (93-100), median 9.7 s | 100% (93-100), median 5.3 s | 100% (93-100), median 3.1 s | 100% (93-100), median 2.5 s | 100% (93-100), median 14.3 s | 100% (93-100), median 25.7 s | 100% (93-100), median 28.4 s |
| fountain 60 B chunks, quiet | 100% (93-100), median 22.0 s | 100% (93-100), median 29.4 s | 94% (84-98), median 23.2 s | 86% (74-93), median 11.0 s | 92% (81-97), median 6.1 s | 94% (84-98), median 4.2 s | 96% (87-99), median 3.1 s | 98% (90-100), median 16.6 s | 100% (93-100), median 29.3 s | 96% (87-99), median 34.0 s |
| repeat whole frame, noise bursts | 88% (76-94), median 18.2 s | 54% (40-67), median 24.3 s | 96% (87-99), median 19.6 s | 82% (69-90), median 9.5 s | 82% (69-90), median 4.8 s | 64% (50-76), median 3.6 s | 70% (56-81), median 2.9 s | 84% (71-92), median 15.1 s | 44% (31-58), median 21.8 s | 98% (90-100), median 29.7 s |
| fountain 60 B chunks, noise bursts | 86% (74-93), median 22.3 s | 44% (31-58), median 27.4 s | 82% (69-90), median 22.6 s | 80% (67-89), median 11.3 s | 62% (48-74), median 5.8 s | 66% (52-78), median 4.4 s | 66% (52-78), median 3.0 s | 86% (74-93), median 16.6 s | 64% (50-76), median 28.2 s | 86% (74-93), median 35.1 s |

CPU (this machine):
- voice: 6.2 ms per audio second normal, 8.1 ms under looped sync tones (sim rate 16 kHz)
- chime: 9.7 ms per audio second normal, 8.0 ms under looped sync tones (sim rate 16 kHz)
- ultrasonic: 25.7 ms per audio second normal, 22.0 ms under looped sync tones (sim rate 48 kHz)
- fast: 8.5 ms per audio second normal, 7.2 ms under looped sync tones (sim rate 16 kHz)
- dual: 42.4 ms per audio second normal, 36.0 ms under looped sync tones (sim rate 48 kHz)
- tri: 42.1 ms per audio second normal, 41.9 ms under looped sync tones (sim rate 48 kHz)
- turbo: 32.5 ms per audio second normal, 33.5 ms under looped sync tones (sim rate 48 kHz)
- hidden: 23.1 ms per audio second normal, 21.5 ms under looped sync tones (sim rate 48 kHz)
- music: 25.0 ms per audio second normal, 26.6 ms under looped sync tones (sim rate 48 kHz)
- robust: 7.5 ms per audio second normal, 7.0 ms under looped sync tones (sim rate 16 kHz)
