# Minecraft Bedrock MCP Server

[日本語版 README はこちら / Japanese README here](README_ja.md)

A TypeScript-based MCP server for controlling Minecraft Bedrock Edition and Education Edition.

<a href="https://glama.ai/mcp/servers/@Mming-Lab/minecraft-bedrock-mcp-server">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@Mming-Lab/minecraft-bedrock-mcp-server/badge" alt="Minecraft Bedrock Education MCP server" />
</a>

## Features

- **Core Tools**: Player, Agent, Blocks, World, Camera, System control
- **Advanced Building**: 12 types of 3D shape tools (cube, sphere, helix, torus, bezier curves, etc.)
- **Wiki Integration**: Search Minecraft Wiki for accurate information
- **Sequence System**: Automatic chaining of multiple operations
- **Natural Language**: Control Minecraft with natural language

## Quick Start

### 1. Installation

```bash
git clone https://github.com/Mming-Lab/minecraft-bedrock-education-mcp.git
cd minecraft-bedrock-education-mcp
npm install
npm run build
npm start
```

### 2. Minecraft Connection

Open a world in Minecraft (with cheats enabled), then in chat:
```
/connect localhost:8001/ws
```

### 3. AI Assistant Setup

Add to your MCP client configuration (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "minecraft-bedrock": {
      "command": "node",
      "args": ["C:/path/to/minecraft-bedrock-education-mcp/dist/server.js"]
    }
  }
}
```

**Claude Desktop**: `%APPDATA%\Claude\claude_desktop_config.json` (Windows)
For other MCP clients, refer to their respective documentation.

## Available Tools

### Core Tools
- `player` - Player management (location, items, abilities)
- `agent` - Agent control (movement, rotation, inventory)
- `blocks` - Block operations (place, remove, fill)
- `world` - World control (time, weather, game rules)
- `camera` - Camera control (viewpoint, fade, cinematic)
- `system` - Scoreboard and UI display
- `minecraft_wiki` - Wiki search
- `sequence` - Multi-tool chaining execution

### Building Tools (12 types)
- `build_cube` - Cube (hollow/filled)
- `build_sphere` - Sphere
- `build_cylinder` - Cylinder
- `build_line` - Line
- `build_torus` - Torus (donut)
- `build_helix` - Helix (spiral)
- `build_ellipsoid` - Ellipsoid
- `build_paraboloid` - Paraboloid
- `build_hyperboloid` - Hyperboloid
- `build_bezier` - Bezier curve
- `build_rotate` - Rotation transform
- `build_transform` - Coordinate transform

## Usage Examples

### Basic Usage

Just talk naturally to the AI assistant:

```
Tell me my current coordinates
→ Gets player position

Place a diamond block in front of me
→ Places block

Build a glass dome with radius 10
→ Sphere building (hollow)

Create a spiral staircase with stone bricks
→ Helix building

How many villagers are nearby?
→ Entity search
```

### Complex Building

```
I want to build a castle
→ AI automatically combines multiple tools to build

Create a smooth bridge using bezier curves
→ Natural curved bridge with bezier tool

Make it night and start raining
→ World control (time & weather)
```

### Automatic Error Correction

```
User: "Place a daimond_block"
System: ❌ Unknown block: minecraft:daimond_block
        💡 Use the minecraft_wiki tool to search for valid block IDs

AI: Let me search the wiki for the correct ID...
    → Automatically searches for and corrects to "diamond_block"
```

## Technical Specifications

- **Token Optimization**: Automatic data compression (98% reduction)
- **Error Auto-correction**: AI detects and fixes mistakes automatically
- **Multilingual**: Japanese/English support

## Requirements

- **Node.js** 16 or higher
- **Minecraft Bedrock Edition** or **Education Edition**
- World with **cheats enabled**
- **MCP client** (e.g., Claude Desktop)

## License

GPL-3.0

## Acknowledgments

- [SocketBE](https://github.com/tutinoko2048/SocketBE) - Minecraft Bedrock WebSocket integration library
- [Model Context Protocol](https://modelcontextprotocol.io) - AI integration protocol specification
- [Anthropic](https://www.anthropic.com) - Claude AI and MCP TypeScript SDK

## Related Links

- [Official MCP Specification](https://modelcontextprotocol.io)
- [Socket-BE GitHub](https://github.com/tutinoko2048/SocketBE)
- [Minecraft Wiki](https://minecraft.wiki)
- [Glama MCP Servers](https://glama.ai/mcp/servers)
