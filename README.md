# minecraft-bedrock-education-mcp

[日本語版 README はこちら / Japanese README here](README_ja.md)

<a href="https://glama.ai/mcp/servers/Mming-Lab/minecraft-bedrock-education-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@Mming-Lab/minecraft-bedrock-mcp-server/badge" alt="Minecraft Bedrock Education MCP server" />
</a>

An MCP server that lets a model build in Minecraft Education — draw the thing before placing
it, put all of it down in one call, and read back what actually landed.

> **v2 — rewritten.** The previous version is tagged [`legacy/v1.0.0`](../../releases/tag/legacy/v1.0.0) and still builds and runs.

## What it needs

- **Minecraft Education 1.26 or later**, on **the same machine** as this server. The game
  connects to the server, not the other way round, and the tools that read the world go
  through an add-on running inside it.
- **Node 22 or later.**
- Windows, for the add-on installer. The server itself has no platform requirement.

Bedrock Edition works for building. Reading needs the add-on, which needs the Script API.

## Setting it up

Three steps, in this order. The middle one is the one people skip.

### 1. Install the add-on

```bash
node addon/install.mjs
```

Then activate **MCP Bridge** on the world, and **close Minecraft Education completely and open
it again.** Pack folders are scanned when the game launches and at no other time; reloading the
world is not enough, and the game gives no sign that it is still running the script it loaded at
startup. `world.bridge_status` is the only thing that reports which version is actually running.

### 2. Build the server, then point an MCP client at it

```bash
npm install
npm run build
```

That writes `dist/index.js`, which is what the client spawns:

```json
{
  "mcpServers": {
    "minecraft": {
      "command": "node",
      "args": ["path/to/dist/index.js"]
    }
  }
}
```

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

```
/connect localhost:19131
```

Nothing is connected until this happens, and the server cannot do it for you.

**On Windows this fails silently until the package is exempted.** Education Edition is a
packaged app, and packaged apps cannot reach `localhost`. Without the exemption `/connect`
reports nothing useful and the server never sees a connection — which looks exactly like the
encryption mismatch above. From an **elevated** prompt, once per machine, then restart the game:

```
CheckNetIsolation.exe LoopbackExempt -a -n=Microsoft.MinecraftEducationEdition_8wekyb3d8bbwe
```

`CheckNetIsolation LoopbackExempt -s` lists what is currently exempted.

That is all the setup there is — the tools carry their own instructions, and the model reads
them from there.

## When it does not work

Ask `world.bridge_status` first. It answers rather than failing, because it is the tool you
reach for when the others are failing:

| It says | Then |
|---|---|
| `connected: false` | Nobody has run `/connect` — or the encryption settings disagree |
| `upToDate: false` | The game is running an older add-on than the files on disk. **Close and reopen Minecraft**; reloading the world will not do it |
| everything fine | The problem is in the request, and the failing tool will have said what |

**A build that reports `negative` entries is usually fine.** Bedrock's status codes are not
verdicts: `0 blocks filled` is negative and means the fill ran and matched nothing. To find out
whether something is actually in the world, read it.

**`overwritten` entries are not an error either.** The call succeeded; those entries are simply
not in the world because a later shape covered them.

## Contributing

`npm run verify` runs everything without Minecraft. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
