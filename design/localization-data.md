---
name: localization-data
description: （メモ）flyde-minecraft-bedrock が持つ29言語のブロックID↔表示名対応表。testforblock のローカライズ問題を解決する既存資産。
---

# ローカライズ対応表（2026-08-24）

`https://github.com/Mming-Lab/flyde-minecraft-bedrock`（依頼者のリポジトリ、2026-07-03 push、TypeScript）
の `_nodes/utils/_maps/` に **29言語のID↔表示名対応表**がある。

## 実測した中身

`ja_JP.json`（187KB）を実際に取得してパースした結果:

| セクション | エントリ数 |
|---|---|
| `BLOCK` | **1,341** |
| `ITEM` | **1,516** |
| `MOB` | **128** |
| `ENUM` | 8 |
| `ENUM_CAT` | 8 |

形式:
```json
{
  "BLOCK": {
    "minecraft:acacia_button": "アカシアのボタン",
    "minecraft:stone": "石",
    "minecraft:air": "空気"
  },
  "ITEM": { ... }, "MOB": { ... }
}
```

言語は29種（`ja_JP` / `en_US` / `en_GB` / `zh_CN` / `zh_TW` / `ko_KR` / `de_DE` / `fr_FR` / `fr_CA` /
`es_ES` / `es_MX` / `pt_PT` / `pt_BR` / `it_IT` / `ru_RU` / `uk_UA` / `pl_PL` / `nl_NL` / `sv_SE` /
`da_DK` / `nb_NO` / `fi_FI` / `cs_CZ` / `sk_SK` / `hu_HU` / `bg_BG` / `el_GR` / `tr_TR` / `id_ID`）。

## なぜ重要か

観測調査の最優先リスクは **「`testforblock` の `statusMessage` に入るブロック名が
クライアント言語でローカライズされる可能性」** だった。日本語クライアントで「石」が返るなら、
表示名をパースする設計は成立しない。

**この対応表があれば、ローカライズされていても ID に戻せる。**

実機検証（`design/live-verification-plan.md` の Rig D）で日本語化が確認された場合の対策が、
新たに作るのではなく**既存資産を使うだけ**で済む。

## 使用上の注意（実測）

**逆引き（表示名 → ID）には衝突がある。** `ja_JP` の BLOCK 1,341件で **40件の重複**を確認した。
複数のIDが同じ日本語名を持つケースがある（ブロック状態違いなど）。

したがって:
- **ID → 表示名の方向を正とする**
- 逆引きは「候補集合」として扱い、一意に決まらない場合は候補を返す
- 事前検証（`design/ax-design.md` 問3）の候補提示にはこれで十分

## 実機の `queryData('block')` との関係

`design/ax-design.md` は起動時に `queryData('block')` でレジストリを構築する設計にしている。
両者の役割は違う:

| | 取得元 | 内容 | 用途 |
|---|---|---|---|
| `queryData('block')` | **実機** | `{aux, id, name}` の一覧。**接続中のバージョンの真実** | ID の存在検証、候補生成 |
| `_maps/*.json` | 静的ファイル | ID ↔ **各言語の表示名** | ローカライズされた文字列から ID を逆引き |

**`queryData` の `name` が表示名なのか英語IDなのかは未確認**（Rig A の A-3 #4 で確認する項目）。
表示名だった場合、`queryData` だけで日本語対応が完結する可能性もある。
その場合 `_maps` は不要になるが、**オフラインでの候補生成には依然有用**。

## 未確認
- `_maps/*.json` がどのMinecraftバージョン基準で生成されたか（リポジトリに記載を未確認）
- 生成方法（手動か、公式の言語ファイルからの変換か）
- MCPサーバに同梱する場合のサイズ影響（29言語で約5MB。**日本語＋英語だけなら約350KB**）

## 参考: `flyde-minecraft-bedrock` そのもの
2026-07-03 push、TypeScript、「Visual flow-based programming for Minecraft Education/Bedrock
Edition, built with Flyde」。**MCPサーバより新しく、同じく Bedrock/Education を制御する。**
本メモは `_maps` のみを対象にした。**接続層やツール設計に転用できるものがある可能性は未調査。**
