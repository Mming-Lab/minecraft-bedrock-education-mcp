# Golden extraction report

Generated from the legacy implementation at `src/utils/`.

- cases written: 71
- bug-fixed: 14
- equivalent: 34
- spec-change: 16
- undefined-behavior: 7

## Cases that violated an invariant

These were not promoted to `equivalent` automatically. Each carries a verdict
recorded in `verdicts.json`; anything still `unreviewed` fails the suite by design.

| case | violations | verdict | rationale |
|---|---|---|---|
| sphere/r2.5-non-integer | I1:non-integer(56) | bug-fixed | A non-integer radius makes the loop variables half-integers, so the emitted coordinates are half-integers too (56 of them here). |
| ellipsoid/r3-4-5-hollow | I5:disconnected(3) | spec-change | The rewrite scales the inner surface by the shortest radius so the shell keeps an even thickness. |
| helix/flat-r4-h2-t1 | I5:disconnected(2) | bug-fixed | A wide turn over a short rise breaks into pieces: radius 4 over a rise of 2 gives 24 blocks in 2 pieces. |
| helix/flat-r8-h2-t1 | I5:disconnected(3) | bug-fixed | A wide turn over a short rise breaks into pieces: radius 8 over a rise of 2 gives 43 blocks in 3 pieces. |
| helix/flat-r12-h3-t1 | I5:disconnected(2) | bug-fixed | A wide turn over a short rise breaks into pieces: radius 12 over a rise of 3 gives 72 blocks in 2 pieces. |
| torus/R8-r3 | I2:duplicates(284) | bug-fixed | The torus iterates over angles rather than over the voxel grid, so several angular samples land on the same block: 284 duplicates here. |
| torus/R8-r3-hollow | I2:duplicates(180), I5:disconnected(9) | bug-fixed | Same angular iteration as the solid case (180 duplicates). |
| torus/R5-r2 | I2:duplicates(111) | bug-fixed | 111 duplicates from angular iteration.. |
| torus/R5-r2-hollow | I2:duplicates(83), I5:disconnected(7) | bug-fixed | 83 duplicates from angular iteration.. |
| torus/R3-r1 | I2:duplicates(34) | bug-fixed | 34 duplicates from angular iteration.. |
| torus/R3-r1-hollow | I2:duplicates(18) | bug-fixed | 18 duplicates from angular iteration.. |
| hyperboloid/r5-h5-odd | I1:non-integer(229) | bug-fixed | y = i - height/2 produces a half-integer for every odd height, so all 229 coordinates land off the block grid.. |
| hyperboloid/h1 | I1:non-integer(97) | bug-fixed | Height 1 is the smallest odd height and hits the same half-integer offset (97 coordinates).. |
| bezier/segments-1 | I5:disconnected(2) | bug-fixed | One segment across a forty-block span returns the two endpoints and nothing between them, so the "curve" is in two pieces. |
| bezier/many-controls-30 | I5:disconnected(4) | bug-fixed | bernsteinBasis builds the binomial coefficient from factorials, so factorial(171) overflows to Infinity and the basis becomes Infinity/Infinity = NaN. |

## block-optimizer coverage

The union of the emitted boxes must equal the input set exactly.

| case | input | distinct | boxes | covered | missing | extra | overlaps | exact |
|---|---|---|---|---|---|---|---|---|
| solid-cube-4x4x4 | 64 | 64 | 1 | 64 | 0 | 0 | 0 | yes |
| sphere-r5 | 515 | 515 | 43 | 515 | 0 | 0 | 0 | yes |
| hollow-sphere-r5 | 258 | 258 | 88 | 258 | 0 | 0 | 0 | yes |
| line | 11 | 11 | 7 | 11 | 0 | 0 | 0 | yes |
| single | 1 | 1 | 1 | 1 | 0 | 0 | 0 | yes |
| empty | 0 | 0 | 0 | 0 | 0 | 0 | 0 | yes |
| two-blocks-five-apart | 2 | 2 | 1 | 6 | 0 | 4 | 0 | **NO** |
| two-clusters | 16 | 16 | 1 | 48 | 0 | 32 | 0 | **NO** |
| gap-on-y | 2 | 2 | 1 | 5 | 0 | 3 | 0 | **NO** |
| gap-on-z | 2 | 2 | 1 | 8 | 0 | 6 | 0 | **NO** |
| hollow-shell-with-interior-gap | 98 | 98 | 6 | 98 | 0 | 0 | 0 | yes |
| checkerboard-8 | 32 | 32 | 32 | 32 | 0 | 0 | 0 | yes |
| duplicated-input | 3 | 1 | 1 | 1 | 0 | 0 | 0 | yes |
