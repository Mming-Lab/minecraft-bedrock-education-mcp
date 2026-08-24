# golden-extract

Records what the legacy geometry implementation produces, so the rewrite can be measured
against it — without inheriting its defects.

## Why not a plain golden test

A plain golden test asserts "the new code matches the old code". Applied here that would
freeze ten known defects into the rewrite: half-integer coordinates that `setblock` cannot
accept, a torus that emits the same block up to 284 times, a Bézier basis that overflows
to `NaN`.

So every case carries a **verdict**, and `bug-fixed` inverts the assertion:

| verdict | what the rewrite must do |
|---|---|
| `equivalent` | reproduce the recorded output exactly |
| `bug-fixed` | **not** reproduce it, and satisfy the listed invariants |
| `undefined-behavior` | throw, rather than return an empty array silently |
| `spec-change` | reported for a human; expectation written by hand |
| `unreviewed` | hard failure — a violation reached the suite without a judgment |

Nothing is promoted to `equivalent` by hand-waving: `extract.mjs` promotes a case only when
it violates none of the invariants, and queues everything else for a written judgment in
`verdicts.json`.

## Layout

| file | role |
|---|---|
| `build.mjs` | compiles the legacy sources; **fails if tsc reports anything but the three known errors** |
| `cases.mjs` | the case matrix, shared by extraction and validation so the two cannot drift |
| `extract.mjs` | runs the matrix against the legacy code and writes `tests/golden/` |
| `verdicts.json` | the human judgments, kept apart so re-extraction never overwrites them |
| `validate.mjs` | checks an implementation against the goldens |

## Usage

```bash
npm install
npm run extract            # regenerate tests/golden/ from src/utils/
npm run validate:legacy    # self-test: must FAIL on the bug-fixed cases
```

`validate:legacy` pointing at the legacy code is the suite's own test. It should report
**49 passed, 17 failed** — the failures being exactly the ten `bug-fixed` and seven
`undefined-behavior` cases. If it ever passes everything, the inverted assertion has
stopped working and the goldens are no longer protecting anything.

To check a rewrite:

```bash
node validate.mjs --geometry ../../dist/utils/geometry/index.js \
                  --math     ../../dist/utils/math/index.js \
                  --optimizer ../../dist/utils/block-optimizer.js
```

## Invariants

| id | property |
|---|---|
| I1 | every coordinate is an integer |
| I2 | no duplicated coordinates |
| I4 | every coordinate lies within the world bounds |
| I9 | no `NaN` or `Infinity` |

`I3` (a valid input produces a non-empty result) is applied during extraction rather than
stored, because whether an empty result is correct depends on the case.

## Notes

- `dist-legacy/` and `node_modules/` are generated; both are ignored.
- Large cases (over 2000 positions) store a SHA-256 of the normalised coordinate list plus
  a bounding box and centroid, instead of the full list. The diagnostics are what make a
  mismatch debuggable — a bare hash only says "different".
- Duplicates and non-integer coordinates are recorded, not normalised away. Whether the
  legacy code emits them is precisely what is being measured.
