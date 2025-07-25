# Minecraft Bedrock MCP Server

[English README here / 英語版 README はこちら](README.md)

Minecraft統合版（Bedrock Edition）・教育版（Education Edition）を制御するTypeScript製MCPサーバーです。

## 機能

- **安定した統合**: WebSocket経由での信頼性の高いMinecraft制御
- **階層化ツール**: コアツール（ブロック、プレイヤー、ワールド）+ 高度建築ツール
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
- **`agent`** - エージェント制御（移動、回転、テレポート、インベントリ）
- **`player`** - プレイヤー管理（情報、アイテム、能力）
- **`world`** - ワールド制御（時間、天気、コマンド）
- **`blocks`** - ブロック操作（設置、塗りつぶし、クエリ）
- **`system`** - スコアボードとUI制御

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

## アーキテクチャ

```
src/
├── server.ts           # メインMCPサーバー
├── types.ts           # 型定義
└── tools/
    ├── base/tool.ts   # 基底クラス
    ├── core/          # コアAPIツール
    └── advanced/      # 建築ツール
```

## ライセンス

GPL-3.0

## 謝辞

- [SocketBE](https://github.com/tutinoko2048/SocketBE) - Minecraft Bedrock WebSocket統合ライブラリ

## 必要環境

- Node.js 16+
- チート有効なMinecraft統合版・教育版
- MCPクライアント（Claude Desktopなど）