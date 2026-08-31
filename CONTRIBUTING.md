# Contributing

```bash
npm run verify    # build, twenty suites, and the geometry goldens
```

Everything runs without Minecraft. The end-to-end test spawns the server as a child process and
drives it with a fake Bedrock client over a real socket, so "an MCP call becomes a fill on the
wire" is checked rather than assumed. Twice in one day a tool passed every unit test and was
broken over the wire; that is what the rule is for.

`tools/live-probe/` is the rig for the things only a real game can settle. It holds one
connection open and lets rigs be swapped underneath it, because a live session is scarce:
someone has to launch the game and type `/connect`.

## Shape of the code

| path | what lives there |
|---|---|
| `src/geometry/core.ts` | Bounds, argument checks, the shell test, the position collector |
| `src/geometry/shapes.ts` | Every shape, traced by walking the voxel grid |
| `src/geometry/rotation.ts` | Rotation about a world axis |
| `src/commands/` | Command strings as pure functions; coordinate frames separated by type |
| `src/commands/optimize.ts` | Packing positions into as few `/fill` boxes as they will go |
| `src/execute/placer.ts` | Sending those fills, capped at 64 in flight |
| `src/plan/store.ts` | Plans a build has worked out but not placed |
| `src/render/png.ts` | Plans into pictures, with no image dependency |
| `src/bridge/protocol.ts` | The wire format to the add-on: splitting, reassembly, loss detection |
| `src/bridge/transport.ts` | The socket, over socket-be |
| `src/world/layers.ts` | Region to layer grid |
| `src/world/records.ts` | Decoders for the world database (subchunks, structures) |
| `addon/` | The behaviour pack that runs inside the game, shipped with the package |
| `src/tools/` | A tool is data, not a subclass |
| `src/server.ts` | The only file that knows the MCP SDK exists |

## Rules the code holds to, each because the previous version did not

**Shapes do not decide what "hollow" means.** One function does. The old code offered
`shouldPlaceBlock` in a shared module and no calculator called it, so the torus decided
hollowness from an angle while everything else used a distance.

**Surfaces are traced by walking the grid, not by sampling a parameter.** Sampling suits a
curve; for a surface several samples land on the same block, and the old torus emitted 1152
positions covering 868 distinct blocks.

**Degenerate input throws.** Returning an empty array reads as "nothing to build" and is
indistinguishable from success, so neither the caller nor the model driving it could tell.

**"Not looked at" is never flattened into "empty".** An unloaded chunk, a timed-out read and a
part of a region that went missing are all distinct from air. Flattening any of them would have
a model conclude a space is free and build into whatever is standing there.

**Nothing is dropped in silence.** A batch names the entries that lost their blocks and counts
the ones it had no room to name; a partial read marks the part nobody saw.

**Bedrock's status codes are reported, not interpreted.** They do not mean what they look like
they mean, and the messages are translated into the client's language.
