---
name: golden-extraction-result
description: （メモ）ゴールデンテスト抽出の完了報告。68ケース抽出済み、検証ランナー付き、自己テスト済み。移行計画の第1段階が完了。
---

# ゴールデンテスト抽出 完了（2026-08-24）

移行計画の**第1段階「検証手段の確立」が完了**。新実装を測る物差しができた。
実機Minecraftは不要。

## 成果物

| パス | 内容 |
|---|---|
| `tools/golden-extract/` | 抽出・検証ツール一式（`build` / `cases` / `extract` / `validate` / `verdicts`） |
| `tests/golden/` | **68ケース + optimizer被覆 = 69 JSONファイル** |
| `tests/golden/REPORT.md` | 抽出レポート（自動生成） |

```bash
cd tools/golden-extract
npm install
npm run extract          # tests/golden/ を再生成
npm run validate:legacy  # 自己テスト。49 passed / 17 failed になるのが正しい
```

## 判定の内訳

| verdict | 件数 | 新実装への要求 |
|---|---|---|
| `equivalent` | **49** | レガシー出力を完全に再現すること |
| `bug-fixed` | **10** | **再現してはいけない**。指定された不変条件を満たすこと |
| `undefined-behavior` | **7** | 無音で空配列を返さず、例外を投げること |
| `spec-change` | **2** | 期待値を人間が書き下ろす |
| `unreviewed` | **0** | — |

**`unreviewed` がゼロ**。不変条件に違反した9件すべてに、根拠付きの判定を `verdicts.json` に記録した。

## 設計の要点：`bug-fixed` の反転判定

素朴なゴールデンテストは「新実装が旧実装と一致すること」を要求する。本件でそれをやると
**既知の欠陥10件を新実装に固定してしまう**。

そこで `bug-fixed` は**一致したら失敗**にした。自己テストの出力がそのまま証拠になる:

```
[FAIL] torus/R8-r3 (B5)
       reproduces the legacy output exactly, so the defect was carried over;
       I2: 284 duplicated coordinates
```

## 自己テスト（これがスイート自身の検証）

`validate:legacy` はレガシー実装を自分のゴールデンに当てる。**49 passed / 17 failed** が正しい結果で、
失敗するのは `bug-fixed` 10件と `undefined-behavior` 7件ちょうど。

**全部通ってしまったら反転判定が壊れている。** ゴールデンが何も守らなくなった合図。

## 抽出で新たに判明したこと

### 1. 共通ユーティリティが存在するのに使われていない（構造的な根本原因）
`src/utils/geometry/coordinate-utils.ts`（311行）は共通化を用意している。実際の使用状況:

| ユーティリティ | 使っている calculator |
|---|---|
| `removeDuplicatePositions` | **bezier のみ**（10個中1個） |
| `shouldPlaceBlock` | **ゼロ** |
| `normalizeCoordinate` | **ゼロ** |
| `validateCoordinates` | **ゼロ** |
| `roundPosition` | **ゼロ** |

各 calculator が中空判定・丸め・重複除去を個別に再実装（あるいは省略）している。
**これがバグ群の構造的な原因。** 新実装では共通化を実際に通すこと。

※ 前任エージェントの「helix は `removeDuplicatePositions` を通しているがトーラスは通していない」
という報告は**誤り**。実際は bezier のみ。

### 2. `block-optimizer.ts` は完全に正しい（移植すべき優良部品）
「箱の和集合 == 入力集合」という強い不変条件を全ケースで満たす:

| ケース | 入力 | 箱 | 被覆 | 欠落 | 余分 | 重複 |
|---|---|---|---|---|---|---|
| 4x4x4 中実 | 64 | **1** | 64 | 0 | 0 | 0 |
| 球 r=5 | 515 | **43** | 515 | 0 | 0 | 0 |
| 中空球 r=5 | 264 | **83** | 264 | 0 | 0 | 0 |
| 直線 | 11 | 7 | 11 | 0 | 0 | 0 |

圧縮も効いている（64ブロック→1箱）。**新実装でも使える。**

### 3. `sphere/r0` は空配列ではなく1点を返す
半径0の球が中心1点を返す。「空を返す」と想定していたが実際は違った。
`undefined-behavior` 判定なので新実装では例外を投げるべき。

## 実装上の判断

- **`build.mjs` は既知エラー3件のみを受理する。** `tsc` は `locale-manager.ts` の `process` 未定義で
  非ゼロ終了するが emit は通る。それ以外のエラーが出たら**レガシーソースが変わった合図**なので停止する。
  `|| true` で握り潰すと、別のコードベースの出力を静かに記録してしまう
- **ケース定義を `cases.mjs` に共有化。** 抽出側と検証側で二重定義すると乖離し、比較が骨抜きになる
- **判定を `verdicts.json` に分離。** 再抽出しても人間の判断が失われない
- **重複と非整数座標は正規化せず記録する。** レガシーがそれを出すかどうかが測定対象そのもの
- 2000点超はSHA-256 + bbox + 重心。**ハッシュだけだと「違う」としか言えずデバッグできない**

## 未着手（次の段階）

| 項目 | 備考 |
|---|---|
| geometry-ext からの抽出 | `design/geometry-comparison.md` の方針。**両実装が食い違う箇所は geometry-ext が正しいことが多い**ので、片方だけを基準にしない |
| `inputSchema` のダンプ | 現行20ツールのスキーマをベースライン化。socket-be 未インストールなので **AST抽出**が必要な可能性 |
| コマンド文字列生成のゴールデン | 新実装で純関数に切り出してから |
| プロパティテスト（fast-check） | 固定ケースに加えてランダム入力で不変条件を叩く |
