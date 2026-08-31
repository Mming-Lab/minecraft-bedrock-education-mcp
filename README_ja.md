# minecraft-bedrock-education-mcp

[English README](README.md)

<a href="https://glama.ai/mcp/servers/Mming-Lab/minecraft-bedrock-education-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@Mming-Lab/minecraft-bedrock-mcp-server/badge" alt="Minecraft Bedrock Education MCP server" />
</a>

AIが Minecraft Education で建築する MCP サーバです。**建てる前に絵にして、まとめて1回で置いて、
実際に何が建ったかを読み返せます。**

> **v2 — 書き直しました。** 旧版は [`legacy/v1.0.0`](../../releases/tag/legacy/v1.0.0) タグに凍結してあり、今もビルドして動きます。

## 必要なもの

- **Minecraft Education 1.26 以降**、この MCP サーバと**同じPC**に。
  ゲームがサーバに接続する向きなので、同居している必要があります
- **Node 22 以降**
- アドオン導入スクリプトは Windows 前提です（サーバ本体はOSを選びません）

Bedrock 版でも建築はできます。**読み取りにはアドオンが要り**、アドオンには Script API が要ります。

## 導入（3手順。真ん中が飛ばされます）

### 1. アドオンを入れる

```bash
node addon/install.mjs
```

そのあとワールドで **MCP Bridge** を有効にして、**Minecraft Education を完全に終了して開き直して
ください。** パックフォルダは**起動時にしか読まれません**。ワールドの再読み込みでは足りず、
ゲームは起動時のスクリプトを動かし続けて、**そのことを何も言いません。**
実際に動いている版を報告できるのは `world.bridge_status` だけです。

### 2. サーバをビルドして、MCP クライアントから指す

```bash
npm install
npm run build
```

これで `dist/index.js` ができます。クライアントが起動するのはこれです：

```json
{
  "mcpServers": {
    "minecraft": {
      "command": "node",
      "args": ["path/to/dist/index.js"]
    }
  }
}
```

| フラグ | 環境変数 | 既定 | |
|---|---|---|---|
| `--port N` | `MINECRAFT_MCP_PORT` | 19131 | `/connect` の宛先 |
| `--host H` | `MINECRAFT_MCP_HOST` | 全インタフェース | `127.0.0.1` で他機を拒否 |
| `--no-encryption` | `MINECRAFT_MCP_NO_ENCRYPTION` | off | **下記** |

**暗号化はゲーム側の設定と合わせる必要があり、食い違っても何も言われません。**
ゲームが暗号化を拒否する設定なら、`/connect` は通ったように見えて**何も返ってきません**。
これは「誰も `/connect` していない」のと見分けが付きません。
繋いだのに静かなときは、他を調べる前にこの設定を疑ってください。

### 3. ゲーム内から接続する

```
/connect localhost:19131
```

**これをするまで何も繋がりません。サーバ側からは繋げません。**

**Windows では、ループバック除外を入れるまで無言で失敗します。** 教育版はパッケージアプリ（UWP）
なので、除外を入れないと `localhost` に到達できません。**`/connect` は何も言わず、サーバ側にも
接続が現れない** — 上の暗号化の食い違いと見分けが付きません。**管理者権限**のプロンプトから、
1台につき1回。実行後にゲームを再起動してください：

```
CheckNetIsolation.exe LoopbackExempt -a -n=Microsoft.MinecraftEducationEdition_8wekyb3d8bbwe
```

現在の除外一覧は `CheckNetIsolation LoopbackExempt -s` で見られます。

導入はここまでです。**ツールの使い方は各ツールの説明文が持っていて、AIはそこから読みます。**

## うまくいかないとき

**まず `world.bridge_status`。** これだけは失敗しません（他が失敗したから呼ばれる道具なので）：

| 返答 | 意味 |
|---|---|
| `connected: false` | 誰も `/connect` していない、または暗号化設定の食い違い |
| `upToDate: false` | **ゲームが古いアドオンを動かしています。完全終了して開き直してください**（ワールド再読み込みでは足りません） |
| どちらも正常 | 問題は要求の側です。失敗したツールが理由を言っています |

**`negative` が返っても、たいてい正常です。** Bedrock のステータスコードは判定ではありません。
`0個のブロックで満たしました` は負の値ですが「実行されて対象が0個だった」という意味です。
**本当に置けたかは、読んで確かめてください。**

**`overwritten` もエラーではありません。** 呼び出しは成功していて、後の形状が覆っただけです。

## 開発

`npm run verify` で、Minecraft なしに全部通ります。詳細は [CONTRIBUTING.md](CONTRIBUTING.md)。

## ライセンス

MIT
