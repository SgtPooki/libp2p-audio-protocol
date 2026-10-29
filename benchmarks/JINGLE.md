# Data under a jingle

`node benchmarks/jingle.ts`, 20 trials per cell. A 60-byte frame (a link, a room code) is mixed under a looping
public-domain melody synthesized in `src/jingle.ts`, at the given level below the melody's RMS, plus a quiet noise floor.
"reverb" adds RT60 0.3 s at DRR 0 dB; "noisy" adds someone else's music at the same loudness as ours (another of the
jingles, out of step) and a loud noise floor. Cell: frames decoded byte-exact. More negative = quieter data.

### Westminster Quarters (`westminster`, 9.0 s loop)

| preset | -6 dB | -12 dB | -18 dB | -24 dB | -6 dB reverb | -12 dB reverb | -18 dB reverb | -24 dB reverb | -6 dB noisy | -12 dB noisy | -18 dB noisy | -24 dB noisy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ultrasonic | 100% | 100% | 100% | 100% | 85% | 70% | 70% | 80% | 100% | 100% | 100% | 100% |
| hidden | 100% | 100% | 100% | 100% | 90% | 70% | 75% | 60% | 100% | 100% | 90% | 0% |

### Shave and a Haircut (`shave`, 5.5 s loop)

| preset | -6 dB | -12 dB | -18 dB | -24 dB | -6 dB reverb | -12 dB reverb | -18 dB reverb | -24 dB reverb | -6 dB noisy | -12 dB noisy | -18 dB noisy | -24 dB noisy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ultrasonic | 100% | 100% | 100% | 100% | 80% | 100% | 85% | 80% | 100% | 100% | 100% | 100% |
| hidden | 100% | 100% | 100% | 100% | 85% | 75% | 80% | 50% | 100% | 100% | 100% | 0% |

### Charge! (`charge`, 2.1 s loop)

| preset | -6 dB | -12 dB | -18 dB | -24 dB | -6 dB reverb | -12 dB reverb | -18 dB reverb | -24 dB reverb | -6 dB noisy | -12 dB noisy | -18 dB noisy | -24 dB noisy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ultrasonic | 100% | 100% | 100% | 100% | 90% | 75% | 85% | 85% | 100% | 100% | 100% | 100% |
| hidden | 100% | 100% | 100% | 100% | 85% | 65% | 55% | 65% | 100% | 100% | 100% | 100% |

### Beethoven's 5th, opening (`beethoven5`, 5.2 s loop)

| preset | -6 dB | -12 dB | -18 dB | -24 dB | -6 dB reverb | -12 dB reverb | -18 dB reverb | -24 dB reverb | -6 dB noisy | -12 dB noisy | -18 dB noisy | -24 dB noisy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ultrasonic | 100% | 100% | 100% | 100% | 70% | 95% | 90% | 95% | 100% | 100% | 100% | 100% |
| hidden | 100% | 100% | 100% | 100% | 75% | 90% | 85% | 75% | 100% | 100% | 100% | 100% |
