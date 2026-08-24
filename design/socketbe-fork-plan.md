---
name: socketbe-fork-plan
description: （メモ / エージェント定義ではない）Mming-Lab/SocketBE フォークの改造計画。調査で判明した欠落と、その修正箇所の特定結果。
---

# Mming-Lab/SocketBE 改造計画

## フォークの現状（2026-08-24 実測）
- `Mming-Lab/SocketBE` は `tutinoko2048/SocketBE` の**フォーク**。MIT。★0
- **`ahead_by: 0, behind_by: 2`** — 独自変更はまだ1件も無く、upstream から2コミット遅れ
- upstream: ★33 / 2026-07-19 push / **v2.6.0**（対象MCPサーバは `socket-be@^2.3.1` = 3マイナー遅れ）
- ソース構成は整理されたTS: `src/enums/` `src/events/` `src/entity/` `src/block/` `src/network/` `src/world/` `src/types/`

**→ 今なら upstream への追従が最も楽。着手前に rebase して差分ゼロから始めるべき。**

## 判明した根本原因

upstream 作者は `src/entity/agent.ts` にこう書いている:
```ts
public async getItemCount(slot: number): Promise<void> {
  // Sadly this command does not return any data      ← 作者の結論
  const res = await this.world.runCommand(`agent getitemcount ${slot}`);
  if (res.statusCode < CommandStatusCode.Success) throw new Error(res.statusMessage);
}
```
**これは誤診。** データは `action:agent` フレームで返っている（1.18.30 でエージェント系が専用チャネルへ移行）。
`MessagePurpose` enum に値が無く、受信ハンドラが破棄しているため「返らない」ように見えているだけ。

`inspect` / `inspectData` / `detect` / `detectRedstone` / `getItemCount` / `getItemSpace` / `getItemDetail`
の7メソッドが全て `Promise<void>` で結果を捨てている（`src/entity/agent.ts:71-89, 144-160`）。

## 改造箇所（特定済み）

### Phase 1 — 受信経路を開ける（最小・最重要）
| # | ファイル | 変更内容 |
|---|---|---|
| 1 | `src/enums/message-purpose.ts` | `AgentAction = 'action:agent'` を追加。現在の enum は Subscribe/Unsubscribe/Event/Error/CommandRequest/CommandResponse/Encrypt/DataResponse/BlockDataRequest/ItemDataRequest/MobDataRequest の11値のみ |
| 2 | `src/network/network.ts:175-186` | `deserializablePurposes` 配列に `MessagePurpose.AgentAction` を追加（これが握り潰しの実体） |
| 3 | `src/network/network.ts:189-198` | `switch (messagePurpose)` に `case MessagePurpose.AgentAction` を追加 |
| 4 | `src/network/packets/agent-action.ts`（新規） | `AgentActionResponsePacket`。ヘッダに `action: number`（AgentActionType）と `actionName: string`。**body のフィールド名は実機ダンプで確定させる** |
| 5 | `src/network/connection.ts` | requestId 相関を**2フレーム対応**に。`commandResponse` では resolve せず保持し、`action:agent` 受信で両方を返して resolve（mcpews `sendAgentCommand` と同じパターン） |
| 6 | `src/entity/agent.ts` | 上記7メソッドの戻り値を `Promise<void>` → 実データ型に変更 |

**送信側は改造不要。** `src/network/network.ts:50` に既に
`messagePurpose: options?.overrideMessagePurpose ?? packet.getPurpose()` があり、
`CommandRequestPacket` を `action:agent` として送出できる。

参考実装: mcpews `src/lib/server.ts` の `sendAgentCommand` / `sendAgentCommandRaw`、
`src/lib/protocol.ts` の `MinecraftAgentActionType`（Inspect=8）

### Phase 2 — 一括読み取りと並列化
| # | 対象 | 内容 |
|---|---|---|
| 7 | `src/world/world.ts` | `getChunkData(dimension, chunkX, chunkZ, height)` を追加。**返り値フォーマットは要実機確認**（wiki=ブロックID+高さ / mcwss=色RGB+高さ で食い違い）。パーサ参考は mcwss `protocol/command/chunk_data.go` の `ParseChunkData` |
| 8 | `src/world/world.ts` | `getChunks(dimension)` を追加 |
| 9 | `src/world/world.ts` | **100本パイプライン実行API**（例 `runCommands(commands: string[], concurrency = 100)`）。同時未応答上限は100（超過で `-2147418109 TooManyPendingRequests`）。現状 `runCommand` はキューもスロットルも持たないので、`Promise.all` を100本ずつ回すラッパで足りる。**4096ブロックが208秒→約2秒** |
| 10 | `src/entity/agent.ts` | `getitemdetail` / `getitemspace` / `getitemcount` は Phase 1 で復活する |

### Phase 3 — イベントとチャネルの拡充
| # | 対象 | 内容 |
|---|---|---|
| 11 | `src/enums/server-event.ts` | 26 → **83イベント**。参照: bedrockws-deno `src/schema/lib/response.ts` の zod スキーマ（69個は未解析なので段階的に） |
| 12 | `src/enums/message-purpose.ts` + network | `chat` / `chat:subscribe` / `chat:unsubscribe`。sender/receiver/message でフィルタした購読が可能 |

### Phase 4 — 配布
| # | 内容 |
|---|---|
| 13 | `@mming-lab/socket-be` としてスコープ付き npm 公開。新MCPサーバはこれに依存 |
| 14 | Phase 1 の修正は **upstream へ PR** を出す価値がある（作者の誤診を解く内容。upstream は★33で活発） |

## フォーク改造 vs mcpews 乗り換え の比較

| | フォーク改造 | mcpews へ乗り換え |
|---|---|---|
| 高レベルAPI（World/Player/Agent/Scoreboard/Block） | **既にある** | **自作が必要** |
| プロトコル網羅 | 改造で追いつく | 既に網羅 |
| 対象MCPサーバからの移行コスト | **低**（既に socket-be 依存） | 高（全書き換え） |
| upstream 追従コスト | あり（今は behind 2 で最小） | — |
| 還元 | PR で upstream に貢献できる | — |

**→ フォーク改造が総工数で有利。** ただし独自パッチが増えるとマージが辛くなるので、
**変更は小さくモジュール分離して保つこと**（新規パケットは新ファイル、既存ファイルへの変更は最小行数に）。

## 着手順の推奨
1. **upstream に rebase**（behind 2 を解消。今が最も楽）
2. **実機でフレームダンプ** — `action:agent` の body フィールド名、`getchunkdata` の返り値を確定
   （mcpews の `mitm` / `repl` を使えば SocketBE を改造する前に確認できる）
3. Phase 1 を実装 → `agent inspect` が値を返すことを確認
4. Phase 2 の並列化 → レイテンシ実測
5. Phase 2 の `getchunkdata` → 2 の結果次第
6. Phase 3 以降

**2 を 3 より先にやること。** フィールド名が分からないまま `AgentActionResponsePacket` を書くと当て推量になる。
