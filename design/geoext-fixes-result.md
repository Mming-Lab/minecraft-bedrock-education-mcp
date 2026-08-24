---
name: geoext-fixes-result
description: （メモ）makecode-minecraft-geometry-ext のバグ修正完了報告。7件修正、パッチは design/patches/geoext-fixes.patch。検証ハーネス同梱。
---

# makecode-minecraft-geometry-ext バグ修正（2026-08-24）

パッチ: `design/patches/geoext-fixes.patch`（904行）
内訳: `src/coordinates.ts` を49行追加/26行削除 + 検証ハーネス `harness/` 一式（新規）

## 検証方法
推測で直さず、**実際に走らせて検出 → 修正 → 再実行で確認**した。

MakeCode API（`Position` / `world()` / `pos()` / `player.say` / `Axis` / `blocks` / `loops`）のスタブを書き、
`src/coordinates.ts` を `tsc --outFile` で結合して Node で実行できるようにした。

```
harness/stubs.ts            MakeCode API のスタブ（player.say は no-op）
harness/run.ts              検出ハーネス。3パス構成
harness/apply-fixes.mjs     修正1〜5の適用スクリプト（アンカーが1回だけ一致することを検証）
harness/apply-fixes2.mjs    修正6〜7の適用スクリプト
harness/probe.ts            個別調査用
```

実行:
```bash
npx -p typescript@5.9.3 tsc -p harness && node harness/built/all.js
```

## 検出結果（修正前 → 修正後）

| パス | 内容 | 修正前 | 修正後 |
|---|---|---|---|
| 1 | 基本ケース78件（NaN / 非整数 / 範囲外 / 重複 / 空 / 中空⊆中実 / 平行移動不変性） | **4違反** | **0違反** |
| 2 | 退化入力（0除算・次元1・境界） | **10違反** | **0違反** |
| 3 | 形状アサーション26件（修正が正しい形を生むか） | — | **26/26 成功** |

**MCPサーバ側と違い、NaN座標・非整数座標・範囲外・中空の非包含・平行移動不変性の違反は最初からゼロだった。**
geometry-ext の基本設計（整数格子を走査する）は健全。

## 修正した7件

### A. 中空円が全半径で重複を出していた
`getCirclePositions` の中点円アルゴリズムが8方向の対称点を**無条件に push** していた。
軸上（`y === 0`）と対角線上（`x === y`）では反射像が元の点と重なるため重複する。

| 半径 | 重複 |
|---|---|
| r=1 | 4/8（50.0%） |
| r=2 | 8/16（50.0%） |
| r=3 | 4/16（25.0%） |
| r=4 | 8/24（33.3%） |
| r=5 | 8/32（25.0%） |
| r=10 | 4/56（7.1%） |

→ 反射像が元と一致する場合を条件で除外。**点の集合は変えず、重複だけを落とす**（4回対称性で検証済み）。

### B. 中点円が x を1ステップ早く減らしていた
`if (err <= 0) { y += 1; err += 2*y+1; }` と `if (err > 0) { x -= 1; err -= 2*x+1; }` の
**2つの独立した if** が、誤差の更新前後で二度判定するため x が早く減る。

r=10 で `(8,4)` が出る。中心からの距離は **8.944** で、半径10のリングから**1.06ブロック内側**。
正しくは `(9,4)`（距離9.849）。

→ 教科書形（y を進め、誤差を更新してから x を判定）に置換。

**注意**: 元のコードには「MakeCodeコア互換」というコメントがある。MakeCode 本体の円と同じ形を
維持することが優先なら、この修正は戻す判断もありうる。ただし**半径から1ブロック以上ずれた点が出るのは
幾何学的に誤り**なので、修正を推奨する。

### C. 双曲面が `waist=0` で空配列を返していた
`r(t) = a * sqrt(1 + (t*b/a)²)` は `a = 0` で `0 * Infinity = NaN`。
ループ境界が NaN になり、**エラーも出さず空配列**を返す。

→ `r(t) = sqrt(a² + (t*b)²)` に置換。**a > 0 では代数的に完全に等価**で、`a = 0` でも定義され
二重円錐に退化する。除算そのものが消える。

### D. 双曲面が `height=1` で空配列を返していた
`halfHeight = Math.floor(1/2) = 0` → `t = (0-0)/0 = NaN`。

→ 除数を `halfHeight > 0 ? halfHeight : 1` に。単層は `t = 0`、すなわちくびれ位置に置かれる。

### E. 放物面が `height=0` で空配列を返していた
`focalLength = radiusSquared / (4 * 0)` = Infinity → `4 * Infinity * 0` = NaN。

→ `heightInt < 1` で明示的に空を返すガードを追加（球の `radius <= 0 → []` と同じ規約）。
併せて `focalLength` を代入で消し、`currentRadiusSquared = (radiusSquared * y) / heightInt` に。
**中間値として Infinity を作らない。**

### F. `baseRadius` が名前どおりに効いていなかった（挙動が変わる修正）
`b = baseRadius - waistRadius` という置き方だと、端（t = ±1）の半径は
`sqrt(waist² + (base-waist)²)` になり、`baseRadius` と一致しない。

`base=6, waist=3, height=11` の層ごとの最大半径:
```
修正前:  4, 4, 3, 3, 3, 3, 3, 3, 3, 4, 4     ← ほぼ円柱。base=6 を指定したのに最大4
修正後:  6, 5, 4, 4, 3, 3, 3, 4, 4, 5, 6     ← 正しい砂時計型
```

→ `sqrt(a² + b²) = baseRadius` を b について解き、`b = sqrt(base² - waist²)`。
`base <= waist` はこの式で表せない形状（樽型）なので `b = 0`（円柱）に落とす。

**これは既存の挙動を変える唯一の修正。** 修正C（数式の書き換え）は等価変換なので形は変わらないが、
こちらは意図的に変える。`baseRadius` パラメータが機能していなかったため。
既にこの拡張で作った建造物があれば、双曲面だけ形が変わる。

### G. 低精度の PI
`MATH_CONSTANTS.PI = 3.14159` → `Math.PI`。

**これはバグではない。** 誤差は文書化された最大半径200でも約0.004ブロック相当で、丸めで消える。
出力は変わらないが、正確な値を使わない理由もないため修正した。

## 併せて修正した軽微な点
- **螺旋のステップ数が0になりうる**: `radius=0` かつ `height=0` で `helixLength=0` → `steps=0` →
  `progress = 0/0 = NaN`。`Math.max(1, ...)` でクランプ

## 未修正（判断が必要な論点）

| 項目 | 内容 |
|---|---|
| **`passesDensitySampling` の `Math.random()`** | `getSpherePositions(..., density < 1.0)` が**非決定的**。ゲーム内では問題ないが、テストも再現もできない。**サンプラを注入可能にするか、density を廃止するか**の判断が要る。今回は触っていない |
| **`player.say()` が座標計算ループの中にある** | 計算関数が純関数でない。MakeCode の進捗表示としては妥当だが、**MCPサーバへ移植する際は必ず除去する**こと |
| **中空球（半径1）が中心を含む** | `shouldPlaceBlock(0, 1, true)` → true。半径1の中空球は退化ケースで、「バグ」と断定するのは行き過ぎ。**新実装で挙動を定義すべき論点** |

## 適用方法
```bash
git clone https://github.com/Mming-Lab/makecode-minecraft-geometry-ext.git
cd makecode-minecraft-geometry-ext
git apply /path/to/design/patches/geoext-fixes.patch
npx -p typescript@5.9.3 tsc -p harness && node harness/built/all.js
```

**ハーネスは残す価値がある。** MakeCode エディタ外で回帰を検出できる唯一の手段であり、
今後の変更でも同じ3パスを回せる。
