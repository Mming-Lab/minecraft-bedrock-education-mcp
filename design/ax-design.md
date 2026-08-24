---
name: ax-design
description: （メモ）AX（Agent Experience）設計。AIがツール群を正しく使えるようにする設計。A案確定・セキュリティ要件削減後の版。
---

# AX設計 — AIがこのツール群を正しく使うための設計

前提: D-1（A案確定）、D-6（1ツール1機能）、D-12（セキュリティ要件はほぼ全廃）。
**この設計の目的は1つ: 「AIが想像で進めて失敗する」構造を消すこと。**

## 設計原則
1. **説明文でお願いするより、構造で強制する。** description に「事前に確認してください」と書くのは最も弱い手段
2. **1回の失敗も設計の敗北とみなす。** 「LLMが賢ければ回避できる」を許容しない
3. **LLMは推測が得意すぎる。** 曖昧な余地を残すと必ず埋めてくる

---

## 問1 観測手段の見せ方 → 手段を隠し、「何を知りたいか」で3ツールに集約する

### 結論
使える観測手段は複数あるが（`testforblock` 100並列 / `gettopsolidblock` / `getchunkdata`）、
**これらをLLMに見せない。** 実装側が要求の形から自動選択する。

理由:
- **LLMは各手段の性能特性を知らないし、知らせるべきでもない。**
  「1コラムなら gettopsolidblock が速い」「領域なら並列 testforblock」は実装の知識であって、
  ツール選択の判断材料としてLLMに投げると必ず間違える
- A案確定により**能力集合が固定**された。B案を実装しないので `capabilities()` による動的分岐は不要

### 3ツール

| ツール | 用途 | 内部で使う手段 |
|---|---|---|
| `observe.block` | **1点**のブロックを知る | `testforblock` 1コマンド |
| `observe.region` | **領域**の中身を知る | 並列 `testforblock`（+ getchunkdata が使えるなら前段フィルタ） |
| `observe.surface` | **地形の高さ**を知る（建築の起点） | `gettopsolidblock` 縦走査 |

`observe.surface` を独立させる理由: 「地面に沿って建てたい」は最頻の要求であり、
`observe.region` で3次元を読ませてからAIに最上部を探させるのは往復とトークンの無駄。

### 失敗時に次の一手が一意に決まるエラー設計

| 状況 | 返すもの |
|---|---|
| 未ロードチャンク | `status: "unloaded"` + 「player.teleport で対象付近に移動してから再試行」 |
| 範囲が上限超過 | `status: "too_large"`, `limit: 32768`, `requested: 262144` + 「32x32x32 以下に分割して呼ぶ」 |
| コマンド失敗・タイムアウト | **`unknown`（`air` にしない）**。`unknownCount: N`, `retryable: true` |

**`unknown` と `air` を型レベルで区別する。** 誤認するとAIが「そこには何もない」と判断して既存建築を上書きする。

---

## 問2 大量データの表現 → パレット + RLE + 種別グループ化。閾値超過は resource_link

### 問題の規模
16の3乗 = 4096ブロック。`typeId` は `minecraft:stone` 形式で15〜30バイト
→ **素朴なJSON配列で60〜120KB。** 実用外。

### 返却スキーマ（`observe.region` の outputSchema）

```jsonc
{
  "origin": [100, 64, 200],          // 領域の最小座標
  "size":   [16, 16, 16],
  "palette": ["air", "stone", "dirt", "grass_block"],   // minecraft: を省略
  "encoding": "rle",                  // rle | grouped | sparse

  // encoding=rle: XZY順のパレットインデックス列を [index, runLength] で連長圧縮
  "data": [[0, 3200], [1, 512], [2, 256], [3, 128]],

  // encoding=grouped: 種別ごとに座標を束ねる（空気は含めない）
  "groups": [
    { "block": "stone", "count": 512, "positions": [[100,64,200]] }
  ],

  // encoding=sparse: 空気以外のみを [x,y,z,paletteIndex] で列挙
  "sparse": [[100,64,200,1]],

  "airCount": 3200,                   // 空気は常に個数だけ返す（座標は返さない）
  "unknownCount": 0,                  // 読み取り失敗。air と区別する
  "truncated": false,
  "cursor": null                      // 続きがあれば不透明な文字列
}
```

### encoding の自動選択（LLMに選ばせない）
```
空気率 > 80%              → sparse   （地上の領域。ほとんどが空気）
ユニークブロック数 <= 8    → rle      （地下・単一素材の構造物）
それ以外                  → grouped  （「何がいくつあるか」の把握に向く）
```
**選択理由を `encoding` フィールドで返すだけにし、LLMには選ばせない。**

### resource_link への切り替え閾値
シリアライズ後 **32KB を超えたら** `resource_link` で返す
（MCP仕様: "A tool MAY return links to Resources"）。
インライン展開でコンテキストを食い潰すより、必要なときだけ取りに来させる。

### 削減効果の見積もり（要実測）
| 手法 | 16の3乗 の想定サイズ |
|---|---|
| 素朴なJSON | 60〜120KB |
| パレット化 | 約 12KB |
| + 空気除外（地上、空気80%） | 約 2.4KB |
| + RLE（単一素材が支配的な領域） | 数百バイト |

---

## 問3 失敗駆動の排除 → 起動時にレジストリを構築し、実行前に検証。候補を同梱

### 現状の構造的欠陥
- wiki への誘導が**失敗後のみ**（`src/utils/error-hints.ts`、発火条件がエラー時）
- **ブロックID/アイテムIDの事前検証がゼロ** — 不正IDはMinecraftまで飛んでエラーで返る
- `error-hints.ts:5` のコメント自身が「AIが自発的に適切なツールを使用するよう促す」と書いているが、
  **発火が失敗後なので「想像で実行 → 失敗 → ヒント → 調べる」を構造的に強制している**

### 設計
```
起動時（接続確立直後）に1回だけ:
  queryData('block') -> BlockQueryResult[] = { aux, id, name }
  queryData('item')  -> ItemQueryResult[]
  -> Map<正規化ID, {id, aux, name}> と、表示名 -> ID の逆引き表を構築
  -> プロセス内にキャッシュ（ワールド接続ごとに再構築）

ツール実行前（スキーマ検証の後、コマンド生成の前）:
  すべての block/item 引数をレジストリと照合
  ヒット -> そのまま実行
  ミス   -> 実行せず、候補を同梱して返す（往復1回で解決させる）
```

### ミス時の返却（「エラー + 候補同梱」）
```
isError: true
content:
  unknown block id: "stonebrick"
  did you mean:
    minecraft:stone_bricks
    minecraft:stone_brick_slab
    minecraft:stone
  retry with one of the above. no need to look anything up.
```
**「調べてください」と言わない。正解候補をその場で渡す。**
候補生成は編集距離（Levenshtein）+ 部分文字列一致。

MCP仕様の裏付け: Tool Execution Errors は
"actionable feedback that language models can use to self-correct and retry with adjusted parameters"
と定義され、クライアントは
"SHOULD provide tool execution errors to language models to enable self-correction"。
つまり候補同梱は仕様の意図に沿っている。

### `error-hints.ts` → 廃止
事前検証が主経路になれば、失敗後のヒントは不要。残す価値のある機能はない。

### `minecraft_wiki` ツール（555行）→ 削除
- 存在理由は「不正ブロックIDのAI自己修正」（READMEに明記）
- **`queryData('block')` で実機の一次情報が手元に来るので、二次情報のwikiを引く理由が消える**
- 加えて: 学校ネットワークからの外部HTTPが制限に当たる可能性、
  MCPクライアント側が既にWeb検索を持つ、555行の保守負債

---

## 問4 `sequence` ツール → 廃止（各ツールの `sequence` action も全廃）

### 理由
1. **観測が可能になったので「実行 → 観測 → 判断」のループが組める。**
   `sequence` は「LLMが自分でループできない」時代の設計
2. **MCPのスキーマ検証をバイパスしている。** `steps` に `items` がないため
   `schema-converter.ts:114-120` で `z.array(z.any())` になり、中身が一切検証されない。
   `executeSequenceStep` は `this.execute()` を直接呼ぶので MCP の parse を通らない
   → `{ type: "move", distance: 1000000 }` で100万回ループ
   （`agent.ts:109-112`、`distance` の 1〜10 制約は無効）
3. **description が存在しないアクション名を並べている**（`sequence.ts:17`）。
   player の teleport/move/say、camera の shot/video は実装に存在しない
   → **LLMは必ず無効なステップを作る**
4. 途中結果を見て分岐できない。`on_error` の3値だけが静的な方針
5. `sequence.ts:137-143` が固定スリープで同期（ゲーム状態を確認していない）
6. **全ツールに個別の `sequence` action が重複実装されており二重構造**

### 原子性が必要な操作はどうするか
汎用シーケンサではなく**専用ツールで表現する**。
例: 複数座標への一括配置は `blocks.set_many({ positions: [{pos, block}] })` として
**スキーマ検証が効いたまま**バッチする。既に building 系ツールはこの形（1呼び出しで大量ブロック）。

---

## 問5 ツールの粒度 → 1ツール1機能・ドット区切り階層（D-6と一致）

### LLMから見た理由（仕様観点はD-6に記載）
- 現行は `action` 文字列で内部分岐。**「どのツールか」を選んだ後に「どのactionか」を選ぶ2段の判断**が要る。
  しかも action ごとに必要なパラメータが違うのに、スキーマは全actionの和集合になる
  → **LLMは「このactionにこのパラメータが要るか」を推測するしかない**
- 1ツール1機能なら **required が正確に書ける**。推測の余地が消える
- ドット区切りで階層を表現すれば、ツール数が増えても命名で見通せる

### 命名（例）
```
observe.block / observe.region / observe.surface / observe.players
blocks.set / blocks.fill / blocks.set_many
build.cube / build.line / build.sphere / build.cylinder / build.helix / build.revolution
agent.move / agent.turn / agent.inspect / agent.place / agent.collect
player.teleport / player.get_location / player.give_item / player.set_gamemode
world.get_time / world.set_time / world.set_weather / world.send_message / world.run_command
scoreboard.* / display.*
```
78個まで増やす必要はない。**教育ドメイン判定後の機能セット
（core 7 + building 7 + observe 6 程度）を1機能1ツールに展開した数**が適正。

---

## 問6 ツール説明文の設計指針

### 原則: 「何ができるか」ではなく「いつ使い、いつ使わないか」を書く

### 悪い例（現行 `agent.ts:11`）
```
Agent automation: move/turn/teleport agent, mine/place blocks, inventory management,
item collection/dropping, block inspection. Perfect for automated building, ...
```
能力の羅列。**いつ使わないべきかが書かれていない**ので、LLMは全部これで済ませようとする。

### 文面案

`observe.surface`
```
Get the ground height and top block for each column in an X/Z area.
USE THIS FIRST before building anything on terrain - placing blocks at absolute
Y coordinates on uneven ground will bury or float your structure.
Do NOT use this to inspect the inside of a structure or a cave; it only reports
the topmost solid block per column. Use observe.region for that.
```

`observe.region`
```
Read every block in a box-shaped region. Air is reported as a count only, never
as coordinates. Returns a palette plus a compressed encoding, not a flat list.
Use this to inspect what a player built, to check a structure before modifying it,
or to count materials.
Do NOT use this to find the ground height - observe.surface is far cheaper for that.
Do NOT request more than 32x32x32 in one call; split the region and call again.
```

`observe.block`
```
Read the single block at one coordinate.
Use this to confirm one specific position. For anything larger than a few blocks,
use observe.region instead - it batches the reads and is much faster.
```

`blocks.fill`
```
Fill a box-shaped region with one block type.
Read the area with observe.region first if you are replacing something a player
built - this overwrites without warning and cannot be undone.
Volume limit is 32768 blocks per call.
```

### 共通ルール
- **「いつ使わないか」を1文以上書く**
- 代替ツールを名前で挙げる（`use observe.surface instead`）
- 上限は description にも書く（スキーマの `maximum` だけに頼らない）
- **「事前に確認してください」とお願いする文は書かない。** 事前検証（問3）で構造的に強制する
