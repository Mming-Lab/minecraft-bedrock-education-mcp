---
name: live-verification-plan
description: （メモ）実機検証手順書。散在していた30項目を6治具に整理。クリティカルパス4時間で新実装の骨格が確定する。
---

# 実機検証手順書

## 治具と実行順（厳守）
```
Rig A ── WebSocket 生フレームダンプ（自作ダンパ）   … V-01..06, 08..16, 20, 21, 30  ← 最初
Rig D ── Rig A を日本語ロケールで再実行（差分のみ） … V-07
Rig B ── 同一マシンでのワールドDB観測              … V-16..21
Rig C ── ビヘイビアパック（Script API）経路        … V-22..27
Rig E ── MakeCode UI 目視                          … V-28
Rig F ── bedrock-protocol 接続試行                 … V-29
```
**順序の根拠**: Rig A の結果が技術選定の分岐を決める。V-01/02 が「色RGB+高さ」なら `getchunkdata` は脱落し
fork-plan #7 が消える。V-04 が空 body ならフォーク Phase 1 の前提が崩れる。
**この2つが判明する前に Rig B/C に工数を割くのは投機。** また A で観測が解決すれば C を丸ごとスキップできる可能性がある。

## ★訂正: mcpews の CLI では `action:agent` が取れない
- `repl` が公開するのは `command`/`commandLegacy`/`subscribe`/`encrypt`/`session`。
  この `session` は `AppSession` 型で、**agent 系メソッドを持たない**。`sendAgentCommand` は下層の `ServerSession` のみ
- `mitm` は `unknown:` 分岐で拾えるが **転送先の実サーバが別途必要**、かつ `console.log` の depth=2 打ち切りで入れ子が `[Object]`
- → **約70行の自作ダンパが必要。** ただし mcpews は**ライブラリとしては完璧**（`ServerSession.sendAgentCommand` が2フレーム相関を実装済み）。
  **CLI ではなくライブラリとして使う**のが正解

## 自作ダンパ仕様（`tools/live-probe/probe.mjs`、約70行）
依存: `mcpews@4.0.3` のみ。起動: `node probe.mjs --port 19131 --out ./dump/<timestamp>/`
1. `new WSServer(19131)` → `'client'` イベントで `ServerSession` 取得
2. **全フレームを無条件記録**: `frames.jsonl` に1行1JSON、`{ t: performance.now(), dir:'in'|'out', raw: <frame全体> }`。
   **`JSON.stringify` を使う（`console.log` は depth 打ち切りで情報が消える）**
3. 接続直後に `BlockPlaced` / `BlockBroken` / `PlayerMessage` を購読
4. `cmd(line)`: `session.sendCommand()` を Promise 化。**タイムアウト10秒、reject も記録**（無応答も観測結果）
5. `agent(line)`: `session.sendAgentCommand()` を Promise 化 → `action`/`actionName`/`commandResponse` が1オブジェクトで取れる
6. `--encrypt` で `session.enableEncryption()`（V-30 の分岐用）
7. シナリオを `scenarios/*.mjs` に分割し `--only <name>` で個別再実行できること

## ワールド事前準備（再現性の土台）
| 手順 | 内容 |
|---|---|
| P1 | **フラットワールド**新規作成 `qa-probe-01`。チートON、クリエイティブ |
| P2 | `/tp 0 -60 0` でチャンク(0,0)に固定 |
| P3 | ランドマーク設置（下表） |
| P4 | ワールドGUIDを `levelname.txt` で特定（**V-19 をここで消化**） |
| P5 | `/gamerule sendcommandfeedback true`、`commandblockoutput true` |

ランドマーク（すべて y=-60）:
| 座標 | 置くもの | 判定用途 |
|---|---|---|
| (10,-60,10) | stone | V-06「既知の石」 |
| (12/14/16/18/20/22/24,-60,10) | water / oak_leaves / torch / glass / white_carpet / snow_layer / oak_slab | **V-09 "solid" の定義** |
| (26,-60,10) | 空気 | V-09 空気列の戻り値 |
| (30..33,-60..-57,30..33) | stone 64個 | V-12 自己置換の母数（**既知の64**） |
| (30..33,-56,30..33) | sand 16個（stone直上） | **V-12 副作用検出**（更新が走れば砂が落ちる） |
| (40,-60,40) | エージェント配置、前方(41,-60,40)に coal_ore | V-04 の期待値 |

## クリティカルパス（4時間で骨格3点が確定）

### A-0 接続確立（V-30）— 2本
`--encrypt` なしで `/connect` → 通れば平文可。無反応なら `--encrypt` 付きで再試行。
両方失敗ならここで停止（ファイアウォール19131/TCP、`/connect` URL形式を先に潰す）。
**記録: `encryption_required = yes|no`** ← 新実装の接続シーケンス設計を直接決める

### A-1 `getchunkdata` フォーマット決着（V-01..03）— 6本 ★最優先
`getchunkdata overworld 0 0 100` / `0 0 -30` / `1 0 100` / commandLegacy経路 / `getchunks overworld` / `getchunks`

**V-02 の機械的判定手順（目視でなくスクリプトで）**
```
J1: data を "," split、"*N" を N回展開 → 要素数が 256 か？
    256 → step2。それ以外 → 要素数と先頭200文字を報告して停止
          （4096なら16³、65536なら別の意味。ここで設計が変わる）
J2: 全エントリの文字数のユニーク集合
    全て6文字 → wiki説「6桁ID+末尾2文字base64の高さ」→ J3a
    全て8文字 → mcwss説「base64 4バイト = B,G,R,height」→ J3b
    混在 → 報告（可変長パレット参照の可能性）
J3a: 先頭4文字=数値ID、末尾2文字=base64高さ → 全エントリの高さが -60±1 か
J3b-1: 4バイト目が全て -60±1 か
J3b-2: 石を置いた(10,-60,10)に対応するエントリだけ灰色系か（他は草の緑系）
       Yes → 「色説確定。getchunkdata はトップダウン地図相当。ブロックIDは得られない」
              → 観測手段として脱落。fork-plan #7 を削除。用途は地形高さマップに限定
J4: どちらもfail → 「フォーマット不明」で確定させ設計から外す。
    ★ここで粘らない。testforblock 100並列で16³が2秒なら実用上足りる
```
**記録: `getchunkdata_format = wiki-blockid | mcwss-rgb | unknown`, `entries`, `entry_len`**

### A-2 `action:agent` の body フィールド名確定（V-04, V-05）— 5本 ★フォークPhase1の前提
| # | 呼び方 | 判定 |
|---|---|---|
| 1 | `agent('agent inspect forward')` | `header.action === 8` を確認。**body に `"coal_ore"` を含む文字列フィールドがあれば、そのフィールド名が答え** |
| 2 | 同フレームの `commandResponse` 部 | 2フレームが1オブジェクトで揃うか → **fork-plan #5「2フレーム相関」の正しさが確定** |
| 3 | `agent inspectdata forward` | `action === 9`。整数フィールド名 |
| 4 | `agent getitemcount 1` | `action === 10`。**upstream作者の "does not return any data" 誤診の反証** |
| 5 | `cmd('agent inspect forward')`（**従来の commandRequest**） | `action:agent` が来ない → 送信側も切替必須。両方来る → 送信側は無改造で済む |

**記録: `agent_inspect_body_field`, `agent_two_frame`, `legacy_purpose_compat`**
**★これが `AgentActionResponsePacket`（fork-plan #4）の定義そのもの。空ならPhase 1に着手してはいけない。**

### Rig D 日本語ロケール（V-07）— 6本 ★工数20分でアーキテクチャが決まる
言語を日本語に変更→再起動→A-3の4本とA-4の2本を再実行。
- `statusMessage` に「石」が含まれる → **ローカライズされる。表示名パースは設計として採用不可。**
  `queryData block` の表 or `gettopsolidblock` の構造化フィールドに切替必須
- 英語のまま → パースを主手段にしてよい
- `gettopsolidblock` の `blockName` が変わらない → 「構造化・ローカライズ非依存」が実証される
**絶対に省略しないこと。**

## 他シナリオの要点
- **A-3 `testforblock`（V-06,08）4本**: `statusMessage` を一字一句記録し、sanand0 の正規表現 `/is (.*?) \(expected:/` が**実物にマッチするか実際に走らせる**。しなければ実物から書き直す（それが成果物）
- **A-4 `gettopsolidblock` の solid 定義（V-09）9本**: water/leaves/torch/glass/carpet/snow/slab を pass|block で表に。**pass が1つでもあれば単独では地形高さを取り切れない**→ TheBeems の二分探索を補完に組み込む。`blockData` が実際に返るかも確認
- **A-5 レイテンシと並列上限（V-10,11）211本**: 対象は `testforblock` 固定（`say` はチャット流量制限の影響を受ける）。直列20回→10並列×10→100並列×3→**101本**→150本→超過後に正常1本。`over_limit_behavior = error|silent-drop`（後者ならリトライ設計が必須）、`session_recovers`。**`design/observation-findings.md` の全秒数見積りを実測値で再計算すること**
- **A-6 `fill` 自己置換（V-12,13）6本**: `fillCount` が64か0か。**直後に砂が残っているか（副作用検出）**。`BlockPlaced` が64件飛ぶなら自前ワールドモデルが汚染される→除外フィルタ必要。32768ちょうど/超過で上限メッセージを取得
- **A-7 コマンド文字列コーパスの再生（V-14〜16）18本**: `tests/golden/commands/corpus.json` を1本ずつ送り、`statusCode` と `statusMessage` をそのまま記録する。**生成器のテストが緑でも、実機が受理するかは別問題**であり、それを埋めるのがこの治具。とくに決着が要るのは次の2点
  - **キャレット `^` を `/setblock`・`/fill` が受けるか。** wiki の /fill ページは Bedrock の座標形式にキャレットを挙げているが、Coordinates ページは Java の節でしか説明していない。**食い違っているので実測以外に決め手がない。** 落ちるなら `local()` を座標型から外す（現状どのツールも `^` を出さないので実装はブロックされない）
  - **`fill` の体積上限が本当に 32768 か。** wiki は Java についてのみ 32768 を明記し、Bedrock の数値を書いていない。`FILL_VOLUME_LIMIT` は唯一「出典なし」の定数。32768ちょうど／32769 の2本で確定させる（A-6 と同じ観測でよい）
  - 受理された文字列は `frames.jsonl` に残るので、そのままCIのフィクスチャに昇格できる
- **Rig B（V-17）**: `db/` を250ms間隔でポーリング→`setblock` 1本→**`t_flush` を実測**。`<2秒`ならリアルタイム観測可／30-300秒なら事後解析限定／**5分変化なしならワールド退出まで書かれない＝設計から外す**

## 記録フォーマット
```
dump/<timestamp>/
  meta.json      EDUバージョン、OS、クライアント言語、ワールドGUID、encryption_required
  frames.jsonl   全フレーム（一次データ。★これがCIのフィクスチャになる）
  verdicts.json  判定欄（未実施はnull、失敗は "fail:<理由>"）
  latency.csv    A-5の生データ
  screenshots/   Rig E の証跡
```
`verdicts.json` の必須キー（全部埋まったら検証完了）:
```
encryption_required, getchunkdata_format, getchunkdata_entries, getchunkdata_entry_len,
getchunks_usage, agent_inspect_body_field, agent_two_frame, legacy_purpose_compat,
testforblock_regex, testforblock_position_in_body, registry_name_matches_statusmessage,
localized_statusmessage, gettopsolidblock_blockdata_present, solid_definition{7項目},
rtt_serial_p50, rtt_10par, rtt_100par, max_concurrent, over_limit_behavior, session_recovers,
self_replace_counts, self_replace_side_effect, self_replace_fires_events, fill_volume_limit,
caret_accepted_setblock, caret_accepted_fill, corpus_rejected[],
tickingarea_area_limit, tickingarea_chunk_limit, extra_data_types,
structure_save_ok, structure_volume_limit, save_hold_available,
world_path_form, db_readable_while_running, t_flush_ms, t_readable_ms, structuretemplate_readable,
script_say_reaches_ws, script_sendmessage_reaches_ws, max_msg_bytes, scriptevent_max_chars,
per_tick_send_limit, drop_rate, getblock_throughput{pc,chromebook,ipad},
makecode_inspect_exposed, bedrock_protocol_edu_connect
```

## 所要時間
| フェーズ | 所要 |
|---|---|
| 準備（環境・ワールド・ランドマーク） | 45分 |
| ダンパ実装（70行）+ シナリオ7本 | 2.0時間 |
| Rig A 実行 | 50分 |
| Rig A 解析（V-02 のフォーマット判定） | 1.5時間 |
| Rig D | 20分 |
| **小計（技術選定の分岐が決まるまで）** | **約5.5時間** |
| Rig B / C / E / F + 記録整理 | +6.5時間 |
| **合計** | **約12時間（Rig C スキップなら9時間）** |

**最短経路: A-0 → A-1 → A-2 → Rig D の4シナリオだけなら準備込み約4時間で骨格3点が決まる。1日目にここまで到達すること。**

## 核心原則
> **実機は「未知を既知にする」ときだけ使い、「既知が壊れていないか」には使わない。**

1回の実機セッションの `frames.jsonl` が**CIで再生できる資産**になる。
`action:agent` の順序反転・片方欠落・requestId混線は**実機では意図的に起こせないのでモックの方が強い**。

**ダンパは使い捨てにせず `tools/live-probe/` として維持し、EDU更新時に50分で回せる状態を保つこと。**
これが「仕様が予告なく変わるリスク」への唯一の現実的な対策。
CI は `verdicts.json` の `meta.edu_version` を照合し、**EDUが上がったら「再検証が必要」で落ちる**。
