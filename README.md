# Minecraft Bedrock MCP Server

[日本語 README はこちら / Japanese README here](README_ja.md)

A TypeScript MCP server for controlling Minecraft Bedrock Edition via WebSocket.

## Quick Start

### 1. Installation
```bash
git clone https://github.com/Mming-Lab/minecraft-bedrock-mcp-server.git
cd minecraft-bedrock-mcp-server
npm install
npm run build
npm start
```

### 2. Minecraft Setup
1. Create world with **cheats enabled** (Bedrock/Education Edition)
2. Connect from Minecraft: `/connect localhost:8001/ws`

### 3. Claude Desktop Setup
Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "minecraft-bedrock": {
      "command": "node",
      "args": ["path/to/dist/server.js"]
    }
  }
}
```

## Features

- **Core Tools**: `player`, `agent`, `world`, `blocks`, `camera`, `system`
- **Building Tools**: `build_cube`, `build_sphere`, `build_cylinder`, `build_line`, etc.
- **Sequence Control**: Chain multiple tools with timing and error handling
- **Cross-Tool Sequences**: Combine different tools in automated workflows

## Sequence Examples

### Single-Tool Sequence
```javascript
{
  "action": "sequence",
  "steps": [
    {"type": "move", "direction": "forward", "distance": 3, "wait_time": 1},
    {"type": "turn", "direction": "right", "wait_time": 1}
  ]
}
```

### Cross-Tool Sequence
```javascript
{
  "steps": [
    {"tool": "player", "type": "give_item", "item_id": "minecraft:diamond_sword"},
    {"tool": "agent", "type": "move", "direction": "forward", "distance": 5, "wait_time": 2},
    {"tool": "blocks", "type": "setblock", "x": 100, "y": 64, "z": 200, "block": "minecraft:diamond_block"}
  ]
}
```

### Error Handling
- `on_error: "stop"` - Stop on error (default)
- `on_error: "continue"` - Ignore errors and continue
- `on_error: "retry"` - Retry failed steps

## Development

```bash
npm run build    # Compile TypeScript
npm run dev      # Build and run
npm test         # Run test client
```

### Port Configuration
```json
{
  "args": ["path/to/dist/server.js", "--port=8002"]
}
```

## Architecture

- **Base**: `src/tools/base/tool.ts` - Shared functionality
- **Core**: `src/tools/core/` - Player, agent, world, camera tools
- **Building**: `src/tools/advanced/building/` - Construction tools
- **Sequences**: Built-in support for all tools with timing control

## Requirements

- Node.js 16+
- Minecraft Bedrock/Education Edition with cheats
- MCP client (Claude Desktop, etc.)

## License

GPL-3.0

## Acknowledgments

- [SocketBE](https://github.com/tutinoko2048/SocketBE) - Minecraft Bedrock WebSocket integration