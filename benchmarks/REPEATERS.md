# Content broadcast with repeaters

Simulated (`node benchmarks/repeaters.ts`, seed 1): a 2000-byte notice published as a signed pointer plus
60-byte fountain chunks on a loop, 20 listeners on a line at 1x, 2x and 4x the source's range (7, 7, 6),
budget 1200 s of virtual time. Range 1x is the distance where a chunk frame decodes 90% (in-band SNR -7 dB,
measured); SNR falls 6 dB per doubling. Repeaters relay only content they verified against the CID, from a
random chunk index, 3 loops, with listen-before-talk and Trickle-style suppression; frames that overlap at a
listener are lost. Cells: listeners that hold verified content, and the median time for that ring; T50/T90
over all 20 listeners ("never" = not within the budget).

| scenario | 1x | 2x | 4x | T50 | T90 | airtime / frames | overlapping frames |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 repeaters | 6/7, median 57 s | 0/7, median never | 0/6, median never | never | never | 1099 s / 132 | 0 |
| 1 repeater at 1x | 7/7, median 56 s | 7/7, median 121 s | 0/6, median never | 121 s | never | 1102 s / 131 | 0 |
| 3 repeaters at 1x, 2x, 3x | 7/7, median 57 s | 7/7, median 156 s | 6/6, median 451 s | 156 s | 451 s | 1117 s / 130 | 0 |
