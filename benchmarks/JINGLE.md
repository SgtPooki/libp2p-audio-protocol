# Data under a jingle

`node benchmarks/jingle.ts`, 20 trials per cell. A 60-byte frame (a link, a room code) is mixed under a looping
public-domain melody synthesized in `src/jingle.ts`, at the given level below the melody's RMS, plus a quiet noise floor.
"reverb" adds RT60 0.3 s at DRR 0 dB; "noisy" adds someone else's music at the same loudness as ours (another of the
jingles, out of step) and a loud noise floor. Cell: frames decoded byte-exact. More negative = quieter data.

### Westminster Quarters (`westminster`, 9.0 s loop)

| preset | -6 dB | -12 dB | -18 dB | -24 dB | -6 dB reverb | -12 dB reverb | -18 dB reverb | -24 dB reverb | -6 dB noisy | -12 dB noisy | -18 dB noisy | -24 dB noisy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hidden | 100% | 100% | 100% | 100% | 70% | 80% | 75% | 60% | 100% | 100% | 95% | 0% |
| fast | 100% | 100% | 30% | 0% | 75% | 45% | 0% | 0% | 95% | 25% | 0% | 0% |
| voice | 100% | 100% | 45% | 0% | 65% | 40% | 10% | 0% | 100% | 55% | 0% | 0% |
| ultrasonic | 100% | 100% | 100% | 100% | 80% | 80% | 75% | 90% | 100% | 100% | 100% | 95% |

### Shave and a Haircut (`shave`, 5.5 s loop)

| preset | -6 dB | -12 dB | -18 dB | -24 dB | -6 dB reverb | -12 dB reverb | -18 dB reverb | -24 dB reverb | -6 dB noisy | -12 dB noisy | -18 dB noisy | -24 dB noisy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hidden | 100% | 100% | 100% | 100% | 80% | 65% | 75% | 80% | 100% | 100% | 100% | 0% |
| fast | 100% | 100% | 100% | 70% | 70% | 60% | 40% | 0% | 95% | 30% | 0% | 0% |
| voice | 100% | 100% | 100% | 100% | 85% | 85% | 50% | 25% | 100% | 85% | 0% | 0% |
| ultrasonic | 100% | 100% | 100% | 100% | 80% | 80% | 95% | 70% | 100% | 100% | 100% | 100% |

### Charge! (`charge`, 2.1 s loop)

| preset | -6 dB | -12 dB | -18 dB | -24 dB | -6 dB reverb | -12 dB reverb | -18 dB reverb | -24 dB reverb | -6 dB noisy | -12 dB noisy | -18 dB noisy | -24 dB noisy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hidden | 100% | 100% | 100% | 100% | 80% | 80% | 70% | 65% | 100% | 100% | 100% | 10% |
| fast | 100% | 0% | 0% | 0% | 10% | 0% | 0% | 0% | 100% | 0% | 0% | 0% |
| voice | 100% | 100% | 0% | 0% | 70% | 15% | 0% | 0% | 100% | 100% | 0% | 0% |
| ultrasonic | 100% | 100% | 100% | 100% | 85% | 90% | 90% | 75% | 100% | 100% | 100% | 100% |

### Beethoven's 5th, opening (`beethoven5`, 5.2 s loop)

| preset | -6 dB | -12 dB | -18 dB | -24 dB | -6 dB reverb | -12 dB reverb | -18 dB reverb | -24 dB reverb | -6 dB noisy | -12 dB noisy | -18 dB noisy | -24 dB noisy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hidden | 100% | 100% | 100% | 100% | 80% | 85% | 85% | 85% | 100% | 100% | 100% | 20% |
| fast | 100% | 100% | 0% | 0% | 65% | 5% | 0% | 0% | 100% | 55% | 0% | 0% |
| voice | 100% | 100% | 80% | 0% | 70% | 50% | 0% | 0% | 100% | 100% | 0% | 0% |
| ultrasonic | 100% | 100% | 100% | 100% | 70% | 95% | 75% | 85% | 100% | 100% | 100% | 100% |
