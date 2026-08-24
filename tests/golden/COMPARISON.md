# Geometry implementation comparison

MCP server `src/utils/geometry` vs `makecode-minecraft-geometry-ext` @ ad23f27.

`overlap` is the Jaccard index of the two coordinate sets: 1.00 means identical,
0.00 means disjoint. A low overlap is not by itself a defect - the two use different
rasterisation strategies - but a violation column that is populated on one side and
empty on the other tells the rewrite which side to follow.

| case | MCP count / distinct | MCP violations | ext count / distinct | ext violations | overlap |
|---|---|---|---|---|---|
| sphere/r1 | 7 / 7 | - | 7 / 7 | - | 1.00 |
| sphere/r1-hollow | 7 / 7 | - | 7 / 7 | - | 1.00 |
| sphere/r2 | 33 / 33 | - | 33 / 33 | - | 1.00 |
| sphere/r2-hollow | 32 / 32 | - | 32 / 32 | - | 1.00 |
| sphere/r3 | 123 / 123 | - | 123 / 123 | - | 1.00 |
| sphere/r3-hollow | 96 / 96 | - | 96 / 96 | - | 1.00 |
| sphere/r5 | 515 / 515 | - | 515 / 515 | - | 1.00 |
| sphere/r5-hollow | 264 / 264 | - | 264 / 264 | - | 1.00 |
| sphere/r8 | 2109 / 2109 | - | 2109 / 2109 | - | 1.00 |
| sphere/r8-hollow | 744 / 744 | - | 744 / 744 | - | 1.00 |
| sphere/r2.5-non-integer | 56 / 56 | I1:56 | 123 / 123 | - | 0.00 |
| torus/R8-r3 | 1152 / 868 | I2:284 | 1348 / 1348 | - | 0.14 |
| torus/R8-r3-hollow | 672 / 492 | I2:180 | 812 / 812 | - | 0.26 |
| torus/R5-r2 | 480 / 369 | I2:111 | 364 / 364 | - | 0.22 |
| torus/R5-r2-hollow | 300 / 217 | I2:83 | 304 / 304 | - | 0.28 |
| torus/R3-r1 | 144 / 110 | I2:34 | 48 / 48 | - | 0.16 |
| torus/R3-r1-hollow | 108 / 90 | I2:18 | 48 / 48 | - | 0.15 |
| ellipsoid/r3-4-5 | 229 / 229 | - | 229 / 229 | - | 1.00 |
| ellipsoid/r1-1-1 | 7 / 7 | - | 7 / 7 | - | 1.00 |
| ellipsoid/r5-5-5 | 515 / 515 | - | 515 / 515 | - | 1.00 |
| cylinder/r3-h5 | 145 / 145 | - | 145 / 145 | - | 1.00 |
| cylinder/r5-h10 | 810 / 810 | - | 810 / 810 | - | 1.00 |
| cylinder/r1-h1 | 5 / 5 | - | 5 / 5 | - | 1.00 |
| circle/r3 | 29 / 29 | - | 29 / 29 | - | 1.00 |
| circle/r3-hollow | 20 / 20 | - | 16 / 12 | I2:4 | 0.60 |
| circle/r5 | 81 / 81 | - | 81 / 81 | - | 1.00 |
| circle/r5-hollow | 36 / 36 | - | 32 / 24 | I2:8 | 0.67 |
| circle/r10 | 317 / 317 | - | 317 / 317 | - | 1.00 |
| circle/r10-hollow | 68 / 68 | - | 56 / 52 | I2:4 | 0.58 |
| line/diagonal | 11 / 11 | - | 11 / 11 | - | 1.00 |
| line/axis-x | 11 / 11 | - | 11 / 11 | - | 1.00 |
| helix/h10-r3-t2 | 37 / 37 | - | 37 / 37 | - | 1.00 |
| helix/h20-r5-t4 | 121 / 121 | - | 121 / 121 | - | 1.00 |
| paraboloid/r5-h10 | 397 / 397 | - | 366 / 366 | - | 0.92 |
| paraboloid/r3-h8 | 115 / 115 | - | 100 / 100 | - | 0.85 |
| hyperboloid/r5-w0.5-h10 | 462 / 462 | - | 350 / 350 | - | 0.19 |
| hyperboloid/r6-w0.4-h11 | 651 / 651 | I1:651 | 351 / 351 | - | 0.00 |

## Where the implementations diverge on correctness

- only the MCP server violates an invariant: **8** case(s) - follow the extension here
- only the extension violates one: **3** case(s) - follow the MCP server here
- both violate one: **0** case(s) - neither is a safe baseline
- both clean: **26** case(s)

### MCP server violates, extension does not

- `sphere/r2.5-non-integer`: I1:56
- `torus/R8-r3`: I2:284
- `torus/R8-r3-hollow`: I2:180
- `torus/R5-r2`: I2:111
- `torus/R5-r2-hollow`: I2:83
- `torus/R3-r1`: I2:34
- `torus/R3-r1-hollow`: I2:18
- `hyperboloid/r6-w0.4-h11`: I1:651

### Extension violates, MCP server does not

- `circle/r3-hollow`: I2:4
- `circle/r5-hollow`: I2:8
- `circle/r10-hollow`: I2:4

## Argument mappings used

Where the two APIs do not line up, the pairing states the conversion.

- `sphere/r1`: identical arguments; density pinned to 1.0 because lower values sample with Math.random()
- `cylinder/r3-h5`: MCP takes an axis parameter and is pinned to "y"; the extension is always vertical
- `circle/r3-hollow`: MCP has an extra offset parameter, pinned to 0
- `helix/h10-r3-t2`: argument order differs: MCP is (start, height, radius, turns), the extension is (center, radius, height, turns)
- `hyperboloid/r5-w0.5-h10`: MCP waist is a ratio; converted to absolute radii waist=2.50 base=5.59 (rounded for the extension)
- `hyperboloid/r6-w0.4-h11`: MCP waist is a ratio; converted to absolute radii waist=2.40 base=6.46 (rounded for the extension)
