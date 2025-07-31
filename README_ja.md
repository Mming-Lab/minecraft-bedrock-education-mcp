# Minecraft Bedrock MCP Server

[English README here / 英語版 README はこちら](README.md)

Minecraft統合版（Bedrock Edition）・教育版（Education Edition）を制御するTypeScript製MCPサーバーです。

<a href="https://glama.ai/mcp/servers/@Mming-Lab/minecraft-bedrock-mcp-server">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@Mming-Lab/minecraft-bedrock-mcp-server/badge" alt="Minecraft Bedrock Server MCP server" />
</a>

## 機能

- **安定した統合**: WebSocket経由での信頼性の高いMinecraft制御
- **階層化ツール**: コアツール（ブロック、プレイヤー、ワールド）+ 高度建築ツール
- **Wiki統合**: Minecraft Wiki検索でBedrock/教育版の正確な情報取得
- **シーケンス制御**: 複数ツール連携と待ち時間・エラーハンドリング対応
- **MCP対応**: Claude Desktopなど各種MCPクライアントに対応
- **型安全**: 完全TypeScript実装

## クイックスタート

### インストール

```bash
git clone https://github.com/Mming-Lab/minecraft-bedrock-mcp-server.git
cd minecraft-bedrock-mcp-server
npm install
npm run build
npm start
```

### Minecraft設定

1. **ワールド作成**: チートを有効にする（統合版・教育版）
2. **Minecraftから接続**: `/connect localhost:8001/ws`

### Claude Desktop設定

`claude_desktop_config.json`に追加：

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

## 利用可能ツール

### コアツール
- **`agent`** - エージェント制御（移動、回転、テレポート、インベントリ、シーケンス）
- **`player`** - プレイヤー管理（情報、アイテム、能力、シーケンス）
- **`world`** - ワールド制御（時間、天気、コマンド、シーケンス）
- **`blocks`** - ブロック操作（設置、塗りつぶし、クエリ、シーケンス）
- **`system`** - スコアボードとUI制御（シーケンス）
- **`camera`** - 映画的シーケンス対応カメラ制御
- **`minecraft_wiki`** - Minecraft Wiki検索（統合版・教育版対応）
- **`sequence`** - 複数ツール連携シーケンス実行

### 建築ツール
- **`build_cube`** - 箱型と中空構造
- **`build_sphere`** - 球体とドーム
- **`build_cylinder`** - 塔とパイプ
- **`build_line`** - 直線建築
- **`build_torus`** - ドーナツ形状
- **`build_helix`** - らせん構造
- **`build_ellipsoid`** - 卵型
- **`build_paraboloid`** - 衛星皿型
- **`build_hyperboloid`** - 冷却塔型
- **`build_rotate`** - 構造回転
- **`build_transform`** - 構造変形

## 使用例

### Wiki検索シーケンス
情報を段階的に取得して膨大なレスポンスを回避：
```javascript
// Wiki検索例
{
  "action": "sequence",
  "steps": [
    {"type": "search", "query": "give command", "focus": "commands"},
    {"type": "get_page_summary", "title": "Commands/give"},
    {"type": "get_section", "title": "Commands/give", "section": "Syntax"}
  ]
}
```

### 建築シーケンス
複数ツールを組み合わせた自動建築：
```javascript
// 建築シーケンス例
{
  "steps": [
    {"tool": "player", "type": "teleport", "x": 0, "y": 70, "z": 0},
    {"tool": "build_cube", "type": "build", "x1": -5, "y1": 70, "z1": -5, "x2": 5, "y2": 75, "z2": 5, "material": "diamond_block"},
    {"tool": "camera", "type": "move_to", "x": 10, "y": 80, "z": 10, "look_at_x": 0, "look_at_y": 72, "look_at_z": 0}
  ]
}
```

## シーケンス制御

### エラーハンドリング
- `on_error: "stop"` - エラー時停止（デフォルト）
- `on_error: "continue"` - エラー無視して継続
- `on_error: "retry"` - 失敗時リトライ

### 待ち時間制御
- `wait_time` - 各ステップ後の待機秒数
- 自動的なタイミング調整

## 開発

### ビルドコマンド
```bash
npm run build    # TypeScriptコンパイル
npm run dev      # ビルド＋テスト実行
```

### ポート設定
MCPクライアント設定でポートを指定：
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

## 必要環境

- Node.js 16+
- チート有効なMinecraft統合版・教育版
- MCPクライアント（Claude Desktopなど）

## ライセンス

GPL-3.0

## 謝辞

- [SocketBE](https://github.com/tutinoko2048/SocketBE) - Minecraft Bedrock WebSocket統合ライブラリ
