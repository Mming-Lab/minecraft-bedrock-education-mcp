# live-probe

Records what Minecraft actually sends.

Everything the rewrite could settle from source, a wiki, or running code has been settled
that way. What is left needs the game: whether `getchunkdata` exists in this build and what
its arguments are, what `testforblock` puts in `statusMessage` and whether it is localised,
whether Bedrock's `/setblock` takes caret notation, and whether the fill volume limit really
is 32768.

## Running it

```bash
node probe.mjs --rig d1-bridge
```

Then, in the game's chat:

```
/connect localhost:19131
```

### Windows: the loopback exemption

Minecraft Education is a packaged app, and packaged apps cannot reach `localhost` unless the
package is exempted. Without this the `/connect` fails with no useful message and the probe
simply never sees a connection. From an **elevated** prompt, once per machine:

```
CheckNetIsolation.exe LoopbackExempt -a -n=Microsoft.MinecraftEducationEdition_8wekyb3d8bbwe
```

Restart the game afterwards. Check what is currently exempted with
`CheckNetIsolation LoopbackExempt -s`.

## What comes out

```
dump/<timestamp>/
  frames.jsonl        every frame, both directions, before anything interpreted it
  verdicts.json       the answers the rig arrived at
  corpus-results.json each generated command and what the game said to it
  help.txt            the game's own command list
  meta.json           build, port, rig
```

`frames.jsonl` is the primary record and the reason this tool exists. socket-be, which the
legacy server is built on, discards frames whose `messagePurpose` it does not recognise -
`action:agent` among them - and prints `[Network] Invalid message purpose:`. Its author read
the resulting silence as the agent commands returning no data. Keeping the raw frames means
a wrong reading can be corrected later without another session.

## Rigs

| rig | what it settles |
|---|---|
| `a4-focus` | a dispatcher, not a measurement. The runner picks a rig when the connection opens and cannot be told afterwards, so this one is loaded under a fixed name and hands off to whatever `active-rig.txt` names. |
| `focus-then-battery` | proves what a silent connection was, then runs the battery against the world it just proved. |
| `d1-bridge` | the bridge client against the real game, rather than against the fake add-on the unit tests use. |
| `d2-channel` | which channel the add-on actually speaks on, and where exactly a line dies. |
| `d3-layers` | the real MCP tools against the real world — what a model would actually see. |
| `d4-roundtrip` | build something, read it back, check it is the thing that was asked for. |
| `d5-edit` | read a layer grid, change three characters, send it back. |
| `d6-longnames` | whether the `read_region` retry fires, and whether 16 cubed comes back whole. |

`_battery.mjs` is not a rig. It holds the measurements themselves so more than one rig can run
them.

A rig is a module in `rigs/` exporting `run(session, { log, dump })`. `session.command()`
resolves with the reply frame - including a refusal, because a refusal is data here and most
of these rigs are asking which commands get refused.

## selftest.mjs

```bash
node selftest.mjs
```

Drives the probe with a stand-in for Minecraft. It cannot tell you anything about the game;
it checks the recorder, and only a real session checks the recording.

It is worth having because a live session is scarce - someone has to launch the game and type
`/connect`, and a rig that crashes in its seventh phase wastes all of it. It has already paid
for itself once: the fill-limit binary search never terminated, because it searched on volume
but could only step in cube-root increments, so `lo` sometimes did not move. The fake enforces
a deliberately *different* limit from the one the rig guesses, so that search actually runs
here rather than being skipped.
