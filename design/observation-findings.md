---
name: observation-findings
description: （メモ / エージェント定義ではない）socket-be の観測API調査結果。bedrock-protocol-analyst と agent-experience-designer が出発点として使う実測データ。
---

# socket-be 2.3.1 観測能力の実測結果

調査方法: `npm install socket-be@2.3.1` して `node_modules/socket-be/dist/index.d.ts`（1,946行）を直接読んだ。以下は推測ではなく型定義からの実測。

## 使えるもの

### イベント（26種）— `index.d.ts:487-514` の `ServerEvent`
`Open` / `Close` / `WorldAdd` / `WorldRemove` / `WorldInitialize` / `PlayerJoin` / `PlayerLeave` / `PlayerLoad` /
`PlayerChat` / `PlayerTitle` / `PlayerMessage` / `EnableEncryption` / `BlockBroken` / `BlockPlaced` /
`ItemAcquired` / `ItemCrafted` / `ItemEquipped` / `ItemInteracted` / `ItemSmelted` / `ItemTraded` /
`MobInteracted` / `PlayerBounced` / `PlayerTeleported` / `PlayerTransform` / `PlayerTravelled` / `TargetBlockHit`

**現行実装が購読しているのは `Open` / `PlayerJoin` / `PlayerLeave` の3つのみ（`src/server.ts:171-179`）。23個が未使用。**

### World の問い合わせ — `index.d.ts:1380-1404`
| メソッド | 戻り値 | 備考 |
|---|---|---|
| `getTopSolidBlock(location?)` | `{ blockName, location }` | **唯一の空間的ブロック読み取り。X/Z列の最上部固体ブロックのみ** |
| `queryData('block'\|'item'\|'mob')` | `BlockQueryResult[]` = `{aux, id, name}` | **ワールドの中身ではなくID一覧（パレット）**。ID検証に使える |
| `getCurrentTick` / `getDay` / `getTimeOfDay` / `getWeather` | — | 時刻・天候 |
| `getPlayers` / `getPlayerList` / `getPlayerDetail` / `getLocalPlayer` | — | プレイヤー |
| `runCommand<R>(cmd, options)` | `CommandResult<R>`（**型パラメータ付き**） | 汎用の逃げ道 |
| `Scoreboard.getObjectives()` / `getScores()` | — | 永続的な数値状態を持てる |

### Player の問い合わせ — `index.d.ts:918-932`
`getLocation()` / `query()` → `QueryTargetResult{position, yRot, dimension, id, uniqueId}` /
`getTags()` / `getDetails()` / `getAbilities()` / `getLevel()` / `getGameMode()` / `getScore()`

## 使えないもの（重要）

**任意座標のブロックを読むAPIが存在しない。** 「(10,64,20)に何があるか」は聞けない。
- `getTopSolidBlock` は列の最上部のみ
- `queryData('block')` はパレットであってワールド内容ではない
- 回避策は `runCommand('testforblock x y z <id>')` だが、これは「**何があるか**」ではなく「**これがあるか**」しか答えない = 総当たりになる

**未確認**: これが Bedrock WebSocket プロトコル自体の制約なのか、socket-be の未実装なのかは一次ソース未確認。`bedrock-protocol-analyst` が確認すること。

## ここから導かれる設計方針（要検証）

観測できないなら**記録する**:
1. AIが配置したブロックを自前で保持する（現行は投げっぱなし）
2. `BlockPlaced` / `BlockBroken` イベントで人間による変更も追跡する
3. 1+2で「AIが把握しているワールドモデル」を構成する
4. `getTopSolidBlock` で地形高さを取得 → **地面に沿った建築**が可能（現行は全て絶対座標で盲目的に配置）
5. `queryData('block')` を**ブロックID事前検証**に使える（現行は検証ゼロ、不正IDはゲームまで飛ぶ）

これは現行の「AIが想像で進めて失敗する」問題と同根 — **見えないから想像するしかない**。

---

# 追記: ブロックID取得手段の追加調査（2026-08-24）

## 【最重要】socket-be が `agent inspect` のレスポンスを捨てている

`node_modules/socket-be/dist/index.js:705-708` の実装:
```js
async inspect(direction) {
  const res = await this.world.runCommand(`agent inspect ${direction}`);
  if (res.statusCode < 0) throw new Error(res.statusMessage);
  // ← res を返さずに破棄。戻り値の型は Promise<void>
}
```
`inspectData` / `detect` / `detectRedstone` / `getItemCount` / `getItemSpace` / `getItemDetail` も全て同じ形で `Promise<void>`。

型は `CommandResult<T> = { statusCode, statusMessage } & T`（`index.d.ts:1903`）なので、**追加フィールドにブロック情報が入っている。socket-be が捨てているだけ。**

**現行実装への影響（実バグ）**: `src/tools/core/agent.ts:157` は
`result = await this.agent.inspect(args.direction)` と書いているが、socket-be の戻り値は `undefined`。
`inspect_block` アクションは「Agent inspected block forward」というメッセージだけを返し、**ブロックIDをAIに渡していない**。
MakeCode の `agent inspect` が機能するのは、MakeCode がレスポンスを読んでいるため。

**回避策**: `world.runCommand('agent inspect forward')` を直接呼び、戻り値の全フィールドを読む。
**未確認**: レスポンスの正確なフィールド名。一次ソース（wiki / Code Connection API ドキュメント）に記載を発見できず。
→ **実機で生JSONをダンプして確定させること。これが最優先の実機検証項目。**

## コマンドによるブロックID取得の可否（wiki で確認済み）

| 手段 | 可否 | 根拠 |
|---|---|---|
| `testforblock <pos> <block>` | **不可**。「指定ブロックが在るか」の二値のみ。何が在るかは答えない | https://minecraft.wiki/w/Commands/testforblock |
| `agent inspect <direction>` | **可（Education限定・エージェント前方のみ）**。MakeCode が使っているのはこれ | socket-be 実装より |
| 任意座標を返す汎用コマンド | **確認できず**。存在しない可能性が高いが未確認 | — |

## `/structure save` によるワールド吸い出し案の評価

依頼者から提案された案。wiki で確認した結果、**素直には通らない**:
- `structure save <name> <from> <to> [disk|memory]` の `disk` は「**ワールドのデータベース自体に保存**」であり、単体ファイルの書き出しではない（https://minecraft.wiki/w/Commands/structure）
- 単体の `.mcstructure` ファイルが得られるのはストラクチャーブロックUIの Export 機能で、**GUI操作**。コマンドから起動できない
- 仮にワールドDB（LevelDB）を直接読む設計にすると、(a) MCPサーバがMinecraftと同一マシンに限定される、(b) ゲームがDBをロックしている可能性、(c) 保存タイミングが不定 — の3点で脆い

**未確認**: `structure save ... disk` 実行後にワールドフォルダ内へ実ファイルが現れるかどうか。実機で確認する価値はある。
なお `structure` コマンド自体は Education でも利用可能（wiki に "exclusive to Bedrock Edition and Minecraft Education" と明記）。

## 依頼者からの確定情報
- **Minecraft Education Edition でアドオン（ビヘイビアパック）は使える。**（2026-08-24、依頼者が明言）
  → `@minecraft/server` Script API 経由でのブロック読み取りが有力な選択肢になる。
  → 論点は「使えるか」ではなく「どう作るか」「教員が導入できる手順か」に移る。

---

# 追記: Script API ルート調査結果（2026-08-24）

出典は全て learn.microsoft.com（Minecraft Creator Documentation）。担当エージェントは WebSearch と他ドメインへのアクセスがブロックされていたため、教育版固有の裏取りは未実施（教育版でアドオンが使えることは依頼者が確認済み）。

## 確定した事実

| 項目 | 結果 |
|---|---|
| ブロック読み取り | `Dimension.getBlock(location)` → `Block \| undefined`（**stable**）。`typeId` / `permutation`（ステート込み）/ `isAir` 等が取れる |
| **範囲一括ダンプAPI** | **存在しない。** `getBlocks()` は experimental かつ戻り値 `ListBlockVolume` は**座標の集合**であってブロック種別ではない（「条件に合う座標を探す」API） |
| 実装方法 | `BlockVolume.getBlockLocationIterator()` + `getBlock()` のループ。**stable のみで完結** |
| 未ロードチャンク | `undefined` または `LocationInUnloadedChunkError`。`isChunkLoaded()` で判定可。`TickingAreaManager` で事前ロード可能 |
| **`@minecraft/server-net`** | **使用不可。** 公式明記: "can only be used on Bedrock Dedicated Server. These APIs do not function within the Minecraft game client" |
| 外部→スクリプト | `/scriptevent <id> <message>` で成立。**メッセージ長上限 2048 文字**（公式明記）。Requires Cheats: Yes |
| 長時間処理 | `system.runJob()` が**必須**。1tickで回すと watchdog shutdown のリスク。generator を1ブロック1 yield の粒度で書くのが公式推奨 |
| Beta APIs トグル | **stable のみを使えば不要。** experimental な `getBlocks()` を使うと必須になる → **使わない設計を推奨** |

## スクリプト→外部の経路（最大の論点）

エージェントは「公式ドキュメントに WebSocket プロトコルのイベント仕様が無いため確認不能」と報告。
**ただし socket-be の型定義に決定的な証拠がある（親エージェントが確認）:**

```ts
declare enum PlayerMessageType {   // index.d.ts:479
    Chat = "chat",  Say = "say",  Me = "me",  Tell = "tell",  Title = "title"
}
declare class PlayerMessagePacket extends BasePacket {   // index.d.ts:1179
    type: PlayerMessageType;  message: string;  sender: string;  receiver: string;
}
```

→ **プロトコルは `say` / `tell` を PlayerMessage として運んでいる。**
→ スクリプト側から `dimension.runCommand('say <payload>')` すれば WebSocket 側で `message` 文字列として受信できる可能性が高い。
→ **未確認**: `world.sendMessage()` が同じ経路に乗るか、1メッセージあたりの最大バイト数、1tickあたりの送出上限と欠落率。**実測が必要。**

## データ量の問題

- 16³ = 4,096ブロック / 32³ = 32,768 / 64³ = 262,144
- `typeId` は `"minecraft:stone"` 形式で15〜30バイト → **素朴なJSONだと16³で60〜120KB**
- `/scriptevent` の2048文字上限にもチャット送出にも載らない
- → **パレット化（typeId辞書 + 整数インデックス）+ RLE が事実上必須**
- → 分割送出（seq/total ヘッダで再結合）の設計が必要

## 最優先の実機検証項目
1. `say` 経由でスクリプトから外部へ文字列が届くか（socket-beで `/wsserver` 接続して実測）
2. 1メッセージあたりの最大バイト数（二分探索）
3. 1tickあたりの送出可能数と欠落率
4. `getBlock()` の実効スループット（blocks/tick、PC/Chromebook/iPad別）

---

# 【訂正】コマンドルート調査結果（2026-08-24）— 本ファイルの前提を一部覆す

## ★訂正1: `testforblock` は二値ではない

本ファイル冒頭で「`testforblock` は二値のみ」と書いたのは**誤り**。
WebSocket の `commandResponse` は不一致時の `statusMessage` に**実際に在るブロック名を含む**。

```js
// sanand0/minecraft-websocket  mineserver-blockcount.js:40,46-47（稼働中の公開実装）
send(`testforblock ~${x} ~${y} ~${z} air`)
const blockMatch = msg.body.statusMessage.match(/is (.*?) \(expected:/)
// body.position も返る
```
minecraft.wiki は「一致しない」という*条件*しか記述せず、返却文字列を記載していない。
**wikiだけを読むと二値に見えるが、実際の応答には情報がある。**
→ **1コマンドで任意座標のブロックが判明する。**

## ★訂正2: 100コマンドを同時に飛ばせる（最大の最適化）

- 同時未応答コマンドの上限は **100本**。超過で `-2147418109` "Too many commands have been requested"
  （socket-be の enum に `TooManyPendingRequests = -2147418109`、`dist/index.js:250`）
- 現行実装は `src/server.ts:636` で完全直列、さらに `src/tools/base/tool.ts:203-211` が
  10コマンドごとに5ms・50コマンドごとに20msのスリープを追加
- socket-be の `runCommand` はキューもスロットルも持たず requestId 照合のみ
  → **呼び出し側で `Promise.all` を100本ずつ回すだけでパイプライン化できる**

| 4096ブロック（16³） | 時間 |
|---|---|
| 現行（直列＋スリープ） | 約208秒 |
| パイプライン（100並列） | **約2秒（100倍）** |

## 手法の序列（16³=4096ブロック、往復50ms仮定・100並列）

| 手法 | 時間 | 得られる情報 | 備考 |
|---|---|---|---|
| `gettopsolidblock` 縦走査（地表25%固体） | **0.64秒** | blockName + blockData + position | **構造化・ローカライズ非依存**。空気は無料でスキップ |
| `testforblock` 全走査 | **2.05秒** | 全ブロック名（表示名） | 非破壊・任意座標・候補推測不要 |
| `fill replace` の `fillCount` | 0.008秒 | 個数のみ（座標不明） | 32768ブロックを1コマンド。前段フィルタ向き |
| `execute if blocks` 領域差分 | 0.05秒 | 1ビット | キャッシュ有効性判定に有効 |
| `execute if block` 線形探索 | 819秒 | 全ブロック | 1コマンド1ビットで不利 |
| `agent inspect` 総当たり | 239秒 | 前方1ブロック | **並列化不可（エージェントは単一グローバル状態）→ 完全に劣位** |

## その他の確定事項
- **`execute store` は Java 専用**（wiki に `only|java` 明記）→ **スコアボード経由の一括回収は成立しない**
- `gettopsolidblock` は構造化フィールド `{blockName, blockData, position}` を返す。
  Sandertv/mcwss と socket-be の**独立2実装が同じフィールド名**を使用（socket-be `dist/index.js:2395-2399`）
- `fill <X> replace <X>`（自己置換）で非破壊カウントできる可能性。**Bedrockが計上するか未確認**
- `tickingarea` で強制ロード可能。**ただし同時10エリア・1エリア100チャンクまで**（実質的な同時読み取り範囲の上限）
- `fill` の体積上限 32,768（MCPE-26134。wikiにBedrock版の記載なし、要実測）

## 残るリスク
1. **ローカライズ** — `statusMessage` のブロック名は表示名。日本語クライアントで「石」になる恐れ。
   対策: `queryData('block')` の `{aux, id, name}` レジストリで表示名↔ID表を1回構築
2. **`gettopsolidblock` の "solid" の定義** — 水・葉・松明をスキップすると読み取りに穴が空く。未確認

## 最優先の実機検証（合計10コマンド以内で設計が確定する）
1. `testforblock <既知の石の座標> minecraft:structure_void` → `body` 全体をダンプ（応答文字列の実物）
2. 同上を日本語クライアントで実行（ローカライズ有無）
3. 水面・葉ブロックの上で `gettopsolidblock`（solid の定義）
4. `say` を1本/10本/100本並列で流しレイテンシ実測（本見積もりの全秒数の根拠）

---

# 【本命発見】プロトコル深掘り調査結果（2026-08-24）

## ★`getchunkdata` — 1リクエストで16×16=256列の一括読み取り

```
getchunkdata <dimension> <chunkX> <chunkZ> <height>
```
- Bedrock/Education 限定の**隠しコマンド**。Operator権限。**socket-be 未実装**
- LeviLamina（現行バイナリのシンボル自動生成、v26.20.7 / 2026-08-01）に現存確認:
  `src/mc/server/commands/edu/GetChunkDataCommand.h` → `mDimension / mChunkX / mChunkZ / mHeight`
- minecraft.wiki: 「指定y値より下の、チャンクのブロックIDつき高さマップ」「**256エントリ（16×16）**」
- 併せて `getchunks <dimension>` も存在（引数・返り値とも未確認）

**返り値フォーマットが2説で食い違う（要実機検証）**
- mcwss（Go, 2020-07最終更新）`protocol/command/chunk_data.go` の `ParseChunkData`:
  カンマ区切り + `*N` ランレングス、各値 base64 デコードで4バイト = **B, G, R, height**
- minecraft.wiki（現行）: 「6桁のブロック識別子、末尾2文字が base64 の高さ」
- 推測: 1.18.30 の「ブロックIDが数値から名前ベースへ移行」で変わった可能性

**`getchunkdata` のパーサ実装は mcwss にしか存在しない。**

## ★`agent inspect` の結果が消える真因

1.18.30 で **`action:agent` 専用チャネル**が導入（Mojang公式リリースノート）:
> Agent-based commands in websockets moved to new "action:agent" format, and all commands
> are now queued and include unique ids to correlate responses

**同一 requestId に対し `commandResponse` と `action:agent` の2フレームが返る。**
socket-be は前者で resolve し、後者は受信ハンドラの許可リストに無いため破棄:
```js
const deserializablePurposes = ["commandResponse","ws:encrypt","error","event","data"];
if (!deserializablePurposes.includes(messagePurpose)) {
  console.error("[Network] Invalid message purpose:", messagePurpose); return; }
```
`chat` も同様に破棄されている。**mcpews (`src/lib/server.ts` sendAgentCommand) は2フレーム受信を正しく実装。**

LeviLamina `src/mc/world/actor/agent/agent_commands/InspectCommand.h`:
`Block const* mBlock` に結果を保持 → `isDone()` ポーリング → `fireCommandDoneEvent()` の遅延実行モデル。
`MinecraftAgentActionType`: Inspect=8（mcpews `protocol.ts`）。**body のフィールド名は mcpews でも `unknown`＝未特定。**

## ★socket-be の実装カバレッジ（技術選定に直結）

| | socket-be | 実プロトコル |
|---|---|---|
| イベント | 26 | **83**（bedrockws-deno のzodスキーマ実測。うち69は未解析） |
| `action:agent` | **破棄** | 存在 |
| `chat` 購読（`chat:subscribe`） | なし | 存在（sender/receiver/messageでフィルタ可） |
| `getchunkdata` / `getchunks` | なし | 存在 |
| `agent getitemdetail/space/count` | なし | 存在 |
| その他EDUコマンド | なし | `codebuilder`, `getspawnpoint`, `takepicture`, `ability`, `lesson`, `dialogue` 等 |

→ **socket-be を土台にする前提が崩れた。[mcpews](https://github.com/mcpews/mcpews)（2026-08-01更新）の方が適切な可能性。socket-be の型定義自身が mcpews を `@link` で参照している（index.d.ts:161）。**

## ★Microsoft公式 Code Connection API ドキュメント（archive.org で全文入手）
「Code Builder for Minecraft: Education Edition — API Documentation」より返り値:
- `inspect [direction]` → `[string blockName]`（例 `"coal_ore"`）※同文書内で `itemName` と表記揺れ
- `inspectdata` → `[int data]`（airは0）／ `detect` → `[bool result]`
- `fill ...` → `[int fillCount]` `[string blockName]`
- **`testforblocks <begin> <end> <destination> [mode]` → `[int compareCount]` `[bool matches]`**（2領域の一括比較）
- `clone ...` → `[int count]`
- `getitemdetail/space/count` → `[string itemName]` / `[int spaceCount]` / `[int stackCount]`

## DataRequest の type（調査項目への回答）
**`block` / `item` / `mob` の3種のみ。ワールド内容を返す type は発見できず。**
ただし型定義に `DataRequestPurpose<T> = 'data:${T}'` の汎用テンプレートがあり、他type の余地は残る（実在は未確認）。

## 重要な注意
- `https://mojang.github.io/bedrock-protocol-docs/` は**実在するが本件とは別物**。RakNetバイナリプロトコルの文書で、
  `/connect ws://` の WebSocket プロトコル・DataRequest・agentコマンドは一切扱っていない
- **Minecraft Education 公式サポートは「WebSocketを正式な外部APIとしてサポートする予定はなく、
  正式なドキュメントを公開する予定もない」と表明。仕様が予告なく変わるリスクを設計に織り込むこと**

## 参考にすべき実装（優先順）
1. **mcpews** https://github.com/mcpews/mcpews — 全messagePurpose、AgentActionType、CommandVersion網羅。2026-08-01更新。`mitm`/`repl` をCLI同梱
2. **mcwss** https://github.com/Sandertv/mcwss — `getchunkdata` の唯一の完全パーサ。ただし2020-07最終
3. **bedrockws-deno** https://github.com/bedrock-ws/bedrockws-deno — 83イベントのzodスキーマ。2026-08-20更新
4. **CodeConnectFix** https://github.com/lrocher/CodeConnectFix — MITM。実機フレームダンプの土台に最適
5. **LeviLamina** https://github.com/LiteLDev/LeviLamina — 現行バイナリのシンボル。コマンド実在確認に最も信頼できる

## 最優先の実機検証（1回の接続で1〜5が全部片付く）
1. `getchunkdata overworld 0 0 100` の生JSONダンプ ← **最優先**
2. その `data` 文字列を mcwss の `ParseChunkData` に通し既知地形と突合
3. `getchunks overworld` のダンプ
4. `action:agent` purpose で `inspect forward` → 2フレーム両方をダンプ（フィールド名確定）
5. `agent inspect` を従来の `commandRequest` で送った場合の後方互換性
→ **mcpews の `mitm` / `repl` をそのまま使うのが最短**

---

# ワールドファイル直接読み取りルート調査結果（2026-08-24）

## ★`structure save ... disk` の保存先が特定された

**LevelDB のキー `structuretemplate_<namespace>:<name>`（名前空間省略時 `mystructure:`）。
値がそのまま `.mcstructure` のバイト列。** ファイルとしては現れない。

根拠: `mcbe-leveldb-reader` の `extractStructureFilesFromLevelDbKeys` 実装
（`structureKeyPrefix="structuretemplate_"` / `defaultNamespace="mystructure:"` がハードコード）。
独立3ツール（destruc7i0n/extract-mcstructure, koukiBOBS/MCBEStructureExtractor, mcbe-structure-extract）が同じ前提。

## 使えるライブラリ（npm で実在・バージョン確認済み）

| パッケージ | ver | 最終公開 | 評価 |
|---|---|---|---|
| **mcbe-leveldb-reader** | 5.0.1 | **2026-08-15** | ◎本命。**純JS・ネイティブ依存なし**（`@zip.js/zip.js`, `pako` のみ）。Mojang公式 minecraft-creator-tools の抽出 |
| **prismarine-nbt** | 2.8.0 | 2025-12-21 | ◎ `little` proto で `.mcstructure` を直接パース可 |
| **prismarine-chunk** | 1.41.0 | 2026-07-31 | ◎ SubChunk デコーダが現役保守 |
| minecraft-data | 3.113.2 | — | bedrock は **1.26.40 まで**存在を実行確認 |
| @minecraft/creator-tools（Mojang公式） | 0.17.7 | 2026-08-02 | `mct` CLI。**worldサブコマンドにブロック読み取りは無い**。`renderstructure`/`buildstructure` あり |
| bedrock-provider | 3.1.0 | 2024-06-25 | **leveldb-zlib必須＝ゲーム起動中は使用不可** |
| leveldb-zlib | 1.2.0 | 2022-05-07 | Windows x64/Node24 の prebuild 同梱。**ただし排他ロックあり** |

※ `mcstructure`（スコープなし）は **npm に存在しない**（404）

## ★ロックの実測結果（Windows 11 / Node 24）
- プロセスAが `leveldb-zlib` で open 中 → プロセスBの open は**失敗**（"別のプロセスが使用中"）
- 同条件で プロセスBが `MANIFEST-*` / `*.log` / `*.ldb` を **`fs.readFile` → 成功**。
  `mcbe-leveldb-reader` でのパースも成功しキー取得できた
→ **純JSリーダ（LOCKを取らない読み取り専用）なら起動中でも読める可能性が高い**

**未検証の危険**: LevelDBのコンパクション中は `.ldb` の生成/削除が走り、読み取り中に不整合が起こりうる
（PapyrusCS issue #68 に同種の報告）。**db/ を一時ディレクトリへ丸ごとコピーしてから読む＋リトライ**を実装すべき。

## ★最大の未確認リスク: フラッシュ遅延
**Minecraft(EDU)がブロック変更をいつ `db/` に書くかが不明。**
即時なら実用。オートセーブ待ち／ワールド退出時なら**「リアルタイム観測」には使えず「事後解析」限定**になる。
※ BDS には `/save hold` → `/save query` → `/save resume` があるが、Microsoft Learn は
「This command is for use on a dedicated server only.」と明記。**EDUクライアントでの可否は未確認。**

## Education Edition のワールド保存場所（公式サポート記事より、インストール形態で2系統）
| 形態 | パス |
|---|---|
| デスクトップ版(.exe) | `%APPDATA%\Minecraft Education Edition\games\com.mojang\minecraftWorlds` |
| Microsoft Store版(UWP) | `%LOCALAPPDATA%\Packages\Microsoft.MinecraftEducationEdition_8wekyb3d8bbwe\LocalState\games\com.mojang\minecraftWorlds` |
| macOS | `~/Library/Application Support/minecraftpe/games/com.mojang` |

- 通常Bedrockは `Microsoft.MinecraftUWP_8wekyb3d8bbwe`。**PFNが違うので流用不可**
- **フォルダ名はGUID**。`levelname.txt` を読んで突き合わせる必要あり

## フォーマット要点
- **LevelDBキー**: `LE i32 chunkX | LE i32 chunkZ | (dim≠0なら LE i32 dim) | tag(1byte) | (tag=47なら subchunk index)`
  主タグ: 43 Data3D / 45 Data2D / **47 SubChunkPrefix** / 49 BlockEntity / 50 Entity / 54 FinalizedState / **56 BorderBlocks(EDU専用)**
- **SubChunk(47)**: version(1|8|9) → storageCount → (v9のみ)subChunkIndex → 各レイヤ{paletteHeader(bit0=runtimeIDフラグ, >>1=bitsPerBlock), uint32LEワード列, **int32LE paletteSize（ディスク時。ネットワーク時はZigZag VarInt）**, LE NBT compound×paletteSize}。インデックスはXZY順
- **.mcstructure**: **無圧縮リトルエンディアンNBT**（Javaのgzip+BEと異なる）。
  `format_version` / `size` / `structure_world_origin` / `structure.block_indices`（2レイヤ、**-1は「ブロックなし」**）/ `structure.entities` / `palette.default.block_palette` / `palette.default.block_position_data`。
  インデックス→座標は **ZYX順**: `i = SZ*SY*X + SZ*Y + Z`

## 推奨実装（担当の第一候補）
`/structure save <name> <from> <to> disk` を WebSocket 経由で実行
→ `db/` を一時コピー → `mcbe-leveldb-reader` で `structuretemplate_mystructure:<name>` を取得
→ `prismarine-nbt` の `little` でパース → block_indices × block_palette で解決
→ `structure delete` で後始末

**理由**: ブロックパレットのビット詰め・バージョン差異を自前で扱わずに済む。読む範囲をコマンドで指定できチャンク境界に縛られない。
**欠点**: `/structure save` の体積上限が公式コマンド仕様に記載なし（ストラクチャーブロックUIの64×384×64が適用されるかは未確認）

## この経路の構造的制約（確定）
**MCPサーバが Minecraft と同一マシン必須。** WebSocket制御はネットワーク越しで動くのに、この経路だけローカル限定。
**アーキテクチャ上の非対称性として設計に明記すること。**

## 実機検証項目
1. **ブロック変更が `db/` に書かれるまでの遅延**（最重要。設置→`db/*.log`のmtime/サイズ監視）
2. `/structure save ... disk` 直後に `structuretemplate_` キーが読めるか
3. EDU起動中に `db/` の生ファイルを fs で読めるか（今回の実験は leveldb-zlib のビルドでの結果。Minecraft本体のopenフラグは不明）
4. EDUのインストール形態と実パス（`levelname.txt` 確認）
5. `/save hold` `/save query` が EDU クライアントで使えるか
6. `/structure save` の最大体積上限

---

# 【最重要】先行事例調査結果（2026-08-24）— 完成した実装が存在する

## ★chapmanjw の3リポジトリ構成が完成解

**https://github.com/chapmanjw/minecraft-bedrock-mcp-server**（★6 / 2026-08-14 / **MIT** / TS）
**https://github.com/chapmanjw/minecraft-bedrock-mcp-behavior-pack**（★2 / 2026-07-15 / MIT / TS）

```
MCPクライアント --MCP Streamable HTTP+Bearer--> MCPサーバ(Node)
    --HTTP long-poll+Bearer--> ビヘイビアパック(BDS内) --@minecraft/server--> ワールド
```
- ツール呼び出しをサーバ側キューに積み、パックが `GET /bridge/poll` でロングポーリング取得 → Script API 実行 → `POST /bridge/result`
- イベントは `POST /bridge/event` にバッチ送信。起動時ハンドシェイクでプロトコルバージョン交渉、スクリプトリロード時にイベント購読を再武装

**ツール設計: 78個・1ツール1機能（action分岐なし）**
block 8 / world 10 / entity 12 / player 11 / structure 8 / structure_file 4 / scoreboard 7 / event 4 / inventory 4 / property 4 / server 3 / effect 2 / command 1
MCP SDK `^1.29.0` + `zod ^3.23.8`、`inputShape` に Zod 直書き、Streamable HTTP + Bearer

**領域一括読み取りの実装**（`src/dispatcher/handlers/block-handlers.ts`）— 我々に最も効く:
```
PAGE_SIZE = 1024          // 1ページで返すマッチブロック数
MAX_SCAN_PER_PAGE = 16384 // 1ページの最大スキャン数
YIELD_INTERVAL = 2048     // ジェネレータの yield 間隔
```
- `ctx.scheduler.runJob(function* collect(){...})` で `system.runJob` に流し 2048ブロックごとに yield
- **`cursor` 文字列（線形インデックス）でページング** → LLMが続きを要求できる
- `filter.include` / `filter.exclude` で typeId フィルタ（空気除外で転送量削減）
- `getBlockSafe()` は未ロードチャンクの例外を握りつぶし `undefined`
- `mc_structure_create_from_world` / `mc_structure_file_read`（.mcstructure を base64 で返す）も MCPツール化

**警告（README に明記）**: `@minecraft/server-net` / `@minecraft/server-admin` は **beta モジュールで代替なしに打ち切られうる**。BDSのバージョンをピン留めし自動更新するな。
**前提**: BDS（または Education 専用サーバ）が必須。クライアント単体の `/connect` では使えない。

## ★WebSocket経路で観測を解いた先行事例は「存在しない」（重要な確証）

Bedrock を WebSocket 制御する MCP サーバは3件のみ:
| | 観測 |
|---|---|
| Mming-Lab/minecraft-bedrock-education-mcp（本件） | `get_top_solid_block` / `query_block_data` のみ |
| nchiari/minecraft-ai-bot-server（★0 / 2026-05-01） | 本件の派生。**新規性なし** |
| ando-front/minecraft-bedrock-mcp（★0 / Python） | **観測ツール無し＝断念** |

`p0t4t0sandwich/minecraft-be-websocket-api`（★23）も観測なし。
**WebSocket経路の実装者は一様に観測を諦めている。**

- glama.ai の Minecraft MCP 約20件に **Bedrock/Education 対応は1件も無い**（全て Java/Mineflayer/RCON）
- npm に **Bedrock WebSocket系の MCP パッケージは公開されていない**
- modelcontextprotocol/servers 公式リスト、awesome-mcp-servers 系にも Minecraft エントリなし

## ★訂正: `getchunkdata` の返り値は未確定（2名の報告が食い違う）

| 報告者 | 主張 | 根拠 |
|---|---|---|
| プロトコル担当 | ブロックIDつき高さマップ | minecraft.wiki の現行記述 |
| 先行事例担当 | **「色(RGB24)+高さ」でありブロックIDではない** | mcwss `chunk_data.go` の実装コードとコメント |

さらに **mcwss の `ChunkDataRequest` は定義されているだけで `player.go`/`agent.go` から呼ばれていない**（grep確認）。
**動作実績のある実装は存在しない。** 「垂直方向の中身は読めずトップダウン地図相当」の可能性があり、
**実機で叩くまで期待値を上げないこと。**

## socket-be の現状
`tutinoko2048/SocketBE` ★33 / 2026-07-19 / **v2.6.0**（本件は `^2.3.1` — 3マイナー遅れ）
`getTopSolidBlock()` は実装済みで本件も `src/tools/core/blocks.ts:151` で使用中。

## ★依頼者自身の既存資産（この問題に直結）
- **https://github.com/Mming-Lab/minecraft-education-server-docker**（★1 / **2026-08-23**）
  → chapmanjw 方式に必要な **Education専用サーバの土台が既にある**
- **https://github.com/Mming-Lab/makecode-minecraft-numeric-blocks**（★1 / 2026-03-18）
  「エージェントがブロックを検査して異なる色の羊毛から数値(0-9)を取得」
  → **観測手段の乏しさを回避するために自作された道具**。MakeCode界隈の標準的ワークアラウンド

## MakeCode の実態（訂正）
**MakeCode 公式リファレンスに「座標のブロックを取得する」ブロックは存在しない。**
あるのは `blocks.testForBlock`（真偽値）/ `testForBlocks`（領域一致の真偽値）のみ。
※ Code Connection API 公式ドキュメントは `inspect [direction] → [string blockName]` と記載しているが、
MakeCode のブロックパレットに露出しているかは**未確認**。

**TheBeems/pxt-worldBuilder `src/01-search.ts` が最良の回避実装**:
`testForBlock` の真偽値だけで、**指数探索で範囲を絞り→二分探索で境界確定**して地形高さを求める。`O(log n)` 回で済む。
→ `gettopsolidblock` が使えない状況（オーバーハング下、洞窟内）の補完に使える。

## Java版から学ぶべきツール表面設計
**ChangingSelf/maicraft-mcp-server の `QueryAreaBlocksAction`（391行）が最も練られている**:
```ts
startX/Y/Z, endX/Y/Z, useRelativeCoords?, maxBlocks?,
compressionMode?      // ★ブロック種別でグループ化 {name, count, positions[]}
includeBlockCounts?,
filterInvisibleBlocks? // ★視線が通らないブロックを除外
```
**空気を除外・種別でグループ化・視線で間引く**の3段削減が、LLMに渡すトークン量を実用域に収める鍵。

## 「できない」記録（確定した制約）
1. **`/data` は Java 限定** → コマンドでブロック/エンティティのNBTを読むのは不可
2. `/testforblock` は問い合わせ用途に使えない（対象IDを引数で与える必要）
3. `/gettopsolidblock` `/getchunkdata` は**ほぼ未文書化**（wiki自身が「情報が非常に少ない」と記載）
   → 「できない」ではなく**「知られていない」タイプ。好材料**
4. **Education は Java/Bedrock と非互換**。→ `bedrock-protocol` クライアント経路は Education に使えない可能性が高い
5. `server-net` / `server-admin` は **beta で消滅しうる**（手法A最大のリスク）

## 手法Bの部品（参考・Educationでは不可の可能性）
`PrismarineJS/bedrock-protocol` ★464 / 2026-08-23（活発、npm 3.58.3）
`PrismarineJS/prismarine-chunk` ★70 / 2026-07-31 — `CommonChunkColumn.js` に `getBlock/getBlockStateId/getBlocks/getBlockEntity` 実装済み
→ **「Bedrock版 Mineflayer」の部品は揃っている**が、①別プレイヤーとして参加が必要 ②Educationは認証系が別で接続不可の可能性

---

# ★★実測による全面訂正（2026-08-24、教育版 1.26.3200、日本語クライアント）

**この文書の「一括読み取り」の議論は、教育版では前提から成立しない。**

`tools/live-probe` で実機に接続し、`/help` を41ページ全部（25,805バイト）取得した。
コマンド一覧は**87個**。そこに以下は**存在しない**：

| コマンド | この文書での扱い | 実測 |
|---|---|---|
| `getchunkdata` | 「1リクエストで16×16=256列の一括読み取り」「最優先で生JSONダンプ」 | **不明なコマンド** |
| `getchunks` | 「併せて存在」 | **不明なコマンド** |
| `gettopsolidblock` | 「0.64秒」「構造化・ローカライズ非依存」「blockName + blockData + position」 | **不明なコマンド** |
| `querytarget` | （治具で使用） | **不明なコマンド** |

`/help getchunkdata` の実際の返答:
```
不明なコマンド: getchunkdata。このコマンドが存在し、これを使用する権限があることを確認してください
```

**つまり socket-be の `world.getTopSolidBlock()` は教育版では動かない。**
レガシーMCPの `blocks` ツールが公開している `get_top_solid_block` アクションは、
教育版に対しては存在しないコマンドを送っている。`tool-surface-audit.md` の
「存在しないアクションを広告している」問題と同じ種類の欠陥がもう1件ある。

これらが Bedrock 統合版には存在する可能性は否定していない。**教育版に無い**ことだけが実測結果。
配布モデルAが教育版向けである以上、設計は「無い」前提で立てる必要がある。

## 代わりに存在する読み取り経路（すべてコマンド一覧から確認）

| コマンド | 実測された文法 | 使いどころ |
|---|---|---|
| `testforblock` | `<position: x y z> <tileName: Block> [blockStates]` | 1ブロック1コマンドの逐次読み。`statusMessage` のパースが要る |
| `execute if block` | `<position> <block> [blockStates] [chainedCommand]` | 同上だが**散文を返さない**ので翻訳に強い |
| `execute if blocks` | `<begin> <end> <destination> <scan mode>` | **領域どうしの比較を1コマンドで** |
| `testforblocks` | `<begin> <end> <destination> [masked\|all]` | 同上。`assess_build` の対称性判定はこれで足りる |
| `structure save` | `<name> <from> <to> [includeEntities] [saveMode] [includeBlocks]` | `.mcstructure` 書き出し → ファイル解析（依頼者が最初に提案した経路） |
| `clone` | `<begin> <end> <destination> [maskMode] [cloneMode]` / `filtered <cloneMode> <tileName> [blockStates]` | `edit_region` の委譲先。**文法確認済み** |
| `takepicture` | `<cameraSpawnLocation: x y z> <targetPlayer>` ほか2形式 | 教育版固有。「AIがマイクラを見る」の別経路 |

## コマンド生成器の文法が実機と一致した

ゲーム自身が返した文法は、wiki から実装した内容と**完全に一致**していた：

```
/setblock <position: x y z> <tileName: Block> <blockStates: block states> [replace|destroy|keep]
/setblock <position: x y z> <tileName: Block> [replace|destroy|keep]
/fill <from: x y z> <to: x y z> <tileName: Block> <blockStates: block states> [oldBlockHandling: FillMode]
/fill <from: x y z> <to: x y z> <tileName: Block> replace [replaceTileName: Block] [replaceBlockStates: block states]
```

とくに **`/setblock` のモードは `replace|destroy|keep` の3つだけ**で、`hollow`/`outline` は無い。
レガシーの `blocks` ツールが `set_block` と `fill_area` に5値の共通enumを与えていたのは、
実機文法に照らして誤りだったことが確定した。

## 未解決：ワールド系コマンドが無応答だった

`/help` 系48本はすべて応答したが、`querytarget` 以降の**34本は1本も応答が返らなかった**
（エラーですらなく沈黙）。`help agent` が応答した98ms後に `querytarget @s` が無応答なので、
レート制限やタイムアウトではなく**種類の問題**。

原因の候補は3つあり、区別が付いていない：
1. ワールドが動いていない（一時停止／ウィンドウ非アクティブ）
2. 権限（チートOFF、プレイヤーが非オペレーター）
3. ソケット側の何か

`a2-world` リグは先頭3コマンド（`list` → `say` → `setblock`）でこの3つを切り分けて停止する。
**34本のタイムアウトに4分かけて1ビットしか得られなかった**のが前回。

---

# ★訂正の訂正（同日、socket-be を実機で走らせた結果）

上の「教育版に `getchunkdata` は存在しない」は**言い過ぎだった。** 撤回する。

## 1. 「`/help` に出ない」は「存在しない」ではない

指摘の通り、`/help` は権限で絞られるし、Bedrock には**意図的に一覧へ出さないコマンド**がある。
手元の証拠（一覧に無い／`/help <名前>` が「不明なコマンド」）は、
**「存在しない」「隠されている」「権限が無い」の3つを区別できていない。**
`/help` は一覧にあるものしか知らないので、隠しコマンドにも同じ返答をする。

決定的なのは socket-be 自身のコードだった：

```js
async getTopSolidBlock(location) {
  const res = await this.runCommand(`gettopsolidblock ${locationArg}`);
  return { blockName: res.blockName, location: res.position };
}
```

**動いているライブラリが `gettopsolidblock` を送り、`blockName` と `position` を読んでいる。**
`agent move` / `agent inspect` など全エージェントコマンドも実装されている。
一覧に出ないコマンドを実装が現に使っている以上、「存在しない」は主張できない。

（ただし socket-be が正しいとも限らない。同じライブラリが `agent inspect` について
「データを返さない」と誤診していた前例がある。**実際に叩くまでは未確定。**）

決着方法は `_battery.mjs` の**対照実験**：存在が確実なコマンド（`testforblock`）と
存在しないことが確実な文字列（`zzznotacommandatall`）で挟み、引数なしで叩いたときの
失敗メッセージがどちらに似ているかで分類する。2つの対照が同じ失敗をしたら
「判定不能」と出す（そう出すこと自体が結果）。**要・生きているワールド。**

## 2. 沈黙の原因は「ワールドの一時停止」だった

3セッションで同じ形（`/help` だけ応答、他は全滅、push イベントもゼロ）。
原因として `sendcommandfeedback` を疑って**ゲートに実装しかけたが、裏付けが無かった**。
wiki は「チャットに出るか」としか書いておらず、ソケットの呼び出し元に効くとは書いていない。

決着は socket-be を実際に走らせて付いた。**同一プロセスの2接続で結果が正反対**：

| | 接続1（31秒） | 接続2（154秒） |
|---|---|---|
| `say` | 沈黙 | OK |
| `time query daytime` | 沈黙 | 「時刻は 7558 です」 |
| `list` | 沈黙 | 「1/40 のプレイヤーがオンラインです: Kai_U」 |
| `help 1` | OK | OK |
| `setblock ~ ~-3 ~ gold_block` | 沈黙 | **「ブロックが設置される」** |

同じライブラリ・同じフレーム・同じコード。接続1では socket-be 自身も
`Failed to get local player` を出している。**フレーム形式は原因ではない。**

Bedrock はウィンドウがフォーカスを失うと単一プレイヤーのワールドを止め、
これを無効化する設定は無い（回避策はインベントリかチェストを開いたままにすること）。
`/help` だけはクライアント側が答えるので、外からは接続が生きているように見える。

**実機検証の手順書に「ゲームウィンドウをフォーカスしたまま走らせる」を前提条件として追加すること。**

## 3. フレーム形式の差分（原因ではないが、合わせる価値はある）

| | この治具（当初） | socket-be |
|---|---|---|
| `body.version` | 1（`Initial`） | **42**（`LocateStructureOutput`） |
| `body.origin` | `{type:"player"}` | **無し** |
| `header.messageType` | `"commandRequest"` | **無し** |
| 暗号化 | 無し | 接続時に既定でネゴシエート |

`CommandVersionMismatch = -2147483645` というステータスコードが定義されている以上、
`version` は意味のあるフィールド。2016年の文法を要求し続ける理由が無いので **42 に合わせた。**

---

# ★実測完了（2026-08-24、教育版 1.26.3200、日本語クライアント、socket-be 経由）

接続が確立し、**27項目の答えが取れた。** ワールドは895msで応答（`world_answered_after_ms: 895`）。

決め手は依頼者の2つの指摘だった：
1. **「接続後の応答を返していないからマイクラ側が接続完了していない」** — socket-be は接続直後に
   暗号化ハンドシェイク → イベント購読 → `world.onConnect()` を行う。自作プローブは**何も送らずに
   いきなりコマンドを投げていた**
2. **暗号化を OFF に設定**（ゲーム側）→ socket-be も `disableEncryption` で合わせた

ハンドシェイクと暗号化設定を同時に変えたので、**どちらが効いたかは分離できていない。**
ただし配布モデルは SocketBE フォークを使う（D-2）ので、実装上は問題にならない。

## 1. 「一覧に無いコマンド」は全部**存在した**

対照実験（引数なしで叩き、既知の在/不在コマンドの失敗メッセージと照合）：

| 対照 | メッセージ |
|---|---|
| 存在する（`testforblock`） | `構文エラー: "": at "stforblock>><<" は無効です` ← 引数が足りない |
| 存在しない（`zzznotacommandatall`） | `構文エラー: "zzznotacommandatall": at ">>zzznotacommandatall<<" は無効です` ← コマンド名を拒否 |

結果：

| コマンド | 判定 |
|---|---|
| `getchunkdata` | **present** |
| `getchunks` | **present** |
| `gettopsolidblock` | **present** |
| `querytarget` | **present** |
| `agent` | **present** |

**「教育版に存在しない」という私の断定は完全に誤りだった。** 依頼者の指摘（権限で一覧に出ない／
隠しコマンドがある）が正しい。一括読み取りの経路は**生きている**。

## 2. `testforblock` の `statusMessage` は**日本語化され、ブロック名まで翻訳される**

```
見つかった : ブロックは 2, -59, 2 で見つかりました。
見つからない: 2,-59,2 にあるブロックは ダイヤモンドブロック です (予想では 石)。
```

- sanand0 の正規表現 `/is (.*?) \(expected:/` は **マッチしない**（実測 `false`）
- ブロック名が `ダイヤモンドブロック` — **`diamond_block` ではない**

**`statusMessage` のパースはローカライズ環境では成立しない。** 以前「testforblock はブロック名を返す」と
訂正したが、それは英語クライアントの話であって、ここでは使えない。

## 3. 代わりに `execute if block` が使える（散文を返さない）

```
一致  : statusCode 0、statusMessage なし
不一致: statusCode -2147352576、"サブコマンド if block テストの実行に失敗しました。"
```

**判定は statusCode だけで付く**（`execute_if_block_discriminates: true`）。翻訳に影響されない。
コスト は「候補ブロック1つにつき1コマンド」。

## 4. その他の実測値

| 項目 | 結果 |
|---|---|
| `fill` 体積上限 | **32768（確定）** `32768 個のブロックで満たしました` / `多すぎます (33792 > 32768)` |
| キャレット `^` | **受理** `setblock ^ ^ ^5` → `ブロックが設置される` |
| `structure save` | **成功** `ストラクチャーを mystructure:probe_readback という名前で保存しました` |
| `testforblocks` | **成功** `9 個のブロックを比較しました` |
| 生成コマンド17本 | **構文エラーは1本のみ**（`myaddon:reactor` = 存在しないアドオン。正しい拒否） |

## 5. ★重要：`statusCode < 0` は「拒否」を意味しない

コーパス再生で「拒否」に見えた8本の内訳：

| メッセージ | 実際の意味 |
|---|---|
| `0 個のブロックで満たしました` | **成功。置換対象が0個だっただけ** |
| `そのブロックは設置できません` | **既に同じブロックがある**（`setblock` を2回続けると2回目がこれ） |
| `ワールドの範囲外に…` | 座標が範囲外（治具側の座標変換ミス） |
| `構文エラー: "myaddon:reactor"` | 唯一の真の構文エラー |

**負のステータスコードを一律にエラー扱いすると、成功した fill を失敗と報告する。**
ツール層は `statusCode` だけで判断してはいけない。これは新設計への直接の制約。

また **`setblock` は冪等でない**：同じブロックを同じ場所に2回置くと2回目は負のコードを返す。
「既にそうなっている」を成功として扱う必要がある。
