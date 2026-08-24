---
name: socketbe-phase1-result
description: （メモ）SocketBE フォーク Phase 1 の実装完了報告。パッチは design/patches/socketbe-phase1.patch。実機Minecraft不要で完成。
---

# SocketBE Phase 1 実装完了（2026-08-24）

`action:agent` の受信経路を開け、agent系7メソッドが値を返すようになった。**実機Minecraft不要で完成**。

パッチ: `design/patches/socketbe-phase1.patch`（890行）
作業ディレクトリ: scratchpad の `socketbe/`（session固有なので、必要ならパッチを再適用すること）

## fast-forward の判断
`behind_by: 2` の正体は **Mming-Lab 自身の PR #21 のマージコミット**だった。
```
5429b6d Merge pull request #21 from Mming-Lab/fix/response-parsing-guards
0bbedad fix: guard command response parsing against non-matching messages
   src/entity/player.ts               |  3 ++-
   src/world/scoreboard/scoreboard.ts | 11 ++++++++---
```
フォークに独自コミットが0件なので **rebase ではなく fast-forward で足りる**。実行済み。

```bash
git remote add upstream https://github.com/tutinoko2048/SocketBE.git
git fetch upstream
git merge --ff-only upstream/main
```

## 中心的な設計判断：透過設計を採用

`action:agent` レスポンスの body のフィールド名は**未確認**（Mojang が文書化していない）。
そこで **body 全体をそのまま返す**設計にした。既存の `CommandResult<T> = {statusCode, statusMessage} & T`
と同じ考え方。

```ts
interface AgentActionResult<T = Record<string, unknown>> {
  action: AgentActionType;     // ヘッダ由来。Inspect = 8
  actionName: string;          // ヘッダ由来。"inspect" など
  body: T;                     // ★解釈せず透過
  commandResponse?: CommandResult<...>;  // 対になる commandResponse フレーム
}
```
**実機でフィールド名が判明したら `agent.inspect()` の戻り値型を絞り込むだけ。実装本体は変わらない。**

mcpews も同じ判断をしている（`sendAgentCommand<B = unknown>`、`src/lib/server.ts:303`）。
**ただし mcpews は順序反転を扱っていない** — `action:agent` が先に来ると `commandResponse` が
undefined のまま完了する。こちらはその場合も明示的に扱う（下記）。

## 変更内容

### 新規ファイル 6件
| ファイル | 内容 |
|---|---|
| `src/enums/agent-action-type.ts` | `AgentActionType` enum。**mcpews `src/lib/protocol.ts:103` を直接読んで検証**（Attack=1 … **Inspect=8** … Turn=18） |
| `src/types/world/agent-action-result.ts` | `AgentActionResult<T>` |
| `src/network/packets/agent-action-response.ts` | `AgentActionResponsePacket`。header の `action`/`actionName` を取り、body は透過 |
| `src/handlers/agent-action-response.ts` | `AgentActionResponseHandler` |
| `src/errors/agent-action.ts` | `MissingAgentActionError` |
| `test/agent-action.test.mjs` | 相関ロジックの単体テスト10件 |

### 変更ファイル 14件
| ファイル | 変更 |
|---|---|
| `src/enums/message-purpose.ts` | `AgentAction = 'action:agent'` 追加 |
| `src/enums/packet.ts` | `AgentActionResponse = 'action:agent'` 追加 |
| `src/network/network.ts` | `deserializablePurposes` 配列に追加（**握り潰しの実体**）+ `switch` に case 追加。計2行 |
| `src/network/packets/packets.ts` | レジストリ登録 |
| `src/handlers/index.ts` | ハンドラ登録 |
| `src/types/network/packet.ts` | `AgentActionHeader` 追加 + `IHeader` union に追加 |
| `src/types/network/connection.ts` | `PendingResponse` に `expectsAgentAction` / `commandResponse` / `agentAction` を追加 |
| `src/network/connection.ts` | **2フレーム相関の中核**（下記） |
| `src/world/world.ts` | `runAgentCommand()` 追加 |
| `src/entity/agent.ts` | 7メソッドの戻り値を `Promise<void>` → `Promise<AgentActionResult>` |
| enums/errors/types/packets の各 `index.ts` | export 追加 |

**送信側は改造不要だった**（`network.ts:50` の `options?.overrideMessagePurpose ?? packet.getPurpose()` を実際に確認）。

### 2フレーム相関の挙動
| 状況 | 挙動 |
|---|---|
| `commandResponse` → `action:agent`（正常） | 前者は**バッファして待つ**。後者で両方を結合して resolve |
| `action:agent` → `commandResponse`（順序反転） | 前者で即 resolve（`commandResponse` は undefined）。後者は pending が無いので破棄 |
| `action:agent` が来ない | タイムアウトで **`MissingAgentActionError`**（statusCode/statusMessage 付き）。**status のみで resolve しない**＝無音の空成功を作らない |
| どちらも来ない | `RequestTimeoutError` |
| `commandResponse` の statusCode < Success | **即座に `CommandError`**（10秒待たない） |
| `error` purpose フレーム | 即座に `CommandError` |
| requestId 混線 | Map がキー分離しているので影響なし。**100本並列でも検証済み** |

### 副産物のバグ修正
既存の `awaitResponse` は**タイムアウト時に `pendingResponses` から削除していなかった**（reject するだけ）。
応答が永久に来ない場合エントリが残り続ける。今回 `settle()` に整理し、タイムアウト経路でも削除するようにした。
この修正はバッファリング機構の正しさに必要（タイムアウト済みリクエストが復活しないため）。

## 検証結果（すべて実行済み）

| 項目 | 結果 |
|---|---|
| `tsc --noEmit` | **エラー0**（`AgentActionHeader` を union に追加して1件解消） |
| `tsdown`（ビルド） | **成功**。ESM 2ファイル 206.57 kB / CJS `index.d.cts` 76.49 kB |
| 生成物の公開API | `inspect(direction: AgentDirection): Promise<AgentActionResult>` を `dist/index.d.mts:915` で確認 |
| `oxlint` | **0 errors / 7 warnings**。**7件は変更前後で同一**（`player.ts`/`world.ts`/`test/index.mts` に元からあるもの）＝**本変更による新規警告ゼロ** |
| `oxlint --type-aware --type-check` | 実行不能。`tsgolint` バイナリが起動できない環境問題（`spawnargs: ['headless']`）。**本変更とは無関係** |
| 単体テスト | **10件すべて成功**（`node test/agent-action.test.mjs`） |

### ビルド環境の注意
upstream は `devEngines.packageManager: { name: pnpm, version: 10.28.0, onFail: error }` で pnpm を強制する。
- `npm` / `npx` は**パッケージディレクトリ内で必ず EBADDEVENGINES で失敗する**
- `corepack prepare pnpm --activate` は `C:\Program Files\nodejs` への書き込みが要り **EPERM**（管理者権限が必要）
- **回避策**: 親ディレクトリで `npm i pnpm@10.28.0` してローカルの `node_modules/.bin/pnpm` を使う（実行済み）

## upstream への PR 草案（2件）

### PR 1: `action:agent` 応答フレームの受信経路を開ける

**Title**: `fix(network): handle action:agent response frames so agent commands return their payload`

**Body**:
```
## Problem

`Agent#inspect`, `inspectData`, `detect`, `detectRedstone`, `getItemCount`, `getItemSpace`
and `getItemDetail` all return `Promise<void>`. Three of them carry the comment
"Sadly this command does not return any data".

The payload is not missing — it is discarded. Bedrock 1.18.30 moved agent commands to a
dedicated channel:

> Agent-based commands in websockets moved to new "action:agent" format, and all commands
> are now queued and include unique ids to correlate responses

(Minecraft 1.18.30 Bedrock release notes, WebSocket section)

Minecraft answers one agent request with **two frames sharing one requestId**: a
status-only `commandResponse`, then an `action:agent` frame carrying the payload. Today the
second frame never reaches the deserializer, because `action:agent` is absent from
`MessagePurpose` and from the allowlist in `Network#incoming`:

    const deserializablePurposes: MessagePurpose[] = [
      MessagePurpose.CommandResponse, MessagePurpose.Encrypt,
      MessagePurpose.Error, MessagePurpose.Event, MessagePurpose.DataResponse,
    ];
    if (!deserializablePurposes.includes(messagePurpose)) {
      console.error('[Network] Invalid message purpose:', messagePurpose);
      return;
    }

So the frame is logged as "Invalid message purpose" and dropped, and `runCommand` resolves
on the status frame alone.

## Change

- Add `MessagePurpose.AgentAction` and `Packet.AgentActionResponse`, and register an
  `AgentActionResponsePacket` plus handler.
- Correlate the two frames in `Connection`: buffer the `commandResponse` and settle on the
  `action:agent` frame, folding both into an `AgentActionResult`.
- Add `World#runAgentCommand`, and switch the seven `Agent` methods to it.
- Sending needed no change: `Network#send` already honours `overrideMessagePurpose`.

The `action:agent` body field names are not documented, so the body is **passed through
verbatim** as `AgentActionResult.body` rather than mapped onto named properties. Callers can
narrow it with a type argument. This mirrors `CommandResult<T>` and matches how mcpews
types the same frame (`sendAgentCommand<B = unknown>`).

## Edge cases

`Connection` handles frames arriving out of order, a missing `action:agent` frame, an
error frame, and interleaved requestIds. A `commandResponse` with no `action:agent` frame
is reported as `MissingAgentActionError` rather than resolved, so a status-only frame never
looks like a successful empty result. A failing status code rejects immediately instead of
waiting out the timeout.

Also included: `awaitResponse`'s timeout path now deletes its `pendingResponses` entry.
It previously rejected without removing the entry, leaking it whenever a response never
arrived. The buffering added here depends on that cleanup.

## Tests

`test/agent-action.test.mjs` covers 10 cases against `Connection` directly: normal order,
reversed order, missing payload frame, no frames, failing status, error frame, interleaved
requestIds, 100 concurrent commands, unknown requestId, and a non-agent request. These
orderings cannot be produced on demand against a live client.

`tsc --noEmit` clean, `tsdown` builds, `oxlint` reports no new warnings.

## Not verified

The exact field names inside the `action:agent` body are unverified against a live client;
this PR deliberately does not assert them. The Code Connection API documentation describes
`inspect` as returning a block name, but the current key is unconfirmed.
```

### PR 2: `@minecraft/server` を devDependencies へ移す

**Title**: `chore(deps): move @minecraft/server to devDependencies (types only)`

**Body**:
```
`@minecraft/server` is listed in `dependencies`, but it is only ever used for types.

Every import in `src/` is either `import type` or an `import * as _minecraftserver` used
solely inside JSDoc `{@link}` references, so the bundler elides all of them:

    $ grep -c "@minecraft/server" dist/index.cjs   # 0
    $ grep -c "@minecraft/server" dist/index.mjs   # 0
    $ grep -c "@minecraft/server" dist/index.d.cts # 1  (types only)

The runtime requires in `dist/index.cjs` are `@serenityjs/emitter`, `crypto` and `ws` —
nothing else.

Because it sits in `dependencies`, every consumer of `socket-be` installs the package
(761 kB unpacked) even though no code path loads it. Moving it to `devDependencies` keeps
the published types intact while dropping it from consumers' installs.
```

## 実機確定を待つ項目
| 項目 | 影響 |
|---|---|
| `action:agent` body のフィールド名 | 型の絞り込みのみ。**実装は変更不要** |
| `agent inspect` を従来の `commandRequest` で送った場合の後方互換性 | 互換があれば移行が楽。なくても本実装で問題ない |
| `AgentActionType` の実際の値がドキュメントと一致するか | mcpews のソースから取得済み。実機で `action` フィールドを見れば確認できる |

## 適用方法
```bash
git clone https://github.com/Mming-Lab/SocketBE.git
cd SocketBE
git remote add upstream https://github.com/tutinoko2048/SocketBE.git
git fetch upstream && git merge --ff-only upstream/main
git apply /path/to/design/patches/socketbe-phase1.patch
# ビルド（pnpm を親ディレクトリにローカル導入して使う）
node test/agent-action.test.mjs
```
