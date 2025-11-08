# Minecraft Bedrock MCP Server

[English README here / 英語版 README はこちら](README.md)

Minecraft統合版（Bedrock Edition）・教育版（Education Edition）を制御するTypeScript製MCPサーバーです。

<a href="https://glama.ai/mcp/servers/@Mming-Lab/minecraft-bedrock-mcp-server">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@Mming-Lab/minecraft-bedrock-mcp-server/badge" alt="Minecraft Bedrock Education MCP server" />
</a>

## 特徴

- **コアツール**: プレイヤー、エージェント、ブロック、ワールド、カメラ、システム制御
- **高度建築**: 12種類の3D形状ツール（立方体、球体、螺旋、トーラス、ベジェ曲線等）
- **Wiki統合**: Minecraft Wiki検索で正確な情報取得
- **シーケンス機能**: 複数操作を自動連携
- **自然な対話**: 自然言語でMinecraftを操作

## クイックスタート

### 1. インストール

```bash
git clone https://github.com/Mming-Lab/minecraft-bedrock-education-mcp.git
cd minecraft-bedrock-education-mcp
npm install
npm run build
npm start
```

### 2. Minecraft接続

Minecraftでワールドを開き（チート有効）、チャット欄で：
```
/connect localhost:8001/ws
```

### 3. AIアシスタント設定

MCPクライアント（Claude Desktop等）の設定ファイルに追加：

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
その他のMCPクライアントについては各ドキュメントを参照してください。

## 利用可能ツール

### コアツール
- `player` - プレイヤー管理（位置、アイテム、能力）
- `agent` - エージェント制御（移動、回転、インベントリ）
- `blocks` - ブロック操作（設置、削除、範囲塗りつぶし）
- `world` - ワールド制御（時間、天気、ゲームルール）
- `camera` - カメラ制御（視点、フェード、シネマティック）
- `system` - スコアボード・UI表示
- `minecraft_wiki` - Wiki検索
- `sequence` - 複数ツール連携実行

### 建築ツール（12種類）
- `build_cube` - 立方体（中空/塗りつぶし）
- `build_sphere` - 球体
- `build_cylinder` - 円柱
- `build_line` - 直線
- `build_torus` - トーラス（ドーナツ）
- `build_helix` - 螺旋
- `build_ellipsoid` - 楕円体
- `build_paraboloid` - 放物面
- `build_hyperboloid` - 双曲面
- `build_bezier` - ベジェ曲線
- `build_rotate` - 回転変換
- `build_transform` - 座標変換

## 使用例

### 基本的な使い方

AIアシスタントに自然に話しかけるだけ：

```
今いる座標を教えて
→ プレイヤー位置を取得

目の前にダイヤモンドブロックを置いて
→ ブロック設置

半径10のガラスドームを作って
→ 球体建築（中空）

らせん階段を石レンガで作って
→ 螺旋建築

近くにいる村人の数を教えて
→ エンティティ検索
```

### 複雑な建築

```
城を作りたいんだけど
→ AIが自動的に複数ツールを組み合わせて建築

橋をベジェ曲線で滑らかに作って
→ ベジェ曲線ツールで自然な曲線の橋

時間を夜にして、雨を降らせて
→ ワールド制御（時間・天気）
```

### エラー時の自動修正

```
ユーザー: "daimond_block を置いて"
システム: ❌ Unknown block: minecraft:daimond_block
         💡 Use the minecraft_wiki tool to search for valid block IDs

AI: Wikiで検索して正しいIDを確認します...
    → 自動的に "diamond_block" を検索して修正
```

## 技術仕様

- **トークン最適化**: 大量データを自動圧縮（98%削減）
- **エラー自動修正**: AIが間違いを検出して自動修正
- **多言語対応**: 日本語/英語切り替え可能

## 必要環境

- **Node.js** 16以上
- **Minecraft Bedrock Edition** または **Education Edition**
- **チート有効**のワールド
- **MCPクライアント**（Claude Desktopなど）

## ライセンス

GPL-3.0

## 謝辞

- [SocketBE](https://github.com/tutinoko2048/SocketBE) - Minecraft Bedrock WebSocket統合ライブラリ
- [Model Context Protocol](https://modelcontextprotocol.io) - AI統合プロトコル仕様
- [Anthropic](https://www.anthropic.com) - Claude AI及びMCP TypeScript SDK

## 関連リンク

- [公式MCP仕様](https://modelcontextprotocol.io)
- [Socket-BE GitHub](https://github.com/tutinoko2048/SocketBE)
- [Minecraft Wiki](https://minecraft.wiki)
- [Glama MCP Servers](https://glama.ai/mcp/servers)
