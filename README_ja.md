# Minecraft Bedrock MCP Server

[English README here / 英語版 README はこちら](README.md)

WebSocket接続を通じてMinecraft Bedrock Editionを制御するツールを提供するTypeScript製のMCP（Model Context Protocol）サーバーです。

## 🎮 機能

- **20以上の強力なツール**を階層化システムで構成
- **レベル1基本ツール**: プレイヤー制御、エージェント（@c）操作、ワールド操作
- **レベル2高度ツール**: 複雑な建築操作、高度なワールド管理
- **MCPクライアント統合**（例：Claude Desktop）によるAI駆動のMinecraft自動化
- 包括的なエラーハンドリングを備えた**TypeScript型安全**実装

## 🛠️ 利用可能なツール

### プレイヤー制御
- `player_position` - プレイヤーの現在位置を取得
- `player_move` - プレイヤーを座標に移動/テレポート
- `player_say` - プレイヤーとしてメッセージを送信

### エージェント制御（Education Edition）
- `agent_move` - エージェントを方向または座標に移動 ✅
- `agent_turn` - エージェントを左右に回転または特定方向に設定 ✅
- ~~`agent_attack`~~ - ❌ Bedrock Editionでは未対応
- ~~`agent_block_action`~~ - ❌ Bedrock Editionでは未対応

### ワールド操作
- `world_block` - ワールドのブロック操作（設置、取得、破壊）
- `world_fill` - 高度なオプションで領域を充填
- `world_time_weather` - 時間と天気を制御

### 建築ツール
- `build_cube` - 立体または中空の立方体を建築
- `build_line` - 点間に直線を建築
- `build_sphere` - 立体または中空の球体を建築
- `build_paraboloid` - パラボロイド形状（衛星皿状）を建築
- `build_hyperboloid` - ハイパーボロイド形状（冷却塔状）を建築
- `build_cylinder` - 円柱構造を建築
- `build_torus` - トーラス/ドーナツ形状を建築
- `build_helix` - らせん/スパイラル構造を建築
- `build_ellipsoid` - 楕円体形状を建築
- `build_rotate` - 既存構造を回転
- `build_transform` - 構造を変形・操作

### 基本コミュニケーション
- `send_message` - チャットメッセージを送信
- `execute_command` - 任意のMinecraftコマンドを実行

## 🚀 クイックスタート

### 前提条件
- Node.js 16+ 
- チートが有効なMinecraft Bedrock Edition
- MCPクライアント（例：Claude Desktop、Continueなど）

### インストール

1. **リポジトリをクローン**
```bash
git clone https://github.com/Mming-Lab/minecraft-bedrock-mcp-server.git
cd minecraft-bedrock-mcp-server
```

2. **依存関係をインストール**
```bash
npm install
```

3. **プロジェクトをビルド**
```bash
npm run build
```

4. **サーバーを起動**
```bash
npm start
```

### Minecraft接続

1. **MCPサーバーを起動**
```bash
npm start
```
デフォルトポート：8001

2. **Minecraftワールドを準備**
   - **チートが有効**なワールドを作成または選択
   - すべての実験的機能を無効にする
   - 最良の結果を得るためにクリエイティブモードを使用

3. **Minecraftから接続**
Minecraft Bedrock Editionのチャットで実行：
```
/connect localhost:8001/ws
```

4. **接続を確認**
MCPサーバーコンソールに接続ログが表示されます。

### MCPクライアント設定（例：Claude Desktop）

サーバーはMCP（Model Context Protocol）標準を実装しており、任意の互換MCPクライアントで使用できます。

**例：Claude Desktop設定**

1. **設定ファイルの場所：**
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Linux: `~/.config/Claude/claude_desktop_config.json`

2. **サーバー設定を追加：**
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

3. **カスタムポート設定：**
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

4. **MCPクライアントを再起動**して新しい設定を読み込み

他のMCPクライアントについては、それぞれのドキュメントでサーバー登録方法を参照してください。

## 📖 ドキュメント

貢献者と開発者向けの包括的なドキュメントが利用可能です。詳細なセットアップガイドとアーキテクチャドキュメントについては、メンテナーまでお問い合わせください。

## 💻 開発

### 利用可能なスクリプト

```bash
npm run build    # TypeScriptをJavaScriptにコンパイル
npm start        # コンパイル済みサーバーを起動
npm run dev      # ビルドと起動を一つのコマンドで実行
```

### ポート設定

サーバーポートはコマンドライン引数で設定可能：
- `--port=8002` - カスタムポートを設定
- デフォルト：`8001`

### プロジェクト構造

```
src/
├── server.ts              # メインサーバー実装
├── types.ts               # TypeScript型定義
└── tools/                 # ツール実装
    ├── base/tool.ts       # 抽象基底クラス
    ├── player/            # プレイヤー制御ツール
    ├── agent/             # エージェント制御ツール
    ├── world/             # ワールド操作ツール
    └── build/             # 建築ツール
```

## 🤝 貢献

1. リポジトリをフォーク
2. 機能ブランチを作成（`git checkout -b feature/amazing-feature`）
3. 変更をコミット（`git commit -m 'Add amazing feature'`）
4. ブランチにプッシュ（`git push origin feature/amazing-feature`）
5. プルリクエストを開く

## 📄 ライセンス

このプロジェクトはMITライセンスの下でライセンスされています - 詳細は[LICENSE](LICENSE)ファイルを参照してください。

## 🙏 謝辞

- [MCP Protocol](https://modelcontextprotocol.io/) 仕様の提供
- [Sandertv/mcwss](https://github.com/Sandertv/mcwss) WebSocketプロトコル解析とメッセージ構造の参考

## ⚠️ 必要条件

- チートが有効な**Minecraft Bedrock Edition**
- ワールド設定で**WebSocket接続**が有効
- コマンド実行に適切な権限を持つ**ワールド**

## 🔧 トラブルシューティング

### 接続問題

**サーバーが起動しない：**
- Node.js 16+がインストールされていることを確認
- ポート8001が既に使用されていないかチェック：`netstat -ano | findstr :8001`
- 別のポートを試す：`--port=8002`

**Minecraft接続が失敗する：**
1. **ワールド設定を確認：**
   - チートが有効でなければならない
   - すべての実験的機能を無効にする
   - クリエイティブモードを使用
2. **接続コマンドを確認：**
   ```
   /connect localhost:8001/ws
   ```
3. **ファイアウォール設定：**
   - ポート8001がWindows Defenderを通過することを確認
   - アンチウイルスソフトが接続をブロックしていないかチェック

**MCPクライアント統合の問題：**
1. 設定ファイルのパスと構文を確認（例：Claude Desktop）
2. MCPクライアントを完全に再起動
3. MCPプロトコルエラーについてサーバーログをチェック
4. 設定内のファイルパスが絶対パスであることを確認

### よくあるエラーメッセージ

- `EADDRINUSE`：ポートが既に使用中 - 別のポートを試す
- `Connection refused`：サーバーが動作していない、または間違ったポート
- `unknown message purpose ws:encrypt`：接続設定中の正常なメッセージ