# Scorecard

Seed 1, 50 trials per cell, 117-byte frames, streamed in 4096-sample chunks.
Cells: frames decoded byte-exact, with Wilson 95% interval.

- voice: 8.8 B/s, 13.4 s per 117-byte frame
- chime: 6.5 B/s, 18.1 s per 117-byte frame
- ultrasonic: 9.7 B/s, 12.1 s per 117-byte frame
- fast: 17.5 B/s, 6.7 s per 117-byte frame
- dual: 33.4 B/s, 3.5 s per 117-byte frame
- tri: 48.0 B/s, 2.4 s per 117-byte frame
- turbo: 66.9 B/s, 1.8 s per 117-byte frame
- hidden: 12.9 B/s, 9.1 s per 117-byte frame
- music: 6.5 B/s, 18.1 s per 117-byte frame

| condition | voice | chime | ultrasonic | fast | dual | tri | turbo | hidden | music |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| clean (20 dB in-band SNR) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| in-band SNR 6 dB | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| in-band SNR 0 dB | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| in-band SNR -6 dB | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 44% (31-58) | 100% (93-100) | 100% (93-100) |
| reverb RT60 0.3 s, DRR 0 dB | 86% (74-93) | 96% (87-99) | 82% (69-90) | 82% (69-90) | 84% (71-92) | 92% (81-97) | 92% (81-97) | 56% (42-69) | 96% (87-99) |
| reverb RT60 0.8 s, DRR 0 dB | 78% (65-87) | 78% (65-87) | 52% (39-65) | 96% (87-99) | 100% (93-100) | 98% (90-100) | 98% (90-100) | 54% (40-67) | 76% (63-86) |
| radio chain (300-3000 Hz, AGC, clip, -200 ms) | 100% (93-100) | 100% (93-100) | 0% (0-7) | 100% (93-100) | 0% (0-7) | 0% (0-7) | 0% (0-7) | 0% (0-7) | 100% (93-100) |
| clock drift 100 ppm | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| clock drift 1000 ppm | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| collision, other sender -6 dB | 100% (93-100) | 100% (93-100) | 100% (93-100) | 92% (81-97) | 90% (79-96) | 90% (79-96) | 94% (84-98) | 100% (93-100) | 100% (93-100) |
| collision, other sender 0 dB | 90% (79-96) | 90% (79-96) | 58% (44-71) | 92% (81-97) | 84% (71-92) | 72% (58-83) | 68% (54-79) | 70% (56-81) | 78% (65-87) |
| 0.3 s silence in sync | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| 0.3 s silence in header | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| 0.3 s silence mid-body | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| 1 s silence mid-body | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 0% (0-7) | 0% (0-7) | 0% (0-7) | 38% (26-52) | 100% (93-100) |
| 0.3 s loud noise burst mid-body | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) |
| 1 s loud noise burst mid-body | 100% (93-100) | 100% (93-100) | 100% (93-100) | 100% (93-100) | 0% (0-7) | 0% (0-7) | 0% (0-7) | 8% (3-19) | 100% (93-100) |

## Late join

A transmitter loops one 117-byte message forever. A listener tunes in at a random moment and listens
for the same budget under both strategies: twice the whole-frame loop (about 23 s for voice). Cell: share decoded
within that budget, and median seconds from tuning in to decoding (successful trials only).
Noise bursts: 0.5 s of loud noise, on average every 4 s.

| condition | voice | chime | ultrasonic | fast | dual | tri | turbo | hidden | music |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| repeat whole frame, quiet | 100% (93-100), median 19.2 s | 100% (93-100), median 25.6 s | 100% (93-100), median 16.3 s | 100% (93-100), median 10.0 s | 100% (93-100), median 4.8 s | 100% (93-100), median 3.2 s | 100% (93-100), median 2.1 s | 100% (93-100), median 12.5 s | 100% (93-100), median 27.3 s |
| fountain 60 B chunks, quiet | 92% (81-97), median 22.5 s | 100% (93-100), median 30.5 s | 100% (93-100), median 20.3 s | 90% (79-96), median 11.5 s | 90% (79-96), median 6.0 s | 98% (90-100), median 4.0 s | 96% (87-99), median 3.2 s | 100% (93-100), median 14.6 s | 100% (93-100), median 27.6 s |
| repeat whole frame, noise bursts | 96% (87-99), median 18.4 s | 36% (24-50), median 26.9 s | 36% (24-50), median 19.0 s | 88% (76-94), median 9.5 s | 84% (71-92), median 4.9 s | 58% (44-71), median 3.4 s | 72% (58-83), median 2.6 s | 58% (44-71), median 14.1 s | 58% (44-71), median 26.9 s |
| fountain 60 B chunks, noise bursts | 84% (71-92), median 22.3 s | 60% (46-72), median 31.5 s | 44% (31-58), median 20.7 s | 76% (63-86), median 10.8 s | 66% (52-78), median 6.1 s | 50% (37-63), median 4.3 s | 52% (39-65), median 3.3 s | 46% (33-60), median 14.1 s | 54% (40-67), median 31.0 s |

CPU (this machine):
- voice: 5.8 ms per audio second normal, 7.8 ms under looped sync tones (sim rate 16 kHz)
- chime: 7.5 ms per audio second normal, 10.8 ms under looped sync tones (sim rate 16 kHz)
- ultrasonic: 25.0 ms per audio second normal, 30.0 ms under looped sync tones (sim rate 48 kHz)
- fast: 8.5 ms per audio second normal, 8.1 ms under looped sync tones (sim rate 16 kHz)
- dual: 25.6 ms per audio second normal, 35.8 ms under looped sync tones (sim rate 48 kHz)
- tri: 38.6 ms per audio second normal, 41.9 ms under looped sync tones (sim rate 48 kHz)
- turbo: 25.6 ms per audio second normal, 35.6 ms under looped sync tones (sim rate 48 kHz)
- hidden: 7.4 ms per audio second normal, 8.0 ms under looped sync tones (sim rate 16 kHz)
- music: 24.5 ms per audio second normal, 26.2 ms under looped sync tones (sim rate 48 kHz)
