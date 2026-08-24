# @mming-lab/minecraft-bedrock-education-mcp

An MCP server for building in Minecraft Bedrock and Education Edition.

Rewrite in progress. The geometry and the build tools are done and tested; the connection to
Minecraft is not wired up yet, so the tools compute what they would place and return that
rather than placing it.

## Running

```bash
npm install
npm run build
npm start          # speaks MCP over stdio
```

```jsonc
// MCP client configuration
{
  "mcpServers": {
    "minecraft": {
      "command": "npx",
      "args": ["-y", "@mming-lab/minecraft-bedrock-education-mcp"]
    }
  }
}
```

## Testing

```bash
npm test           # tool surface, then the server end to end over stdio
npm run test:golden  # the rewritten geometry against the recorded baseline
```

`npm test` spawns the built server and drives it with a real MCP client, so a schema the SDK
rejects or a result that fails output validation shows up as a failure rather than passing
quietly in a unit test.

## Shape of the code

| path | what lives there |
|---|---|
| `src/geometry/core.ts` | Bounds, argument checks, the shell test, the position collector |
| `src/geometry/shapes.ts` | Every shape, traced by walking the voxel grid |
| `src/geometry/rotation.ts` | Rotation about a world axis |
| `src/tools/types.ts` | Shared schema pieces; a tool is data, not a subclass |
| `src/tools/build.ts` | One tool per shape |
| `src/server.ts` | The only file that knows the MCP SDK exists |

Three rules the code holds to, each because the previous version did not:

**Shapes do not decide what "hollow" means.** One function does. The old code offered
`shouldPlaceBlock` in a shared module and no calculator called it, so the torus decided
hollowness from an angle while everything else used a distance.

**Surfaces are traced by walking the grid, not by sampling a parameter.** Sampling suits a
curve; for a surface several samples land on the same block, and the old torus emitted 1152
positions covering 868 distinct blocks.

**Degenerate input throws.** Returning an empty array reads as "nothing to build" and is
indistinguishable from success, so neither the caller nor the model driving it could tell.

The reasoning behind these is in [`design/`](../../design/).
