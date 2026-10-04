# world-records

Decoders for the records a Bedrock world keeps its blocks in: subchunks at every bit width,
and saved structures.

## Why it is here and not in `src/`

It is not part of the server. Nothing under `src/` imports it, and nothing needs to: reading
the world goes through the add-on, which returns block names and states directly. These
decoders are the other route that was measured — read the world file itself — and the add-on
won on the grounds that the file is a snapshot and the add-on is live.

That makes it a finding rather than a component, and `src/` is what gets compiled into the
published package. Leaving it there shipped 267 lines of dead weight to everyone who installed
the server. It sits under `tools/` with the rest of the workshop instead.

It is still tested. `test/world.test.mjs` runs it against bytes captured from a real Education
Edition 1.26.3200 world, because a decoder nobody checks is worse than no decoder — the format
notes here were wrong twice before the fixtures existed.

## Building it

```bash
npm run build:world-records
```

`npm test` does this on its way to `test/world.test.mjs`, so there is rarely a reason to run
it by hand.
