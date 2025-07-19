# Minecraft Bedrock MCP Server

[日本語版 README はこちら / Japanese README here](README_ja.md)

A TypeScript-based MCP (Model Context Protocol) server that provides tools for controlling Minecraft Bedrock Edition via WebSocket connections.

## 🎮 Features

- **13 Powerful Tools** organized in a hierarchical system
- **Level 1 Basic Tools**: Player control, Agent (@c) operations, World manipulation
- **Level 2 Advanced Tools**: Complex building operations, advanced world management
- **MCP Client Integration** (e.g., Claude Desktop) for AI-powered Minecraft automation
- **Type-safe TypeScript** implementation with comprehensive error handling

## 🛠️ Available Tools

### Player Control
- `player_position` - Get player's current position
- `player_move` - Move/teleport player to coordinates
- `player_say` - Send messages as player

### Agent Control (Education Edition)
- `agent_move` - Move agent in directions or to coordinates ✅
- `agent_turn` - Turn agent left/right or set specific rotation ✅
- ~~`agent_attack`~~ - ❌ Not supported in Bedrock Edition
- ~~`agent_block_action`~~ - ❌ Not supported in Bedrock Edition

### World Operations
- `world_block` - World block operations (set, get, destroy)
- `world_fill` - Fill regions with advanced options
- `world_time_weather` - Control time and weather

### Building Tools
- `build_cube` - Build solid or hollow cubes
- `build_line` - Build straight lines between points
- `build_sphere` - Build solid or hollow spheres

### Basic Communication
- `send_message` - Send chat messages
- `execute_command` - Execute any Minecraft command

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ 
- Minecraft Bedrock Edition with cheats enabled
- MCP client (例: Claude Desktop, Continue, etc.)

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/Mming-Lab/minecraft-bedrock-mcp-server.git
cd minecraft-bedrock-mcp-server
```

2. **Install dependencies**
```bash
npm install
```

3. **Build the project**
```bash
npm run build
```

4. **Start the server**
```bash
npm start
```

### Minecraft Connection

1. **Start the MCP server**
```bash
npm start
```
Default port: 8001

2. **Prepare Minecraft World**
   - Create or select a world with **cheats enabled**
   - Disable all experimental features
   - Use Creative mode for best results

3. **Connect from Minecraft**
In Minecraft Bedrock Edition chat, run:
```
/connect localhost:8001/ws
```

4. **Verify Connection**
You should see connection logs in the MCP server console.

### MCP Client Setup (例: Claude Desktop)

The server implements the MCP (Model Context Protocol) standard and can be used with any compatible MCP client.

**Example: Claude Desktop configuration**

1. **Locate config file:**
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Linux: `~/.config/Claude/claude_desktop_config.json`

2. **Add server configuration:**
```json
{
  "mcpServers": {
    "minecraft-bedrock-mcp-server": {
      "command": "node",
      "args": ["path/to/dist/server.js"]
    }
  }
}
```

3. **Custom port configuration:**
```json
{
  "mcpServers": {
    "minecraft-bedrock-mcp-server": {
      "command": "node",
      "args": ["path/to/dist/server.js", "--port=8002"]
    }
  }
}
```

4. **Restart your MCP client** to load the new configuration

For other MCP clients, refer to their respective documentation for server registration.

## 📖 Documentation

Comprehensive documentation is available for contributors and developers. Contact the maintainers for detailed setup guides and architecture documentation.

## 💻 Development

### Available Scripts

```bash
npm run build    # Compile TypeScript to JavaScript
npm start        # Start the compiled server
npm run dev      # Build and start in one command
```

### Port Configuration

The server port can be configured via command line argument:
- `--port=8002` - Set custom port
- Default: `8001`

### Project Structure

```
src/
├── server.ts              # Main server implementation
├── types.ts               # TypeScript type definitions
└── tools/                 # Tool implementations
    ├── base/tool.ts       # Abstract base class
    ├── player/            # Player control tools
    ├── agent/             # Agent control tools
    ├── world/             # World manipulation tools
    └── build/             # Building tools
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [MCP Protocol](https://modelcontextprotocol.io/) for the specification
- [Sandertv/mcwss](https://github.com/Sandertv/mcwss) for WebSocket protocol analysis and message structure reference

## ⚠️ Requirements

- **Minecraft Bedrock Edition** with cheats enabled
- **WebSocket connections** enabled in world settings
- **World with appropriate permissions** for command execution

## 🔧 Troubleshooting

### Connection Issues

**Server won't start:**
- Ensure Node.js 16+ is installed
- Check if port 8001 is already in use: `netstat -ano | findstr :8001`
- Try a different port with `--port=8002`

**Minecraft connection fails:**
1. **Verify world settings:**
   - Cheats must be enabled
   - Disable all experimental features
   - Use Creative mode
2. **Check connection command:**
   ```
   /connect localhost:8001/ws
   ```
3. **Firewall settings:**
   - Ensure port 8001 is allowed through Windows Defender
   - Check antivirus software isn't blocking connections

**MCP client integration issues:**
1. Verify config file path and syntax (例: Claude Desktop)
2. Restart your MCP client completely
3. Check server logs for MCP protocol errors
4. Ensure file paths in config are absolute paths

### Common Error Messages

- `EADDRINUSE`: Port already in use - try different port
- `Connection refused`: Server not running or wrong port
- `unknown message purpose ws:encrypt`: Normal during connection setup