# Golden extraction report

Generated from the legacy implementation at `src/utils/`.

- cases written: 68
- bug-fixed: 10
- equivalent: 37
- spec-change: 14
- undefined-behavior: 7

## Cases that violated an invariant

These were not promoted to `equivalent` automatically. Each carries a verdict
recorded in `verdicts.json`; anything still `unreviewed` fails the suite by design.

| case | violations | verdict | rationale |
|---|---|---|---|
| sphere/r2.5-non-integer | I1:non-integer(56) | bug-fixed | A non-integer radius makes the loop variables half-integers, so the emitted coordinates are half-integers too (56 of them here). |
| torus/R8-r3 | I2:duplicates(284) | bug-fixed | The torus iterates over angles rather than over the voxel grid, so several angular samples land on the same block: 284 duplicates here. |
| torus/R8-r3-hollow | I2:duplicates(180) | bug-fixed | Same angular iteration as the solid case (180 duplicates). |
| torus/R5-r2 | I2:duplicates(111) | bug-fixed | 111 duplicates from angular iteration.. |
| torus/R5-r2-hollow | I2:duplicates(83) | bug-fixed | 83 duplicates from angular iteration.. |
| torus/R3-r1 | I2:duplicates(34) | bug-fixed | 34 duplicates from angular iteration.. |
| torus/R3-r1-hollow | I2:duplicates(18) | bug-fixed | 18 duplicates from angular iteration.. |
| hyperboloid/r5-h5-odd | I1:non-integer(229) | bug-fixed | y = i - height/2 produces a half-integer for every odd height, so all 229 coordinates land off the block grid.. |
| hyperboloid/h1 | I1:non-integer(97) | bug-fixed | Height 1 is the smallest odd height and hits the same half-integer offset (97 coordinates).. |

## block-optimizer coverage

The union of the emitted boxes must equal the input set exactly.

| case | input | distinct | boxes | covered | missing | extra | overlaps | exact |
|---|---|---|---|---|---|---|---|---|
| solid-cube-4x4x4 | 64 | 64 | 1 | 64 | 0 | 0 | 0 | yes |
| sphere-r5 | 515 | 515 | 43 | 515 | 0 | 0 | 0 | yes |
| hollow-sphere-r5 | 264 | 264 | 83 | 264 | 0 | 0 | 0 | yes |
| line | 11 | 11 | 7 | 11 | 0 | 0 | 0 | yes |
| single | 1 | 1 | 1 | 1 | 0 | 0 | 0 | yes |
| empty | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes |
