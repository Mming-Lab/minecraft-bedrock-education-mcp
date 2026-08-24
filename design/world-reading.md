---
title: AIにワールドを見せる方法（決定）
date: 2026-08-24
status: 実機測定により決定
---

# 結論

**第一選択：`structure save` → ワールドDB読み出し。** 正確なブロック名・ブロック状態・
ワールド座標が、約2〜7秒で取れる。往復コストはゼロ（コマンド1本 + ファイル読み）。

**ただしサーバとゲームが同一マシンにある場合に限る。** 教育版はiPadやChromebookでも動くので、
その場合はコマンド経由にフォールバックする。両方を実装する必要がある。

| 経路 | 得られるもの | 遅延 | 範囲 | 前提 |
|---|---|---|---|---|
| **`structure save` + DB** | **正確なブロック名＋状態＋座標** | **約2〜7秒** | 1辺64ブロック／回（複数回で拡張可） | 同一マシン |
| DB直読み（保存待ち） | 同上、チャンク単位 | **約25秒** | 無制限 | 同一マシン |
| `getchunkdata` | 256列の高さ（正確）＋表面色（陰影込み） | 即座 | 16×16列／コマンド | なし |
| `gettopsolidblock` | 正確なブロック名（翻訳なし） | 即座 | 1列 | なし |
| `execute if block` | 指定座標の一致判定 | 即座（100並列で8ms/本） | 1座標 | なし |

`testforblock` は使わない（日本語クライアントで `statusMessage` もブロック名も翻訳される）。

---

## 1. `structure save` + DB読み出し（本命）

```
/structure save <name> <from> <to> disk
  → "ストラクチャーを mystructure:<name> という名前で保存しました"
```

ワールドDBに `structuretemplate_mystructure:<name>` というキーで書かれる。
**ファイルは作られない**（`.mcstructure` はワールドフォルダのどこにも無い）。

デコード結果（`tools/live-probe/dbstructure.mjs`）：

```
### structuretemplate_mystructure:zzf_215417_1  (562 bytes)
  size: [3,1,3]
  world origin: [0,-57,-3]
  palette: diamond_block, air, gold_block, emerald_block, redstone_block
    +0,0,0  minecraft:diamond_block
    +1,0,1  minecraft:gold_block
    +2,0,1  minecraft:redstone_block
```

- リトルエンディアンNBT、非圧縮
- `block_indices` は2層（2層目は水没レイヤー、未使用は -1）
- インデックス順は **x → y → z**（サブチャンクとは違う）
- `structure_world_origin` があるのでワールド座標に戻せる

### ★書き込みは強制される（3回測定）

| 保存 | DB到達までの遅延 |
|---|---|
| 1回目 | **2.1秒** |
| 2回目 | **6.6秒** |
| 3回目 | **5.2秒** |

保存間隔は16〜21秒あけた。**30秒周期の自動セーブなら少なくとも1回は20秒超になるはずで、ならなかった。**
つまり `structure save` 自体が書き込みを起こしている。

対して**ブロックを置いただけでは25.4秒**かかった（`setblock` → DB到達、1回測定）。
この差が本命たる理由。自分の操作結果を確認したいなら `structure save` を挟む。

### 制限

- **1辺64ブロック**（Bedrockの `/structure` の制限）。広域は複数回に分ける
- 保存のたびにDBキーが増える。`/structure delete` で消せる

---

## 2. DB直読み（チャンク単位）

`tools/live-probe/dbchunk.mjs` で **41サブチャンクをデコード、失敗0**。

```
102350  minecraft:air
 32805  minecraft:stone
 16392  minecraft:dirt
  8192  minecraft:bedrock
  8184  minecraft:grass_block
      4  minecraft:gold_block      ← 治具が置いたマーカー
```

サブチャンク（キーtag 47）の形式：

```
u8   version         8、または9（9はY indexを自身が持つ）
u8   storage count   通常1、水没があると2
u8   y index         version 9のみ
  ─ storage ごと ─
u8       (bitsPerBlock << 1) | isRuntime
u32[]    ブロックインデックス。LSB側から詰め、1個が32bit境界をまたがない
i32 LE   パレット長
NBT      その数だけリトルエンディアンcompound {name, states, version}
```

インデックス順は **x → z → y**（多くの人が想像する順とは逆）。

**ゲーム実行中でも読める。** ただしDBは排他ロックされているので、
`FileShare.ReadWrite` でコピーしてから開く（スナップショット約60ms、このワールドで107KiB）。

遅延は**約25秒**（自動セーブ待ち）。広域の下見には十分、操作結果の確認には遅すぎる。

---

## 3. コマンド経由（別マシンの場合のフォールバック）

### `getchunkdata <dimension> <chunkX> <chunkZ> <height>`

「与えたyより下で最初に見つかるブロック」を16×16=256列ぶん返す。

```
"S6J9wg*118,Qs3Xww,AAD/ww,0*14,PoRnwg,0*87,cHBwxA,0*13,cHBwyw*3,0*11"
```

- `*N` は「**あとN個**」。合計は必ず256
- **6文字base64** = 新規リテラル → 4バイト。**先頭3バイト=描画色、4バイト目=高さ**
- **`y = バイト値 − 255`**（3点で検証：`c2`→−61、`c7`→−56、`cb`→−52）
- **素の数値** = 辞書インデックス（そのチャンクでリテラルが初出した順、0起点）
- `ff 00 ff` 高さ64 = 「見つからなかった」の番兵値

**色はブロックIDではない。** 同じ草でも影が乗ると `4b a2 7d` → `3e 84 67` と変わる。
**高さは正確、色は目安。**

### `gettopsolidblock <x> <y> <z>`

```json
{"blockName":"grass_block","position":{"x":0,"y":-61,"z":-3},"statusCode":0}
```

構造化されており翻訳されない。`getchunkdata` で当たりを付けた地点の確認に。

### `execute if block <x> <y> <z> <block> [states] run <command>`

一致→`statusCode 0`、不一致→負のコード。**散文を返さないので翻訳に強い。**

| 並列数 | 所要 | 1本あたり | 失敗 |
|---|---|---|---|
| 直列20本 | 2,243ms | 112ms | 0 |
| 100本 | **774ms** | **8ms** | **0** |

100本同時でタイムアウト0・エラー0。以前の調査にあった「100本で `TooManyPendingRequests`」は再現せず。
4,096ブロックの総当たりでも約33秒。

---

## エージェント

**`agent inspect` はソケットにデータを返さない。** socket-be より手前で生フレームを直接捕捉して確認：
受信30本すべて `commandResponse`、**捨てられたフレームはゼロ**。
socket-be 作者の結論は正しかったが、理由は「socket-beが握り潰していた」ではなく
**そもそも `action:agent` フレームが送られてこない**ため。

ただし**コマンドによる**：

| コマンド | 返り値 |
|---|---|
| `agent inspect/detect/inspectdata` | `statusCode` と `statusMessage` のみ |
| **`agent getposition`** | **`{"position":{...},"y-rot":0}`** |

---

## 実装への制約

1. **`statusCode < 0` は「拒否」ではない。** `0 個のブロックで満たしました`（対象0個の成功）、
   `そのブロックは設置できません`（既に同じブロック）はどちらも負のコード
2. **`setblock` は冪等でない。** 同じブロックを2回置くと2回目が負のコードを返す
3. **DBはコピーしてから開く。** 原本はロックされている
