---
name: decisions
description: （メモ）確定した設計判断の記録。redesign-architect はこれを裁定済み事項として扱うこと。
---

# 確定した設計判断（2026-08-24）

## D-1【依頼者決定】配布モデル: **A案（クライアント単独）**
`/connect ws://...` のみ。Minecraft側への追加導入ゼロ。**B案（専用サーバ+ビヘイビアパック）は実装しない。**

**対立の経緯**: 技術選定=A案（配布コスト0）／教育ドメイン=A案（公式が「Educationはアドオン非サポート」と明言）／
セキュリティ=B案（A案は`/connect`がURIしか受けず認証情報を運べない=プロトコル制約）。依頼者がA案を選択。

**セキュリティの懸念への対処（両立させる条件）**:
- **待ち受けは `127.0.0.1` 既定。** LAN公開は `--host` の明示オプトイン＋トークン必須
- ネットワーク非露出により S-1（未認証待ち受け）〜S-4（ws脆弱性への未認証到達）の連鎖が根元から消える
- **犠牲**: 教育ドメインの「拡張構成」（生徒機4〜6台が教員機に接続する班単位運用）。
  必要になった時点でトークン方式の是非を再検討する

**A案の帰結（設計への影響）**:
- 観測はコマンド経由のみ。Script API の `dimension.getBlock()` は使えない
- 使える観測: `testforblock` 100並列（4096ブロック≒2秒）/ `gettopsolidblock` / `getchunkdata`（要検証）
- **能力が固定なので `WorldReader.capabilities()` の動的分岐は不要**になる（B案を実装しないため）

## D-2 接続ライブラリ: **Mming-Lab/SocketBE のフォーク改造**
「恒久フォーク」でなく「**リリース代行フォーク**」として運用。詳細は `design/socketbe-fork-plan.md`。
- 根拠: upstream は **PR#21 を73分でマージ**した実績があるが、**npm公開が2026-03-12から止まっている**（マージ済み修正が未リリース）
- mcpews は高レベルAPI（World/Player/Agent/Scoreboard）を持たない（src全2,877行）ため乗り換えは3,000行超の自作になる
- 運用ルール: ①upstreamファースト（フォークへのコミットと同時にPR）②フォークは「マージ済みorPR済みの変更しか持たない」③出口を先に決める（upstreamがリリースしたら `npm deprecate` して本家に戻す）
- mcpews は **devDependency** として入れる（ライブラリとして使う。CLIでは `action:agent` が取れない）

## D-3 MCP SDK: **v2 スコープ付きパッケージ**
`@modelcontextprotocol/server@2.0.0`（+ `core`）。移行は公式 `@modelcontextprotocol/codemod@2.0.0`。
- 仕様リビジョン **2026-07-28**
- 現行 `@modelcontextprotocol/sdk@^1.21.1` は2世代遅れ（1.x最新1.30.0、その上にv2）
- **ハンドシェイクが `initialize` → `server/discover` に変更**。`serverInfo` は `_meta` へ移動
- **stdio のみ使うなら `express`/`hono`/`fastify`/`node` を入れずに済む**
  → セキュリティ指摘の express系脆弱性（path-to-regexp/qs/body-parser/fast-uri）の攻撃面がゼロになる

## D-4 トランスポート: **stdio**
D-1（localhost）およびD-3（依存削減）と整合。`npx` 一発の配布形態を維持できる。
chapmanjw が Streamable HTTP 専用で `mcp-remote` アダプタを要する形は**避けるべき前例**。

## D-5 スキーマ: **独自 `InputSchema` 層を廃止**
- `inputSchema` は JSON Schema 2020-12 デフォルト。現行の独自 `Property` 型では
  `$ref` / `oneOf` / `additionalProperties:false` / **`outputSchema`** を表現できない
- **`outputSchema` + `structuredContent` を採用**（現行実装に概念そのものが存在しない）
- `zod` は **`dependencies` に明示宣言する**（現状 phantom dependency）

## D-6 ツール設計: **1ツール1機能・ドット区切り階層**
`action` 文字列での内部分岐を廃止。例: `blocks.set` / `observe.region` / `world.get_time`
- 仕様が `admin.tools.list` を**有効なツール名の例として明示**
- `title` / `outputSchema` / `annotations` / `icons` は**ツール単位のメタデータ** → action分岐では活かせない
- `tools/list` は**ページング（cursor/nextCursor）＋キャッシュ（ttlMs/cacheScope）対応**なので、
  ツール数が増えることは仕様上の障害ではない
- **決定的順序で返す（SHOULD）** — 理由が仕様に明記: LLMのプロンプトキャッシュヒット率が上がる

## D-7 ランタイム/ツールチェーン
- **Node >= 22**（16は2023-08-08、18は2025-03-27、**20は2026-03-24にEOL**）
- **ESM**（`module`/`moduleResolution`: `nodenext`, `target`: ES2023）
- `strict` に加えて **`noUncheckedIndexedAccess` を最優先で追加**（座標配列/パレット配列のインデックスアクセスが処理の中心）
- **oxlint + prettier**（4個→2個。**upstream SocketBE が既に oxlint 移行済み**なのでPR時に揉めない）
- **Vitest**（`toMatchFileSnapshot` がゴールデンテストに必須）
- ビルドは MCPサーバ=`tsc`、SocketBEフォーク=`tsdown`（upstream追従のため）
- 削除する依存: `uuid`（→`node:crypto`）、`ws`（型1箇所のみ）、`typedoc`（出力先が.gitignore済み＝誰も読んでいない）

## D-8 配布: **`npx` 一発**
`{ "command": "npx", "args": ["-y", "@mming-lab/minecraft-bedrock-education-mcp"] }`
実行ファイル化は却下（署名なしバイナリは学校端末のSmartScreen/Gatekeeper/Chromebook管理で弾かれる）。
改造版SocketBEは `@mming-lab/socket-be` として公開（バージョンは `2.6.0-mming.1` 形式でupstream対応を自明にする）。

## D-9 リポジトリ構成: **2リポジトリ**
- `Mming-Lab/SocketBE`（フォーク）— **モノレポに取り込まない。** 取り込むとPRルートが死ぬ。
  着手前に upstream へ rebase（現在 `ahead:0, behind:2`、その2コミットは自分のPRのマージ）
- `Mming-Lab/minecraft-bedrock-education-mcp` — MCPサーバ本体。npm workspaces（pnpmを教員PCに要求しない）

## D-10 検証: **実機は「未知を既知にする」ときだけ使う**
1回の実機セッションの `frames.jsonl` がCIで再生できる資産になる。詳細は `design/live-verification-plan.md`。
- ゴールデンテストは **`verdict: bug-fixed` の反転判定**を持つ（既存と一致したら失敗）
  → 既存の9件のバグを固定してしまう事故を機械的に防ぐ
- **`tools/live-probe/` を使い捨てにせず維持し、EDU更新時に50分で回せる状態を保つ**

## D-11【依頼者決定】セキュリティ要件の大幅削減
**「認証が作れなくてもよい。ワールドが壊れてもよい。」（依頼者、2026-08-24）**

### 落とす要件（セキュリティ担当の必須14項目のうち）
- 接続認証・トークン（A案では作れないため、そもそも要求しない）
- `set_work_area` によるスコープ制限（読み書き範囲の強制）
- `undo` / 破壊操作前の確認プロンプト / スナップショット
- 監査ログ
- 教員/生徒のロール分離
- 読み取り範囲の可視化（実行前のtellraw通知）
- 看板・本・名札の既定オフ（※プロンプトインジェクションの影響は
  **AIの道具がMinecraft操作に限られるためワールド内に限定される**。ワールド破損が許容なら許容範囲）
- `run_command` の既定無効化・許可リスト（※ワールド破損が許容なので露出したままでよい）

### 残す要件（理由がセキュリティではないもの）
| 項目 | 残す理由 |
|---|---|
| **待ち受け `127.0.0.1` 既定** | 実装1行（`new SocketBE({ port, webSocketOptions: { host: '127.0.0.1' } })`）。socket-beの改造も不要。副産物として `ws@8.18.3` のCVE（GHSA-96hv-2xvq-fx4p / GHSA-58qx-3vcg-4xpx）が未認証到達不能になる。**コストゼロなので落とす理由がない** |
| **キャンセル手段** | **使い勝手。** 100並列読み取りが走り出すと止める手段がなく、プロセス殺害しかない。授業中に困る。MCP の `notifications/cancelled` → `AbortSignal`、または Tasks拡張の `tasks/cancel` |
| **失敗した読み取りを `air` と誤認しない** | **正しさ。** `TooManyPendingRequests`／タイムアウトは「未知」であって「空」ではない。誤認するとAIが「そこには何もない」と判断して既存建築を上書きする。**ワールド破損が許容でも「AIが間違った答えを出す」のは別問題** |
| **レート制限** | **MCP仕様の MUST**（「Servers MUST rate limit tool invocations」）。加えて100本制限超過は個別コマンドの静かな失敗＝上記の誤認を招く |
| **PII を返さない**（要判断） | **別の軸。** `src/tools/core/player.ts:169-179` が `xuid`（Microsoftアカウント永続識別子）と `deviceId` を返す＝未成年の永続識別子が外部LLMへ渡る。学校の個人情報取扱規程に触れうる一方、**2フィールド削るだけで機能は何も失わない**。依頼者判断待ち |

### `sequence` の検証バイパス（S-7、100万コマンドループ）
**`sequence` ツール自体を廃止するため自動的に解消される。** 個別の対処は不要。

## D-12【依頼者決定・D-11を上書き】セキュリティ要件はほぼ全廃
**「そんなにセキュリティは不要です」（依頼者、2026-08-24）**

D-11 で残した項目のうち、**セキュリティ由来のものはすべて落とす。**

### 変更点
- **待ち受けは `0.0.0.0` のまま**（現状の挙動を維持）。localhost 限定にしない
  → **副産物: 教育ドメインの「拡張構成」（生徒機4〜6台が教員機に接続する班単位運用）がそのまま使える。**
    D-1 で「犠牲になる」と書いた拡張構成は**犠牲にならない**
- PII（`xuid` / `deviceId`）の除去も要件から外す
- `run_command` は制限なしで露出したままでよい

### 最終的に残る3項目（すべてセキュリティ以外の理由）
| 項目 | 理由 |
|---|---|
| **レート制限（同時64 + AIMD後退）** | MCP仕様の MUST。かつ100本超過は個別コマンドの静かな失敗を招く |
| **失敗した読み取りを `air` と誤認しない** | **正しさ。** `TooManyPendingRequests`／タイムアウトは「未知」。誤認するとAIが誤った答えを出す |
| **キャンセル手段** | **使い勝手。** 走り出した読み取りを止める手段がないと授業中に困る |

**以降、セキュリティ観点の追加要件は提案しない。** `security-architect` の報告は記録として残すが、
新実装の要件には D-12 の3項目のみを反映する。

### 補足（依頼者の説明）
`xuid` の送出は問題ない。**テナント内でしか使えない識別子のため。**（依頼者、2026-08-24）
→ `player.get_info` は現行の返り値のまま維持してよい。

---

## D-13【依頼者決定】MCPサーバとMinecraftは同一PC縛り
**「MCPもマイクラも同一PCで起動する縛りで作ればいいよね」（依頼者、2026-08-24）**

**新しい制約ではなく、D-1（配布モデルA：クライアントのみ、`/connect localhost`、専用サーバなし）が
もともと前提にしていたものを明示するもの。**

### これで可能になること

**ワールドDBを直接読める。** [world-reading.md](world-reading.md) の実測により、
これがコマンド経由のどの経路よりも優れていることが確定している：

| | コマンド経由 | DB経路 |
|---|---|---|
| ブロック識別 | 色（陰影込み・非可逆）か1コマンド1ブロック | **`minecraft:gold_block` そのもの** |
| ブロック状態 | 取得手段が乏しい | **`states` ごと取れる** |
| 範囲 | `structure` は64ブロック上限 | チャンク単位で無制限 |
| 往復 | 4096ブロックで約33秒 | **ゼロ**（スナップショット約60ms） |
| 翻訳の影響 | `testforblock` は全滅 | **無し** |

`structure save` を挟めば**2〜7秒**で最新状態が読める（実測3回：2.1 / 6.6 / 5.2秒）。

### これで切り捨てるもの

**iPad / Chromebook で動く教育版は対象外になる。** 教育版はそれらのプラットフォームでも
動作するが、MCPサーバが同居できないためDBに到達できない。

D-12 の補足で「拡張構成（生徒機4〜6台が教員機に接続）は犠牲にならない」と書いたが、
**その構成では生徒機のワールドは読めない。** 教員機のワールドのみ。
生徒機を読む必要が出た場合はコマンド経路を実装し直すことになる。

### 実装方針
- **読み取りはDB経路を第一とする。** コマンド経路（`getchunkdata` / `gettopsolidblock` /
  `execute if block`）は実装しない — 必要になったときに [world-reading.md](world-reading.md)
  の実測値から起こせるよう、仕様だけ記録してある
- **書き込みは従来どおりコマンド経由**（`/setblock`、`/fill`）。DBへの書き込みはしない
- 開いているワールドの特定は、**一意な名前で `structure save` して、
  そのキーを持つDBを探す**（`levelname.txt` の照合より確実。同名ワールドが複数あっても効く）
