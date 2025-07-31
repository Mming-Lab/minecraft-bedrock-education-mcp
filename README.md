# Minecraft Bedrock MCP Server

[日本語 README はこちら / Japanese README here](README_ja.md)

A TypeScript MCP server for controlling Minecraft Bedrock Edition and Education Edition.

<a href="https://glama.ai/mcp/servers/@Mming-Lab/minecraft-bedrock-mcp-server">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@Mming-Lab/minecraft-bedrock-mcp-server/badge" alt="Minecraft Bedrock Server MCP server" />
</a>

## Features

- **Reliable Integration**: Stable Minecraft control via WebSocket
- **Hierarchical Tools**: Core tools (blocks, player, world) + Advanced building tools
- **MCP Compatible**: Works with Claude Desktop and other MCP clients
- **Type-safe**: Full TypeScript implementation

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

- **Core Tools**: `player`, `agent`, `world`, `blocks`, `camera`, `system`, `minecraft_wiki`
- **Building Tools**: `build_cube`, `build_sphere`, `build_cylinder`, `build_line`, etc.
- **Wiki Integration**: Search Minecraft Wiki for Bedrock/Education Edition info
- **Sequence Control**: Chain multiple tools with timing and error handling
- **Cross-Tool Sequences**: Combine different tools in automated workflows

## Usage Examples

### Wiki Search
```javascript
// Step-by-step wiki search to avoid overwhelming responses
{
  "action": "sequence",
  "steps": [
    {"type": "search", "query": "give command", "focus": "commands"},
    {"type": "get_page_summary", "title": "Commands/give"},
    {"type": "get_section", "title": "Commands/give", "section": "Syntax"}
  ]
}
```

### Building Sequence
```javascript
{
  "steps": [
    {"tool": "player", "type": "teleport", "x": 0, "y": 70, "z": 0},
    {"tool": "build_cube", "type": "build", "x1": -5, "y1": 70, "z1": -5, "x2": 5, "y2": 75, "z2": 5, "material": "diamond_block"},
    {"tool": "camera", "type": "move_to", "x": 10, "y": 80, "z": 10, "look_at_x": 0, "look_at_y": 72, "look_at_z": 0}
  ]
}
```

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

## Tools

### Core Tools
- `player` - Teleport, give items, gamemode, XP
- `agent` - Move, build, mine, inventory management  
- `world` - Time, weather, run commands
- `blocks` - Place/fill blocks, query terrain
- `camera` - Cinematic shots, smooth movement
- `system` - Scoreboards, titles, action bars
- `minecraft_wiki` - Search wiki for Bedrock/Education info
- `sequence` - Chain multiple tools together

### Building Tools
- `build_cube`, `build_sphere`, `build_cylinder` - Basic shapes
- `build_line`, `build_helix`, `build_torus` - Complex geometry  
- `build_ellipsoid`, `build_paraboloid`, `build_hyperboloid` - Advanced shapes
- `build_rotate`, `build_transform` - Copy and transform structures

## Requirements

- Node.js 16+
- Minecraft Bedrock/Education Edition with cheats
- MCP client (Claude Desktop, etc.)

## License

GPL-3.0

## Acknowledgments

- [SocketBE](https://github.com/tutinoko2048/SocketBE) - Minecraft Bedrock WebSocket integration