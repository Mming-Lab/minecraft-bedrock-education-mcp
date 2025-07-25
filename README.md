# Minecraft Bedrock MCP Server

[日本語 README はこちら / Japanese README here](README_ja.md)

A TypeScript MCP server for controlling Minecraft Bedrock Edition and Education Edition.

## Features

- **Reliable Integration**: Stable Minecraft control via WebSocket
- **Hierarchical Tools**: Core tools (blocks, player, world) + Advanced building tools
- **MCP Compatible**: Works with Claude Desktop and other MCP clients
- **Type-safe**: Full TypeScript implementation

## Quick Start

### Installation

```bash
git clone https://github.com/Mming-Lab/minecraft-bedrock-mcp-server.git
cd minecraft-bedrock-mcp-server
npm install
npm run build
npm start
```

### Minecraft Setup

1. **Create world** with cheats enabled (Bedrock/Education Edition)
2. **Connect from Minecraft**: `/connect localhost:8001/ws`

### Claude Desktop Setup

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

## Available Tools

### Core Tools
- **`agent`** - Agent control (move, turn, teleport, inventory)
- **`player`** - Player management (info, items, abilities)
- **`world`** - World control (time, weather, commands)
- **`blocks`** - Block operations (set, fill, query)
- **`system`** - Scoreboard and UI controls

### Building Tools
- **`build_cube`** - Boxes and hollow structures
- **`build_sphere`** - Spheres and domes
- **`build_cylinder`** - Towers and pipes
- **`build_line`** - Straight line construction
- **`build_torus`** - Donut shapes
- **`build_helix`** - Spiral structures
- **`build_ellipsoid`** - Egg shapes
- **`build_paraboloid`** - Satellite dishes
- **`build_hyperboloid`** - Cooling towers
- **`build_rotate`** - Structure rotation
- **`build_transform`** - Structure transformations

## Development

### Build Commands
```bash
npm run build    # Compile TypeScript
npm run dev      # Build and run for testing
```

### Port Configuration
Configure port in MCP client settings:
```json
{
  "mcpServers": {
    "minecraft-bedrock": {
      "command": "node",
      "args": ["path/to/dist/server.js", "--port=8002"]
    }
  }
}
```

## Architecture

```
src/
├── server.ts           # Main MCP server
├── types.ts           # Type definitions
└── tools/
    ├── base/tool.ts   # Base class
    ├── core/          # Core API tools
    └── advanced/      # Building tools
```

## License

GPL-3.0

## Acknowledgments

- [SocketBE](https://github.com/tutinoko2048/SocketBE) - Minecraft Bedrock WebSocket integration library

## Requirements

- Node.js 16+
- Minecraft Bedrock Edition or Education Edition with cheats
- MCP client (Claude Desktop, etc.)