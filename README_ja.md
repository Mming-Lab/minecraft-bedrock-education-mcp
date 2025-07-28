# Minecraft Bedrock MCP Server

[English README here / 英語版 README はこちら](README.md)

Minecraft統合版（Bedrock Edition）・教育版（Education Edition）を制御するTypeScript製MCPサーバーです。

## 機能

- **安定した統合**: WebSocket経由での信頼性の高いMinecraft制御
- **階層化ツール**: コアツール（ブロック、プレイヤー、ワールド）+ 高度建築ツール
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

## シーケンス機能

### 単一ツールシーケンス
同一ツール内で複数のアクションを実行：
```javascript
// エージェントシーケンス例
{
  "action": "sequence",
  "steps": [
    {"type": "move", "direction": "forward", "distance": 3, "wait_time": 1},
    {"type": "turn", "direction": "right", "wait_time": 1},
    {"type": "move", "direction": "forward", "distance": 2}
  ]
}
```

### クロスツールシーケンス
複数のツールを組み合わせた連携シーケンス：
```javascript
// クロスツールシーケンス例
{
  "steps": [
    {"tool": "player", "type": "give_item", "item_id": "minecraft:diamond_sword", "wait_time": 1},
    {"tool": "agent", "type": "move", "direction": "forward", "distance": 5, "wait_time": 2},
    {"tool": "camera", "type": "smooth_move", "x": 100, "y": 80, "z": 200, "duration": 3},
    {"tool": "blocks", "type": "place", "x": 100, "y": 64, "z": 200, "block": "minecraft:diamond_block"}
  ]
}
```

### エラーハンドリング
シーケンス実行中のエラー処理設定：
- **`on_error: "stop"`** - エラー時にシーケンス停止（デフォルト）
- **`on_error: "continue"`** - エラーを無視して継続
- **`on_error: "retry"`** - 失敗ステップをリトライ（`retry_count`で回数設定）

### 待ち時間制御
- **`wait_time`** - 各ステップ後の待機秒数
- カメラアニメーションなど時間のかかる操作の自動待機対応

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