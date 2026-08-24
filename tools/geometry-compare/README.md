# geometry-compare

Runs the MCP server's geometry and the MakeCode geometry extension over the same shapes and
reports where they disagree.

The MCP server is the newer codebase, but on geometry it is the weaker one. Taking it alone
as the golden baseline would freeze its defects into the rewrite, so both implementations
are measured and the rewrite follows whichever side is clean on each case.

## Usage

```bash
npm install
npm run compare                      # clones the extension at its current HEAD
node build.mjs --ext /path/to/checkout && node compare.mjs   # or use a local checkout
```

Requires `tools/golden-extract` to have been built first — it supplies the MCP side.

Output goes to `tests/golden/COMPARISON.md`.

## Reading the output

`overlap` is the Jaccard index of the two coordinate sets. A low overlap is **not** by
itself a defect: the two use different rasterisation strategies, and "hollow circle" alone
means an annulus in one and a midpoint outline in the other. What matters is the violation
columns — a case where one side is clean and the other is not tells the rewrite which side
to follow.

## Argument mappings

The two APIs do not line up, so each pairing states its conversion. The one that is not a
matter of naming:

- **hyperboloid.** The MCP server takes `waist` as a **ratio** and computes
  `r(t) = radius * sqrt(waist² + t²)`, so the waist radius is `radius*waist` and the end
  radius is `radius*sqrt(waist²+1)` — meaning `radius` is neither the waist nor the maximum.
  The extension takes `baseRadius` and `waistRadius` as **absolute** values. The comparison
  converts the ratio into the two absolute radii.

Argument order also differs for the helix (`(start, height, radius, turns)` versus
`(center, radius, height, turns)`), and the MCP server carries extra parameters the
extension does not have (`axis` on the cylinder, `offset` on the circle), which are pinned.

## Note on the extension revision

`built/REVISION` records the commit that was measured. The published extension at `ad23f27`
has three `circle/*-hollow` cases that emit duplicates; the fixes in
`.claude/agents/_geoext-fixes.patch` clear all three, which this tool confirms
independently when pointed at a patched checkout.
