---
name: geometry-comparison
description: （メモ）Mming-Lab/makecode-minecraft-geometry-ext と MCPサーバの幾何計算の比較。geometry-ext の方が正しい実装が多く、ゴールデンテストの基準線を見直す必要がある。
---

# 幾何計算の2実装比較（2026-08-24）

依頼者から指摘された `https://github.com/Mming-Lab/makecode-minecraft-geometry-ext` を実際にクローンして
MCPサーバの `src/utils/geometry/` と突き合わせた結果。

## リポジトリの素性（実測）
| 項目 | 値 |
|---|---|
| `Mming-Lab/makecode-minecraft-geometry-ext` | ★0 / **2025-10-23** push / TypeScript / **ライセンス表記なし** |
| 説明 | 「MakeCode Minecraft拡張機能 - 最適化された11種類の3D図形生成」 |
| 規模 | `src/coordinates.ts` 1,195行 + `src/shapesExt.ts` 331行 |
| 対象MCPサーバ | 2026-02-14 push（**geometry-ext より新しい**） |

**同じ11種類の図形を扱う並行実装。** MCPサーバの方が後発だが、**幾何計算の質は geometry-ext の方が高い。**

---

## ★最重要: トーラスはアルゴリズムが根本的に違う

| | MCPサーバ `torus-calculator.ts` | geometry-ext `getTorusPositions` |
|---|---|---|
| 走査方法 | **角度を回す**。`majorAngle = 2πi/majorSteps` × `minorAngle = 2πj/minorSteps` で点を計算して push（`:28-47`） | **ボクセルグリッドを回す**。`for x → for z → for y` で各座標の所属を判定（`:387-420`） |
| 重複 | **構造的に発生する。** 角度解像度がボクセル解像度を超えると複数の角度が同一ボクセルに落ちる。実測 (8,3) で **1152点中272点重複（23.6%）**。`removeDuplicatePositions` も通していない | **構造的に発生しない。** 各 (x,y,z) を1回だけ訪問する |
| 中空判定 | `Math.abs(Math.cos(minorAngle)) > 0.6`（`:46`）← **幾何学的に恣意的な角度ヒューリスティック**。「殻」を表していない | `tubeDistanceSquared >= innerMinorRadiusSquared`（`:409`）← **実際の殻判定** |

**これはバグ修正の差ではなく設計の差。** 新実装は**ボクセルグリッド走査を採用すべき**。
閉曲面（球・楕円体・トーラス・円柱・放物面・双曲面）はすべてこの方式で書ける。

---

## バグ対応状況（MCPサーバで実測された9件に対して）

| ID | MCPサーバの症状 | geometry-ext |
|---|---|---|
| **B1** 非整数半径→非整数座標（`{"x":-1.5}`） | `sphere-calculator.ts:22-24` | **構造的に不可能。** `centerX = normalizeCoordinate(...)` + `radiusInt = Math.max(1, Math.round(Math.abs(radius)))` で整数格子を回す |
| **B2** 奇数heightで `y=61.5` | `hyperboloid-calculator.ts:29` | **同様に解消**（`Math.round(height)` + 整数ループ） |
| **B3** 放物面 `steps=1` で `0/0=NaN` → 無音の空配列 | `paraboloid-calculator.ts:27` | **同種の欠陥が残る。** `focalLength = radiusSquared / (4 * heightInt)` は `heightInt=0` で Infinity → `4*Inf*0 = NaN` → `Math.floor(NaN)=NaN` → 内側ループが回らず空。**トリガが違うだけ**（steps=1 → height=0） |
| **B5** トーラス重複23.6% | `torus-calculator.ts` | **構造的に解消**（上記） |
| **B6** `factorial(171)=Infinity` → `bernsteinBasis` が NaN | `coordinate-utils.ts:322-331` | **解消。** `binomialCoeff` は階乗を作らず乗除を交互に行う反復計算：`result = result * (n - i) / (i + 1)`。オーバーフローしない |
| **B7** 負の半径で無音の空配列 | 同上 | **改善。** `if (radius <= 0) return []` と明示的な早期リターン + `Math.abs(radius)`。ただし戻り値は依然 空配列（例外を投げない） |
| **B9** 中空の球(半径1)が中心を含む | `sphere-calculator.ts:36` | **同じ挙動。** `shouldPlaceBlock(0, 1, true)` → `0 <= 1 && 0 >= max(0,0)` → true。&lt;br&gt;※ただし半径1の中空球は退化ケースであり、「バグ」と断定するのは行き過ぎ。**新実装で挙動を定義すべき論点** |
| **B4 / B8 / B10** | 0除算、radius=0、center の意味の非一貫性 | 未精査。geometry-ext は `Math.max(1, ...)` で下限を設ける傾向があり、同種の問題は減っている見込み（**未確認**） |

---

## geometry-ext が持っていて MCPサーバに無いもの

| 機能 | 内容 |
|---|---|
| **`WORLD_BOUNDS` の実効的な強制** | `X/Z: ±30,000,000`、`Y: -64..320`。`normalizeCoordinate()` が clamp し、`validateCoordinates()` が判定、`safeWorld()` が両方を適用。&lt;br&gt;→ 品質担当が「不変条件 I4（座標が WORLD_BOUNDS 内）は未検証」とした項目が、こちらでは構造化されている |
| **`shouldPlaceBlock(distance, radius, hollow)` の集約** | 中空判定が1箇所。MCPサーバは各 calculator にインライン展開されており、トーラスだけ角度ヒューリスティックという不整合を生んでいる |
| **`getConePositions`** | 円錐。MCPサーバに存在しない。**教育ドメイン担当が新設を提案した `build.revolution`（回転体）に直結** |
| **`optimizedFill` のグリッドマップ方式** | `getUniqueCoordinates` → `createIndexMap` → `createGridMap` → 直方体分割。MCPサーバの `block-optimizer.ts` と比較する価値がある |

---

## geometry-ext から**持ち込んではいけない**もの

| 問題 | 理由 |
|---|---|
| **`player.say(getProgressMessage(...))` が座標計算ループの中にある** | 計算関数が純関数でない。ゴールデンテスト不能、MCPサーバでは意味を持たない。**MakeCode 固有の進捗表示** |
| **`passesDensitySampling` が `Math.random()` を使う** | `getSpherePositions(center, radius, hollow, density)` の `density < 1.0` は**非決定的**。&lt;br&gt;→ **ゴールデンテストでは density を 1.0 に固定しないと再現しない。必ず固定すること** |
| **`MATH_CONSTANTS.PI = 3.14159`** | 低精度のハードコード。**MCPサーバは `Math.PI` を使っており、この点は MCPサーバの方が正しい。** 三角関数を使う箇所（螺旋・円）で誤差が出る |
| `Position` / `world()` / `Axis` / `//% block=` 注釈 | MakeCode（Static TypeScript）の API と宣言。MCPサーバは素の `{x,y,z}` を使う |
| 日本語のメッセージ定数 | MakeCode のゲーム内表示用 |

---

## ゴールデンテスト計画への影響（重要）

**当初の計画「MCPサーバの既存実装から期待値を吸い出して基準線にする」は、そのままでは不適切。**

MCPサーバの幾何計算は geometry-ext より後発だが**質が低い**。両者が食い違う箇所では
**geometry-ext が正しい方であることが多い**。MCPサーバ単独を基準にすると、劣った実装を固定してしまう。

### 修正した方針
1. **両方から期待値を抽出する**
   - MCPサーバ: `tools/golden-extract/` で `tsc` 経由（依存ゼロなので容易。実証済み）
   - geometry-ext: MakeCode API（`Position` / `world()` / `player.say`）のスタブを書けば同様に抽出可能
2. **食い違った箇所は自動で `equivalent` にしない。** `verdict` の判定対象に上げる
   - 一致 → `equivalent`
   - 食い違い + geometry-ext が正しい → `spec-change`（新実装は geometry-ext 側に合わせる）
   - 食い違い + 両方おかしい → `bug-fixed`（どちらとも一致してはいけない）
3. **`density` パラメータは 1.0 固定**（`Math.random()` を踏まないため）
4. **`player.say` はスタブで no-op にする**

### 新実装が採用すべき設計（この比較から導かれる結論）
| 採用元 | 内容 |
|---|---|
| geometry-ext | **ボクセルグリッド走査**（角度走査をやめる）→ 重複が構造的に発生しない |
| geometry-ext | **反復計算の `binomialCoeff`**（階乗を作らない）→ オーバーフローしない |
| geometry-ext | **`normalizeCoordinate` / `validateCoordinates` / `WORLD_BOUNDS` の強制** |
| geometry-ext | **`shouldPlaceBlock` の集約**（中空判定を1箇所に） |
| geometry-ext | `getConePositions` の存在（→ `build.revolution` の素材） |
| **MCPサーバ** | **`Math.PI`**（geometry-ext の `3.14159` は使わない） |
| どちらでもない | **純関数化**（`player.say` を除去）、**決定論化**（`Math.random()` を除去、density は明示的なサンプリング関数を注入する形に） |

---

## 付随する指摘
`makecode-minecraft-geometry-ext` は**ライセンス表記がない**。依頼者自身のリポジトリなので再利用に問題はないが、
新実装を MIT で公開する際に「ここからアルゴリズムを持ってきた」という経緯を明確にするなら、
geometry-ext 側にもライセンスを置いた方が後々の説明が楽になる。

---

# 実測による裏取り（2026-08-24）

推測でなく、**両実装を同じ形状で実際に走らせて**比較した。ツールは `tools/geometry-compare/`、
結果は `tests/golden/COMPARISON.md`（自動生成）。対象は geometry-ext の公開版 `ad23f27`。

## 結果: 37ケース

| 区分 | 件数 | 意味 |
|---|---|---|
| **完全一致（overlap 1.00）** | **26** | sphere / ellipsoid / cylinder / line / helix はすべて一致 |
| **MCPのみ違反** | **8** | → **geometry-ext に従う** |
| **extのみ違反** | **3** | → **MCPに従う** |
| 両方違反 | **0** | 安全な基準線が無いケースは存在しない |

### MCPのみが違反する8件
| ケース | 違反 |
|---|---|
| `sphere/r2.5-non-integer` | I1: 非整数座標 56点（extは123点でクリーン） |
| `torus/R8-r3` 他 全6件 | I2: 重複 284 / 180 / 111 / 83 / 34 / 18 |
| `hyperboloid/r6-w0.4-h11` | I1: **651点すべてが非整数** |

### extのみが違反する3件（すべて `circle/*-hollow`）
| ケース | 違反 | 私の修正後 |
|---|---|---|
| `circle/r3-hollow` | I2: 4 | **12/12 クリーン** |
| `circle/r5-hollow` | I2: 8 | **24/24 クリーン** |
| `circle/r10-hollow` | I2: 4 | **52/52 クリーン** |

**`design/patches/geoext-fixes.patch` を当てた checkout で再実行すると ext の違反は 0件になる**（別ツールからの独立確認）。

## 一致率が低いが「どちらも正しい」ケース（新実装で仕様を決める必要がある）

| ケース | overlap | 内容 |
|---|---|---|
| `circle/*-hollow` | 0.36〜0.60 | **「中空の円」の定義が違う。** MCPは中実円から内側を引いた**円環**（r=5で36点）、extは**中点円の輪郭**（24点）。どちらも妥当な解釈 |
| `paraboloid/*` | 0.85〜0.92 | 数式が違う。どちらも不変条件はクリーン |
| `hyperboloid/*` | 0.18〜0.19 | パラメータの意味が根本的に違う（下記） |

## ★双曲面のパラメータが両方とも名前どおりでない

| | 引数 | 実際の意味 |
|---|---|---|
| **MCP** | `(center, radius, height, waist=0.5, hollow)` | `waist` は**比率**。`r(t) = radius * sqrt(waist² + t²)`&lt;br&gt;→ くびれ半径 = `radius*waist`、端の半径 = `radius*sqrt(waist²+1)`&lt;br&gt;→ **`radius` はくびれでも最大でもない** |
| **ext（修正前）** | `(center, baseRadius, waistRadius, height, hollow)` | 両方**絶対値**だが、`b = base - waist` の置き方で端の半径が `sqrt(waist² + (base-waist)²)` になり **`baseRadius` と一致しない** |
| **ext（修正後）** | 同上 | `b = sqrt(base² - waist²)` に修正。**端の半径が `baseRadius` と一致する** |

**新実装では絶対値のパラメータにし、名前どおりの半径を返すこと。** 比較ツールはこの変換を明示している。

## 新実装が採用すべき設計（実測に基づく最終版）

| 採用元 | 内容 | 根拠 |
|---|---|---|
| **geometry-ext** | **トーラスのボクセルグリッド走査** | MCPの角度走査は重複を構造的に生む（最大23.6%） |
| **geometry-ext** | **半径・中心の整数化**（`Math.round`） | MCPは非整数半径・奇数高さで非整数座標を出す |
| **geometry-ext** | **反復 `binomialCoeff`** | MCPの `factorial` は n=171 で Infinity → NaN |
| **geometry-ext（修正後）** | **双曲面の絶対値パラメータ** | 両実装とも名前と挙動が乖離していた |
| **MCP** | **`Math.PI`** | extの `3.14159` は不正確（実害はないが直す理由がある） |
| **MCP（修正後のextと同等）** | **中点円の正しい誤差更新** | ext公開版は x を1ステップ早く減らす |
| **MCP** | **`block-optimizer.ts`** | 「箱の和集合 == 入力集合」を全ケースで満たす優良部品 |
| **どちらでもない** | **純関数化**（`player.say` 除去）、**決定論化**（`Math.random()` の density を注入可能に） | extはゲーム内表示とランダムサンプリングを計算に混ぜている |
| **どちらでもない** | **共通ユーティリティを実際に通す** | MCPは `coordinate-utils.ts` に用意しているのに `removeDuplicatePositions` を bezier しか使っていない |
