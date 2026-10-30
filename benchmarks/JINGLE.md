# Data under a jingle

`node benchmarks/jingle.ts`, 30 trials per cell. A 60-byte frame (a link, a room code) is mixed under a looping
public-domain melody synthesized in `src/jingle.ts`, at the given level below the melody's RMS, plus a quiet noise floor.
"reverb" adds RT60 0.3 s at DRR 0 dB; "noisy" adds someone else's music at the same loudness as ours (another of the
jingles, out of step) and a loud noise floor. Cell: frames decoded byte-exact. More negative = quieter data.

### Westminster Quarters (`westminster`, 9.0 s loop)

| preset | -6 dB | -12 dB | -18 dB | -24 dB | -6 dB reverb | -12 dB reverb | -18 dB reverb | -24 dB reverb | -6 dB noisy | -12 dB noisy | -18 dB noisy | -24 dB noisy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ultrasonic | 100% | 100% | 100% | 100% | 97% | 100% | 93% | 80% | 100% | 100% | 100% | 100% |
| hidden | 100% | 100% | 100% | 100% | 97% | 100% | 93% | 97% | 100% | 100% | 100% | 0% |
| tune | 100% | 100% | 100% | 100% | 100% | 93% | 97% | 90% | 63% | 63% | 70% | 67% |

### Shave and a Haircut (`shave`, 5.5 s loop)

| preset | -6 dB | -12 dB | -18 dB | -24 dB | -6 dB reverb | -12 dB reverb | -18 dB reverb | -24 dB reverb | -6 dB noisy | -12 dB noisy | -18 dB noisy | -24 dB noisy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ultrasonic | 100% | 100% | 100% | 100% | 100% | 87% | 97% | 97% | 100% | 100% | 100% | 100% |
| hidden | 100% | 100% | 100% | 100% | 97% | 87% | 100% | 97% | 100% | 100% | 100% | 0% |
| tune | 100% | 100% | 100% | 100% | 97% | 90% | 83% | 93% | 97% | 100% | 97% | 97% |

### Charge! (`charge`, 2.1 s loop)

| preset | -6 dB | -12 dB | -18 dB | -24 dB | -6 dB reverb | -12 dB reverb | -18 dB reverb | -24 dB reverb | -6 dB noisy | -12 dB noisy | -18 dB noisy | -24 dB noisy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ultrasonic | 100% | 100% | 100% | 100% | 90% | 93% | 87% | 93% | 100% | 100% | 100% | 100% |
| hidden | 100% | 100% | 100% | 100% | 97% | 97% | 90% | 100% | 100% | 100% | 100% | 100% |
| tune | 100% | 100% | 100% | 100% | 77% | 70% | 73% | 63% | 100% | 100% | 100% | 100% |

### Beethoven's 5th, opening (`beethoven5`, 5.2 s loop)

| preset | -6 dB | -12 dB | -18 dB | -24 dB | -6 dB reverb | -12 dB reverb | -18 dB reverb | -24 dB reverb | -6 dB noisy | -12 dB noisy | -18 dB noisy | -24 dB noisy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ultrasonic | 100% | 100% | 100% | 100% | 97% | 93% | 97% | 93% | 100% | 100% | 100% | 100% |
| hidden | 100% | 100% | 100% | 100% | 97% | 97% | 97% | 100% | 100% | 100% | 100% | 100% |
| tune | 100% | 100% | 100% | 100% | 87% | 93% | 73% | 97% | 100% | 100% | 100% | 100% |
