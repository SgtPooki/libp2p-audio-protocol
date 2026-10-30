# Scorecard

Seed 1, 50 trials per cell, 117-byte frames, streamed in 4096-sample chunks.
Cells: frames decoded byte-exact, with Wilson 95% interval. Payloads, noise, rooms, colliders and join times each
draw from their own stream keyed by (seed, trial), so every preset meets the same rooms and payloads, a row's inputs
do not depend on which other rows ran, and another seed is a held-out set. Collision cells also give "both": the
share of trials where the other sender's frame decoded as well.

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
| white noise, same level for every preset (sigma 0.3) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 96% (87-99) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| white noise, same level for every preset (sigma 0.6) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 0% (0-7) | 0% (0-7) | 0% (0-7) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| in-band SNR 6 dB | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| in-band SNR 0 dB | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| in-band SNR -6 dB | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 88% (76-94) | 74% (60-84) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| reverb RT60 0.3 s, DRR 0 dB | 98% (90-100) | 94% (84-98) | 98% (90-100) | 90% (79-96) | 90% (79-96) | 98% (90-100) | 100% (93-100) | 92% (81-97) | 100% (93-100) | 98% (90-100) |
| reverb RT60 0.8 s, DRR 0 dB | 98% (90-100) | 82% (69-90) | 98% (90-100) | 100% (93-100) | 96% (87-99) | 98% (90-100) | 98% (90-100) | 94% (84-98) | 94% (84-98) | 98% (90-100) |
| radio chain (300-3000 Hz, AGC, clip, hiss, -200 ms) | 100% (93-100) | 96% (87-99) | 0% (0-7) | 100% (93-100) | 0% (0-7) | 0% (0-7) | 0% (0-7) | 0% (0-7) | 0% (0-7) | 100% (93-100) |
| laptop speaker to phone mic (150 Hz-12 kHz, soft clip) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| clock drift 100 ppm | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| clock drift 1000 ppm | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| clock drift 3000 ppm (walking speed) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| collision, other sender -6 dB | 100% (93-100), both 48% | 100% (93-100), both 2% | 100% (93-100), both 48% | 100% (93-100), both 54% | 100% (93-100), both 68% | 100% (93-100), both 52% | 100% (93-100), both 58% | 100% (93-100), both 48% | 100% (93-100), both 10% | 100% (93-100), both 50% |
| collision, other sender 0 dB | 94% (84-98), both 92% | 98% (90-100), both 98% | 94% (84-98), both 94% | 94% (84-98), both 94% | 100% (93-100), both 100% | 96% (87-99), both 96% | 96% (87-99), both 94% | 94% (84-98), both 92% | 98% (90-100), both 98% | 98% (90-100), both 98% |
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
| repeat whole frame, quiet | 100% (93-100), median 20.5 s | 100% (93-100), median 27.6 s | 100% (93-100), median 20.5 s | 100% (93-100), median 10.2 s | 100% (93-100), median 5.2 s | 100% (93-100), median 3.6 s | 100% (93-100), median 2.7 s | 100% (93-100), median 15.4 s | 100% (93-100), median 27.6 s | 100% (93-100), median 30.2 s |
| fountain 60 B chunks, quiet | 92% (81-97), median 21.8 s | 100% (93-100), median 28.7 s | 92% (81-97), median 21.8 s | 92% (81-97), median 11.0 s | 96% (87-99), median 5.8 s | 94% (84-98), median 4.1 s | 94% (84-98), median 3.0 s | 92% (81-97), median 16.4 s | 100% (93-100), median 28.8 s | 86% (74-93), median 32.5 s |
| repeat whole frame, noise bursts | 86% (74-93), median 19.5 s | 52% (39-65), median 27.9 s | 92% (81-97), median 20.7 s | 88% (76-94), median 10.2 s | 86% (74-93), median 4.9 s | 74% (60-84), median 3.4 s | 90% (79-96), median 2.5 s | 88% (76-94), median 15.4 s | 60% (46-72), median 27.9 s | 98% (90-100), median 29.4 s |
| fountain 60 B chunks, noise bursts | 82% (69-90), median 21.5 s | 62% (48-74), median 27.9 s | 86% (74-93), median 21.7 s | 78% (65-87), median 11.0 s | 72% (58-83), median 5.8 s | 64% (50-76), median 4.1 s | 60% (46-72), median 3.0 s | 84% (71-92), median 16.8 s | 70% (56-81), median 28.0 s | 80% (67-89), median 32.8 s |

CPU (this machine):
- voice: 5.7 ms per audio second normal, 5.0 ms under looped sync tones (sim rate 16 kHz)
- chime: 5.3 ms per audio second normal, 9.1 ms under looped sync tones (sim rate 16 kHz)
- ultrasonic: 16.9 ms per audio second normal, 15.3 ms under looped sync tones (sim rate 48 kHz)
- fast: 5.4 ms per audio second normal, 5.0 ms under looped sync tones (sim rate 16 kHz)
- dual: 16.9 ms per audio second normal, 22.8 ms under looped sync tones (sim rate 48 kHz)
- tri: 27.0 ms per audio second normal, 26.4 ms under looped sync tones (sim rate 48 kHz)
- turbo: 16.2 ms per audio second normal, 22.2 ms under looped sync tones (sim rate 48 kHz)
- hidden: 16.3 ms per audio second normal, 15.1 ms under looped sync tones (sim rate 48 kHz)
- music: 17.0 ms per audio second normal, 39.8 ms under looped sync tones (sim rate 48 kHz)
- robust: 5.5 ms per audio second normal, 5.0 ms under looped sync tones (sim rate 16 kHz)
