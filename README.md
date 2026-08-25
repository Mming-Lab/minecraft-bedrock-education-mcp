# minecraft-bedrock-education-mcp

[日本語版 README はこちら / Japanese README here](README_ja.md)

<a href="https://glama.ai/mcp/servers/Mming-Lab/minecraft-bedrock-education-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@Mming-Lab/minecraft-bedrock-mcp-server/badge" alt="Minecraft Bedrock Education MCP server" />
</a>

> **v2 — rewritten.** The single-package implementation that used to live here is tagged
> [`legacy/v1.0.0`](../../releases/tag/legacy/v1.0.0) and still builds and runs; `git clone -b legacy/v1.0.0`
> gets it with its own README. It required Node 16, exposed twenty tools, and could not read the
> world at all. This version needs **Node 22**, lives in [`packages/server`](packages/server),
> and reads as well as builds — which needs the add-on in [`packages/server/addon`](packages/server/addon).

An MCP server that lets a model build in Minecraft Education — and, unlike its predecessor,
look at what it built.

Twenty-three tools: nine shapes, a layer grid, a region copier, ten for reading the world, and two for measuring what is there. The reading half is
the point. A tool that places blocks and cannot see them leaves a model guessing whether the
tower landed where it meant, so it cannot correct itself; it can only build again and hope.

## What it needs

- **Minecraft Education 1.26 or later**, on **the same machine** as this server. The game
  connects to the server, not the other way round, and the tools that read the world go
  through an add-on running inside it.
- **Node 22 or later.**
- Windows, for the add-on installer. The server itself has no platform requirement; only the
  path to Minecraft's pack folder does.

Bedrock Edition works for building. Reading needs the add-on, which needs the Script API.

## Setting it up

Three steps, in this order. The middle one is the one people skip.

### 1. Install the add-on

This step is done by a person, and mostly cannot be anything else — two of its three parts are
things only someone at the keyboard can do. The script copies files; that is all it automates.

```bash
npx -p @mming-lab/minecraft-bedrock-education-mcp mcp-bridge-install
```

From a checkout of this repository, that is `node packages/server/addon/install.mjs`. Copying
the `addon` folder by hand into `development_behavior_packs` does the same thing; the script
exists because it also reports what is already installed, and because it ends by telling you
about the two steps below rather than saying "done".

Then, and this is the part that gets skipped:

- **Close Minecraft Education completely and open it again.** Pack folders are scanned when
  the game launches and at no other time. Reloading the world is not enough — the game keeps
  running the script it loaded at startup and gives no sign that it is doing so. A day was
  lost to this once.
- **Activate "MCP Bridge" in the world's behaviour pack settings.** A world that has never had
  it activated will not load it.

Adding `--check` reports versions without changing anything. Note
what it compares: files on disk. What the game is *running* can be older than both, and only
`world.bridge_status` can tell you that.

### 2. Point an MCP client at the server

```json
{
  "mcpServers": {
    "minecraft": {
      "command": "node",
      "args": ["path/to/packages/server/dist/index.js"]
    }
  }
}
```

Once the package is published, that becomes:

```json
{ "mcpServers": { "minecraft": {
    "command": "npx",
    "args": ["-y", "@mming-lab/minecraft-bedrock-education-mcp"] } } }
```

with no checkout and no build step — the add-on ships inside the package, which is why step 1
works from `npx` too. It is not published yet, so the path above is what works today.

Options, as flags or environment variables:

| Flag | Variable | Default | |
|---|---|---|---|
| `--port N` | `MINECRAFT_MCP_PORT` | 19131 | What `/connect` dials |
| `--host H` | `MINECRAFT_MCP_HOST` | all interfaces | Set to `127.0.0.1` to refuse other machines |
| `--no-encryption` | `MINECRAFT_MCP_NO_ENCRYPTION` | off | **See below** |

**Encryption has to match the game, and a mismatch is silent.** If the game is set to refuse
encrypted sessions, `/connect` appears to work and then nothing ever answers — which looks
exactly like a `/connect` nobody typed. If your connection goes quiet, try the other setting
before looking anywhere else.

### 3. Connect from inside the game

Open the chat and run:

```
/connect localhost:19131
```

Nothing is connected until this happens, and the server cannot do it for you. The world tools
are registered either way: calling one before connecting comes back with this line rather than
with a failure, so the model can pass it on.

## The tools

### Building

| | |
|---|---|
| `build.cube` | Fill a box between two corners |
| `build.sphere` | Sphere, or an ellipsoid with three radii |
| `build.cylinder` `build.cone` `build.torus` | As named; `hollow` gives a one-block shell |
| `build.revolution` | Paraboloid, hyperboloid and friends |
| `build.line` `build.helix` `build.curve` | Lines, spirals, Bézier curves |
| `build.layers` | **A grid of characters, one per block** |
| `build.clone_region` | Copy or move blocks that already exist, **keeping their states** |

Everything above packs into `/fill` commands — a radius-5 sphere is 515 blocks in 43 fills,
about a quarter of a second.

### Reading

| | |
|---|---|
| `world.players` | Where everyone is. **Start here** — every other reading tool needs coordinates, and nothing else can supply the first ones |
| `world.agent` | Where the Agent is, and deliberately without summoning one |
| `world.bridge_status` | Connected? Add-on loaded? Which version? **Start here when something is wrong** |
| `world.get_block` | One block, with its states |
| `world.read_region` | Up to 4096 blocks as a layer grid |
| `world.entities` | Mobs, players, dropped items — the one thing no other route can answer |
| `world.container` | What is in a chest |
| `world.load_area` `world.unload_area` `world.loaded_areas` | Keep distant chunks loaded so they can be read at all — **and running, so remove them after** |

### Measuring

| | |
|---|---|
| `assess.symmetry` | How well a build matches itself, mirrored or turned — and **where** it does not |
| `assess.composition` | Dimensions, footprint, how much is air, what it is made of |

Neither returns a score. They return how many pairs matched and which ones did not, because a
mark out of ten cannot tell a child who mirrored a castle badly from a child who built an
asymmetric one on purpose — and only one of those wants correcting. A pair where one side was
in an unloaded chunk is counted apart from both, so a slow chunk load never reports a careful
build as lopsided.

## Why a region comes back as a grid

`world.read_region` answers in horizontal layers of single characters with a palette, not a
list of names:

```
y = -34
  .............
  ......a......
  ...aaaaaaa...
  ..aaaaaaaaa..
  .aaaaaaaaaaa.
```

Four thousand blocks become four thousand characters, which is smaller — but the reason is
that it is *arranged the way the thing is arranged*. A wall is a run of one character. The
same notation goes back into `build.layers`, so the loop is: read a region, change the
characters you want changed, send it back.

Two characters are reserved and they are not interchangeable:

- **`.` is air.** Somebody looked, and there was nothing there. Writing it clears the block.
- **`?` was not read** — the chunk was not loaded, so nobody looked. Writing it **leaves the
  block alone**.

That pairing is what makes a partial edit safe. A region that came back partly unread can be
written straight back without clearing ground nobody has seen.

**The grid carries ids, not block states.** A staircase reads back as `oak_stairs` with no
facing, and writing it somewhere else puts it down facing the default direction. Read a
position with `world.get_block` when the state matters, and move things that have states with
`build.clone_region`, which never converts them to characters at all.

## When it does not work

Ask `world.bridge_status` first. It answers rather than failing, because it is the tool you
reach for when the others are failing, and it distinguishes the three cases:

| It says | Then |
|---|---|
| `connected: false` | Nobody has run `/connect` — or the encryption settings disagree |
| `upToDate: false` | The game is running an older add-on than the files on disk. **Close and reopen Minecraft**; reloading the world will not do it |
| everything fine | The problem is in the request, and the failing tool will have said what |

A build that reports `negative` entries is usually fine. Bedrock's status codes are not
verdicts: `0 blocks filled` is negative and means the fill ran and matched nothing, and
`cannot be placed` means the block was already there. To find out whether something is
actually in the world, read it.

## Development

```bash
npm run verify    # build, fourteen suites, and the geometry goldens
```

Everything runs without Minecraft. The end-to-end test spawns the server as a child process
and drives it with a fake Bedrock client over a real socket, so "an MCP call becomes a fill on
the wire" is checked rather than assumed.

`tools/live-probe/` is the rig for the things only a real game can settle. It holds one
connection open and lets rigs be swapped underneath it, because a live session is scarce:
someone has to launch the game and type `/connect`.

### Shape of the code

| path | what lives there |
|---|---|
| `src/geometry/core.ts` | Bounds, argument checks, the shell test, the position collector |
| `src/geometry/shapes.ts` | Every shape, traced by walking the voxel grid |
| `src/geometry/rotation.ts` | Rotation about a world axis |
| `src/commands/` | Command strings as pure functions; coordinate frames separated by type |
| `src/commands/optimize.ts` | Packing positions into as few `/fill` boxes as they will go |
| `src/execute/placer.ts` | Sending those fills, capped at 64 in flight |
| `src/bridge/protocol.ts` | The wire format to the add-on: splitting, reassembly, loss detection |
| `src/bridge/transport.ts` | The socket, over socket-be |
| `src/world/layers.ts` | Region to layer grid |
| `addon/` | The behaviour pack that runs inside the game, shipped with the package |
| `src/world/records.ts` | Decoders for the world database (subchunks, structures) |
| `src/tools/` | A tool is data, not a subclass |
| `src/server.ts` | The only file that knows the MCP SDK exists |

### Rules the code holds to, each because the previous version did not

**Shapes do not decide what "hollow" means.** One function does. The old code offered
`shouldPlaceBlock` in a shared module and no calculator called it, so the torus decided
hollowness from an angle while everything else used a distance.

**Surfaces are traced by walking the grid, not by sampling a parameter.** Sampling suits a
curve; for a surface several samples land on the same block, and the old torus emitted 1152
positions covering 868 distinct blocks.

**Degenerate input throws.** Returning an empty array reads as "nothing to build" and is
indistinguishable from success, so neither the caller nor the model driving it could tell.

**"Not looked at" is never flattened into "empty".** An unloaded chunk, a timed-out read and a
part of a region that went missing are all distinct from air. Flattening any of them would
have a model conclude a space is free and build into whatever is standing there.

**Bedrock's status codes are reported, not interpreted.** They do not mean what they look like
they mean, and the messages are translated into the client's language.

The reasoning behind these is in [`design/`](../../design/).
