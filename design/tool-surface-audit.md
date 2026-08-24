---
name: tool-surface-audit
description: （メモ）現行20ツールの静的監査結果。説明文と実装の乖離を機械的に検出。sequence のクロスツール参照は8個中8個が存在しない。
---

# ツール表面の監査（2026-08-24）

ツール `tools/golden-extract/dump-schemas.mjs`、成果物 `tests/golden/schemas/`。

`BaseTool` が socket-be に依存していて import できないため、**TypeScript Compiler API で
構文木から静的に抽出**した。`name` / `description` / `inputSchema` はリテラル初期化子なので、
コードを実行せずに読める。

## 規模
**20ツール。** パラメータ数は最小2（`sequence`）から最大19（`camera`）。

## ★1. `sequence` のクロスツール参照は 8個中8個が存在しない

`sequence` の description が他ツールのアクション名を列挙しているが、**ひとつも実在しない**:

| 参照先 | `sequence` が宣伝 | そのツールの実際の enum |
|---|---|---|
| `player` | `teleport` / `move` / `say` | 3個とも**無い**（実在は `send_message` など） |
| `camera` | `shot` / `video` | 2個とも**無い**（実在は `move_to` / `smooth_move` など） |
| `blocks` | `setblock` / `fill` | **無い**（実在は `set_block` / `fill_area`） |
| `world` | `time` / `weather` | **無い**（実在は `set_time` / `set_weather`） |

**LLMがこの説明文を読んで組み立てるステップは100%失敗する。**
`sequence` 廃止（`design/ax-design.md` 問4）の根拠がまた1つ増えた。

## ★2. 説明文が存在しないアクションを宣伝している

| ツール | 宣伝しているが存在しない |
|---|---|
| `world` | `set_difficulty`, `set_spawn`, `query_info` |

実物の description:
```
World management: control time/weather/environment. Actions: set_time(day/night/specific_time),
set_weather(clear/rain/thunder), set_difficulty(peaceful/easy/normal/hard),
set_spawn(coordinates), query_info(world_stats). ...
```
「Actions:」として5個挙げ、**うち3個が存在しない**。

## ★3. 説明文が実装を隠している（逆方向のギャップ）

説明文が触れないアクションは、LLMにとって**存在しないのと同じ**。

| ツール | 触れている | 触れていない |
|---|---|---|
| `world` | **2/11** | `get_time`, `get_day`, `get_weather`, `get_players`, `get_world_info`, `send_message`, `run_command`, `get_connection_info`, `sequence` |
| `agent` | 8/15 | **`inspect_block`, `detect_block`**, `get_position`, `drop_item`, `drop_all`, `set_item_in_slot`, `sequence` |
| `minecraft_wiki` | 2/5 | `get_page`, `get_page_summary`, `get_section` |
| `blocks` | 4/7 | `query_item_data`, `query_mob_data`, `sequence` |
| `player` | 10/13 | `get_location`, `get_abilities`, `get_tags` |
| `build_*` 9ツール | **0/1** | `build`（アクション名を一度も書いていない） |

**`world` は両方向に同時に間違っている** — 存在しない3個を「Actions:」として強調し、実在する9個に触れていない。

**`agent` が `inspect_block` / `detect_block` に触れていない**のは特に痛い。観測能力そのものであり、
しかも socket-be がレスポンスを捨てているため実際には値も返っていなかった（`design/socketbe-phase1-result.md` で修正済み）。

## ★4. 検証バイパスは `steps` だけではない

`items` を持たない配列パラメータは `schema-converter.ts` で `z.array(z.any())` になり、
**中身の enum / minimum / maximum がすべて無効化される**:

| ツール | パラメータ |
|---|---|
| `agent` | `steps` |
| `blocks` | `steps` |
| `camera` | `shots` |
| **`player`** | **`can_destroy`** |
| **`player`** | **`can_place_on`** |

`can_destroy` / `can_place_on` は**新規発見**。セキュリティ担当が指摘した `sequence` 経由の
検証バイパス（S-7）と同じ穴が、アイテムの配置制限にも空いている。

## 新実装への含意

1. **description は機械的に検証できる。** アクション名の宣伝と enum の照合、
   逆方向（実在するのに触れていない）の検出、クロスツール参照の照合。
   **`dump-schemas.mjs` をCIに組み込めば、この乖離は二度と起きない**
2. `design/ax-design.md` の「description は『いつ使い、いつ使わないか』を書く」は正しいが、
   **書いた内容が実装と一致していることの機械的な保証**も要る
3. `outputSchema` は現行20ツールすべてに**存在しない**（概念そのものが無い）。
   MCP仕様 2026-07-28 では定義でき、`structuredContent` と対で使える
4. **1ツール1機能にすれば、この種の乖離の大半が構造的に消える。**
   `action` enum が無くなれば「宣伝したアクションが存在しない」という失敗形自体が無くなる

## ツール別のパラメータ数（参考）
| ツール | actions | params |
|---|---|---|
| `camera` | 7 | **19** |
| `player` | 13 | 14 |
| `system` | – | 15 |
| `build_rotate` | 1 | 13 |
| `build_helix` / `build_transform` | 1 | 12 |
| `agent` | 15 | 11 |
| `build_bezier` | 1 | 11 |
| `blocks` | 7 | 10 |
| `sequence` | – | 2 |

`camera` は19パラメータで最大。教育ドメイン担当が削除を提案したツールでもある。
