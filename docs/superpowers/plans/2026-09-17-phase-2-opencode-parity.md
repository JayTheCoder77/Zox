# Phase 2 OpenCode Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Commits:** Do not `git commit` unless Jayant explicitly asks. Commit steps below are checkpoints only.
>
> **Prerequisite:** Phase 1 MVP + skills harness. Phase 1.5 remainder (auto-compact, webfetch, list/resume, durable memory, SDK helpers) is already in this tree — do not reimplement it. `spec/phases.md` checkboxes may still be open; this plan is the Phase 2 list only.

**Goal:** Land OpenCode-parity stretch: optional prune, `task` subagents, file snapshots/revert, TypeScript post-edit LSP, WebSocket permissions, redacted session export, plugin slash commands, container/remote sandbox adapters, `zox agent run`, `zox eval`, extended hooks, and a BM25 `code_search` index.

**Architecture:** Server remains source of truth. New behavior hangs off existing packages (`@zox/context`, `@zox/core`, `@zox/sandbox`, `@zox/hooks`, `@zox/tools`, `@zox/session`, `@zox/server`, `@zox/sdk`, `@zox/cli`). Prune and RAG never stuff indexes into the system prompt. Subagents are nested `runTurn` calls, one level deep, with a summary returned as the parent `task` tool result. Snapshots record pre-write bytes under the session jail. Container/remote are `SandboxAdapter` implementations behind the same path jail + denylist.

**Tech Stack:** Bun workspaces, Zod (`@zox/contracts`), Hono (HTTP + SSE + WebSocket), `bun:sqlite` + FTS5, existing `runTurn` / permission bus, Docker CLI for tier 2, injected remote runner for tier 3 tests.

## Global Constraints

- Runtime: Bun only (`bun install`, `bun run`, `bun test`).
- `cli` and `sdk` depend on `contracts` + HTTP/WS; they do not import `core` at runtime. Tests may import `@zox/server`.
- Style: `createX` factories, `bun:test`, `.ts` import extensions, Zod in contracts, no `any`.
- Do not break Phase 0/1/1.5 tests. Extend them.
- Secrets never persist in session DB, logs, traces (`recordContent=false`), or **exported** transcripts.
- Default sandbox remains `worktree`. `host` / `container` / `remote` are opt-in.
- Model ids stay `provider/model`.
- **phases.md wins** over `tools-extensibility.md` for `task` (Phase 2, not 1.5).
- **Out of scope:** MCP OAuth (parity-matrix-only), `question` / `apply_patch`, plugin hook type (`hooks/*.ts`), keychain, full LSP fleet, hosted cloud, downloading the real SWE-bench dataset.

## Scope note

Phase 2 is twelve capabilities. This is **one plan** because they share the loop, contracts, and CLI. Independent tracks after Task 2:

| Track | Tasks | Can parallelize after |
|-------|-------|------------------------|
| Context | 1 prune | now |
| Hooks | 2 extended events | now |
| Files | 3 snapshots | now |
| Transport | 4 WebSocket | now |
| Slash | 5 plugin commands | now |
| LSP | 6 TypeScript diagnostics | after 3 (snapshot before edit stays valid) |
| Agents | 7 `task` subagent | after 2 |
| Share | 8 export | after 1 (redact + prune-aware transcript) |
| Isolation | 9–10 sandbox + `agent run` | after 3 |
| Eval / RAG | 11–12 | after 10 (eval) / after 7 (`code_search` as a tool) |

---

## File structure

| Path | Responsibility |
|------|----------------|
| `packages/config/src/schema.ts` | `context.prune`, `budget.maxTurns` / `maxUsdPerTask`, `sandbox.envAllowlist` / `network`, `index` / embeddings |
| `packages/context/src/prune.ts` | Prune overlay for provider assembly |
| `packages/contracts/src/events.ts` | `session.exported`, `snapshot.created` optional; keep existing union stable unless a client must observe it |
| `packages/contracts/src/hooks.ts` | Extended hook event names |
| `packages/contracts/src/export.ts` | Export DTO |
| `packages/contracts/src/eval.ts` | Eval result DTO |
| `packages/hooks/src/types.ts` | Same events as contracts |
| `packages/session/src/schema.ts` | v5 `file_snapshots`; v6 `code_chunks` FTS |
| `packages/session/src/snapshots.ts` | Record / list / restore file bytes |
| `packages/core/src/loop.ts` | Permission/PostTool hooks, PostToolBatch, prune on assemble, LSP hook, nested `task` |
| `packages/core/src/agents.ts` | `task` + `code_search` on **build** |
| `packages/tools/src/task.ts` | Subagent tool (delegates to injected `runSubagent`) |
| `packages/tools/src/code_search.ts` | BM25 over indexed chunks |
| `packages/lsp/src/*` | New package: TypeScript `tsc` diagnostics |
| `packages/sandbox/src/adapter.ts` | `SandboxAdapter` interface |
| `packages/sandbox/src/container.ts` | Docker/Podman adapter |
| `packages/sandbox/src/remote.ts` | E2B/Daytona-shaped adapter (injected `exec`) |
| `packages/server/src/ws.ts` | Session WebSocket |
| `packages/server/src/export.ts` | Redacting exporter |
| `packages/server/src/commands-plugin.ts` | `.zox/commands` + `zox.config.ts` slash |
| `packages/cli/src/agent-run.ts` | `zox agent run` |
| `packages/cli/src/eval-run.ts` | `zox eval run` |
| `eval/tasks/*.yaml` | Fixture tasks |
| `packages/server/openapi/openapi.yaml` | New paths |

---

### Task 1: Optional prune policy

**Files:**
- Modify: `packages/config/src/schema.ts`
- Modify: `packages/config/src/load.test.ts`
- Create: `packages/context/src/prune.ts`
- Create: `packages/context/src/prune.test.ts`
- Modify: `packages/context/src/assemble.ts`
- Modify: `packages/context/src/index.ts`
- Modify: `packages/core/src/loop.ts` (`assembleSessionMessages`)

**Interfaces:**
- Consumes: `estimateTokens` from `packages/context/src/estimate.ts`; `StoredMessage` / `ProviderMessage` with `role`, `content`, `name?`
- Produces:

```ts
export const PRUNE_PROTECT_MIN_TOKENS = 40_000;
export const PRUNE_MIN_RECLAIM = 20_000;
export const DEFAULT_PROTECTED_TOOLS = ["skill", "todowrite"] as const;

export type PruneOptions = {
  enabled: boolean;
  protectMinTokens?: number;
  minReclaim?: number;
  protectedTools?: string[];
  estimate?: (text: string) => number;
};

export function pruneToolBodies<T extends {
  role: string;
  content: string;
  name?: string;
}>(messages: T[], opts: PruneOptions): T[];
```

**Locked behavior:**
- Default `context.prune.enabled = false` (off).
- Prune is an **assembly overlay**. SQLite `messages.content` stays full (audit + export).
- Only `role === "tool"` bodies are cleared (`content` becomes `[pruned]`). Keep `name` / `toolCallId`.
- Walk oldest → newest among **unprotected** tool messages. Newest tool output totaling `protectMinTokens` (default 40k estimated tokens) is kept. Older unprotected bodies are candidates.
- If `sum(estimate(candidate.content)) <= minReclaim` (default 20k), return messages unchanged.
- Protected names: `skill`, `todowrite`, plus `context.prune.protectedTools`.
- Plan JSON is session state, not a tool body — already safe.

- [ ] **Step 1: Write the failing config + prune tests**

In `packages/config/src/load.test.ts` add:

```ts
test("parses context.prune fields", () => {
  const parsed = zoxConfigSchema.parse({
    context: {
      overflowThreshold: 0.85,
      prune: {
        enabled: true,
        protectMinTokens: 1000,
        minReclaim: 500,
        protectedTools: ["skill", "webfetch"],
      },
    },
  });
  expect(parsed.context?.prune?.enabled).toBe(true);
  expect(parsed.context?.prune?.protectedTools).toEqual(["skill", "webfetch"]);
});
```

Create `packages/context/src/prune.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { pruneToolBodies } from "./prune.ts";

function estimate(text: string): number {
  return Math.ceil(text.length / 4);
}

describe("pruneToolBodies", () => {
  test("is a no-op when disabled", () => {
    const messages = [
      { role: "tool" as const, name: "bash", content: "x".repeat(100_000) },
    ];
    expect(pruneToolBodies(messages, { enabled: false, estimate })).toEqual(
      messages,
    );
  });

  test("does not prune when reclaimable tokens are below minReclaim", () => {
    const messages = [
      { role: "user" as const, content: "hi" },
      { role: "tool" as const, name: "bash", content: "short" },
    ];
    const out = pruneToolBodies(messages, {
      enabled: true,
      protectMinTokens: 1,
      minReclaim: 20_000,
      estimate,
    });
    expect(out[1]?.content).toBe("short");
  });

  test("clears old unprotected tool bodies and keeps recent + protected", () => {
    const old = "o".repeat(80_000); // 20k tokens
    const recent = "n".repeat(160_000); // 40k tokens
    const skill = "SKILL BODY ".repeat(5000);
    const messages = [
      { role: "tool" as const, name: "bash", content: old },
      { role: "tool" as const, name: "skill", content: skill },
      { role: "tool" as const, name: "grep", content: recent },
    ];
    const out = pruneToolBodies(messages, {
      enabled: true,
      protectMinTokens: 40_000,
      minReclaim: 20_000,
      estimate,
    });
    expect(out[0]?.content).toBe("[pruned]");
    expect(out[1]?.content).toBe(skill);
    expect(out[2]?.content).toBe(recent);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/config/src/load.test.ts packages/context/src/prune.test.ts`

Expected: FAIL — prune schema / module missing.

- [ ] **Step 3: Implement schema + prune + assemble wiring**

Extend `context` in `packages/config/src/schema.ts`:

```ts
context: z
  .object({
    overflowThreshold: z.number().gt(0).lte(1).optional(),
    prune: z
      .object({
        enabled: z.boolean().optional(),
        protectMinTokens: z.number().int().positive().optional(),
        minReclaim: z.number().int().positive().optional(),
        protectedTools: z.array(z.string().min(1)).optional(),
      })
      .optional(),
  })
  .optional(),
```

`packages/context/src/prune.ts`:

```ts
import { estimateTokens } from "./estimate.ts";

export const PRUNE_PROTECT_MIN_TOKENS = 40_000;
export const PRUNE_MIN_RECLAIM = 20_000;
export const DEFAULT_PROTECTED_TOOLS = ["skill", "todowrite"] as const;

export type PruneOptions = {
  enabled: boolean;
  protectMinTokens?: number;
  minReclaim?: number;
  protectedTools?: string[];
  estimate?: (text: string) => number;
};

export function pruneToolBodies<
  T extends { role: string; content: string; name?: string },
>(messages: T[], opts: PruneOptions): T[] {
  if (!opts.enabled) return messages;
  const estimate = opts.estimate ?? estimateTokens;
  const protectMin = opts.protectMinTokens ?? PRUNE_PROTECT_MIN_TOKENS;
  const minReclaim = opts.minReclaim ?? PRUNE_MIN_RECLAIM;
  const protectedNames = new Set([
    ...DEFAULT_PROTECTED_TOOLS,
    ...(opts.protectedTools ?? []),
  ]);

  const toolIndexes: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message?.role !== "tool") continue;
    if (message.name && protectedNames.has(message.name)) continue;
    toolIndexes.push(i);
  }

  let kept = 0;
  const pruneSet = new Set<number>();
  for (let i = toolIndexes.length - 1; i >= 0; i--) {
    const idx = toolIndexes[i]!;
    const tokens = estimate(messages[idx]!.content);
    if (kept < protectMin) {
      kept += tokens;
      continue;
    }
    pruneSet.add(idx);
  }

  let reclaimable = 0;
  for (const idx of pruneSet) {
    reclaimable += estimate(messages[idx]!.content);
  }
  if (reclaimable <= minReclaim) return messages;

  return messages.map((message, index) =>
    pruneSet.has(index) ? { ...message, content: "[pruned]" } : message,
  );
}
```

In `assembleProviderMessages`, after `assembleHistory`, run prune if `session.prune` is passed:

```ts
prune?: PruneOptions;
```

```ts
const history = pruneToolBodies(assembleHistory(session), session.prune ?? {
  enabled: false,
});
```

Thread `prune` from `assembleSessionMessages` in `loop.ts` using session-unrelated config: add `prune?: PruneOptions` to `runTurn` opts (default `{ enabled: false }`). Server reads `config.context?.prune`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/context/src/prune.test.ts packages/config/src/load.test.ts packages/core/src/loop.test.ts packages/context`

Expected: PASS

- [ ] **Step 5: Commit (only if Jayant asks)**

```bash
git add packages/config packages/context packages/core
git commit -m "feat: optional prune overlay for old tool bodies"
```

---

### Task 2: Extended hook events

**Files:**
- Modify: `packages/contracts/src/hooks.ts`
- Modify: `packages/hooks/src/types.ts`
- Modify: `packages/hooks/src/runner.ts` (`CANNOT_DENY`, `HOOK_EVENTS`)
- Modify: `packages/hooks/src/runner.test.ts`
- Modify: `packages/core/src/loop.ts`

**Interfaces:**
- Consumes: existing `hooks.run(event, payload)` — payload must include `matcher` so `createHookRunner` keeps using `matchValueFrom(input.matcher)`.
- Produces: events `PermissionRequest`, `PermissionDenied`, `PostToolUseFailure`, `PostToolBatch`, `UserPromptExpansion`, `SubagentStart`, `SubagentStop` (Subagent* fired in Task 7; types land now).

**Locked behavior:**
- `PermissionRequest` / `PermissionDenied` cannot block (already past / parallel to UI ask). Add both to `CANNOT_DENY`.
- `PostToolUseFailure` cannot block (tool already ran or failed). `CANNOT_DENY`.
- `PostToolBatch` cannot block. Fired once after a model round’s tool list finishes, matcher `*`.
- `UserPromptExpansion` **can** deny (treat like `UserPromptSubmit`). Fire from command dispatch when a slash expands to a prompt (Task 5); loop may no-op if not a slash expansion.
- Matchers: permission events use tool name; batch uses `*`.
- Keep `zoxHooksVersion: 1`. Do not bump unless a field is removed.

- [ ] **Step 1: Write failing runner tests**

```ts
test("runs PermissionRequest and cannot deny", async () => {
  const files = [
    {
      zoxHooksVersion: 1 as const,
      hooks: {
        PermissionRequest: [
          {
            matcher: "bash",
            type: "command" as const,
            command: "true",
          },
        ],
      },
    },
  ];
  // Use a fake command that prints {"decision":"deny"} via a temp script.
});
```

In `runner.test.ts`, write a temp script `deny.sh` that prints `{"decision":"deny"}` and exits 0. Run `runHooks` with `event: "PermissionRequest"`, `matchValue: "bash"`. Expect `decision: "allow"` because `PermissionRequest` is in `CANNOT_DENY`. Repeat with `PostToolUseFailure`. For a block-capable control, `UserPromptExpansion` + same script must stay `deny`.

Add a unit test that `HOOK_EVENTS` includes the seven new names (six plus InstructionsLoaded already present).

Loop test in `packages/core/src/loop.test.ts`: spy `hooks.run` and expect `PermissionRequest` then, on deny from user, `PermissionDenied`. On tool `ok: false`, `PostToolUseFailure`. After two tools in one round, `PostToolBatch` once.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/hooks/src/runner.test.ts packages/core/src/loop.test.ts`

Expected: FAIL — unknown events / missing calls.

- [ ] **Step 3: Implement event union + loop calls**

`packages/contracts/src/hooks.ts` `hookEventSchema`:

```ts
export const hookEventSchema = z.enum([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "Stop",
  "SessionEnd",
  "InstructionsLoaded",
  "PermissionRequest",
  "PermissionDenied",
  "PostToolUseFailure",
  "PostToolBatch",
  "UserPromptExpansion",
  "SubagentStart",
  "SubagentStop",
]);
```

Mirror in `packages/hooks/src/types.ts` `HookEvent` and `HOOK_EVENTS`.

`CANNOT_DENY` add: `PermissionRequest`, `PermissionDenied`, `PostToolUseFailure`, `PostToolBatch`, `SubagentStart`, `SubagentStop`.

In `executeToolCall` when yielding `tool.permission_required`:

```ts
await opts.hooks?.run("PermissionRequest", {
  matcher: call.name,
  tool: { name: call.name, arguments: call.arguments },
  session: { id: opts.session.id, workspaceRoot: opts.session.workspaceRoot },
});
```

When `decision === "deny"` after ask:

```ts
await opts.hooks?.run("PermissionDenied", { matcher: call.name, tool: { name: call.name, arguments: call.arguments }, session: { ... } });
```

After `PostToolUse`, if `!result.ok`:

```ts
await opts.hooks?.run("PostToolUseFailure", { matcher: call.name, tool: { ... }, session: { ... } });
```

After the tool-call `for` loop in the model round (the loop that calls `executeToolCall` for each `toolCalls` item), if `toolCalls.length > 0`:

```ts
await opts.hooks?.run("PostToolBatch", {
  matcher: "*",
  session: { id: opts.session.id, workspaceRoot: opts.session.workspaceRoot },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/hooks packages/core/src/loop.test.ts packages/contracts`

Expected: PASS

- [ ] **Step 5: Commit (only if Jayant asks)**

```bash
git add packages/contracts/src/hooks.ts packages/hooks packages/core/src/loop.ts packages/core/src/loop.test.ts
git commit -m "feat: fire extended permission and post-tool hook events"
```

---

### Task 3: File snapshots + revert

**Files:**
- Modify: `packages/session/src/schema.ts` (SCHEMA_VERSION 5)
- Create: `packages/session/src/snapshots.ts`
- Create: `packages/session/src/snapshots.test.ts`
- Modify: `packages/session/src/index.ts`
- Modify: `packages/tools/src/types.ts` (`onFileMutate?`)
- Modify: `packages/tools/src/write.ts`
- Modify: `packages/tools/src/edit.ts`
- Modify: `packages/core/src/loop.ts` (wire snapshot + LSP later)
- Modify: `packages/server/src/app.ts` (`POST /sessions/:id/revert`, `/revert` command)
- Modify: `packages/server/openapi/openapi.yaml`
- Modify: `packages/sdk/src/client.ts`
- Modify: `packages/cli/src/parse.ts` / `packages/tui/src/slash.ts` (add `revert`)

**Interfaces:**
- Consumes: `jailPath` from `@zox/sandbox`; SQLite from session store
- Produces:

```ts
export type FileSnapshot = {
  id: string;
  sessionId: string;
  path: string;
  createdAt: number;
};

export function recordFileSnapshot(opts: {
  db: Database;
  sessionId: string;
  sandboxRoot: string;
  relativePath: string;
}): Promise<FileSnapshot | { skipped: true }>;

export function restoreSnapshot(opts: {
  db: Database;
  sessionId: string;
  snapshotId?: string; // default: latest for session
  sandboxRoot: string;
}): Promise<{ path: string; snapshotId: string }>;
```

**Locked behavior:**
- Snapshot **before** `write` / `edit` mutates. Missing file → snapshot with empty blob (`created` revert deletes the file).
- Store blobs in SQLite `file_snapshots(id, session_id, path, bytes BLOB, created_at)`.
- Path must pass `jailPath(sandboxRoot, path)`.
- `/revert` with no args restores the latest snapshot for the session. `/revert <id>` restores that row if `session_id` matches.
- Do not rewind transcript messages.

- [ ] **Step 1: Write failing snapshot tests**

```ts
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { migrate } from "./schema.ts";
import { recordFileSnapshot, restoreSnapshot } from "./snapshots.ts";

describe("file snapshots", () => {
  test("records prior bytes and restores them", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-snap-"));
    await writeFile(join(root, "a.txt"), "old");
    const db = new Database(":memory:");
    migrate(db);
    const snap = await recordFileSnapshot({
      db,
      sessionId: "sess_1",
      sandboxRoot: root,
      relativePath: "a.txt",
    });
    if ("skipped" in snap) throw new Error("should record");
    await writeFile(join(root, "a.txt"), "new");
    await restoreSnapshot({
      db,
      sessionId: "sess_1",
      snapshotId: snap.id,
      sandboxRoot: root,
    });
    expect(await Bun.file(join(root, "a.txt")).text()).toBe("old");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/session/src/snapshots.test.ts`

Expected: FAIL — module / v5 table missing.

- [ ] **Step 3: Implement schema, record/restore, tool + HTTP**

v5 migration:

```sql
CREATE TABLE IF NOT EXISTS file_snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  bytes BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

`recordFileSnapshot`: jail path; if file missing, `bytes = Buffer.from("")`; insert row; return `{ id, sessionId, path, createdAt }`.

`restoreSnapshot`: load row; jail `path`; if `bytes.length === 0` `unlink` else `Bun.write`.

`ToolContext.onFileMutate?: (path: string) => Promise<void>` — write/edit call it **before** writing.

Server `createApp` sets `onFileMutate` from Sqlite db when `store` exposes `db` (add `SqliteSessionStore.db` getter if missing; Memory store uses an in-memory Database created in `createApp` tests).

`POST /sessions/:id/revert` body `{ snapshotId?: string }` → 200 `{ path, snapshotId }` or 404.

`dispatchCommand` name `revert` → same.

SDK: `session.revert(snapshotId?: string)`.

OpenAPI: `/sessions/{id}/revert`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/session packages/tools packages/server/src/app.test.ts`

Expected: PASS. Add one `app.test.ts` case: write via tool is not required; call snapshot helper then revert HTTP if easier. Prefer an integration: mock adapter that calls write tool through `runTurn` is heavy — unit snapshots + HTTP restore against a prepared row is enough.

- [ ] **Step 5: Commit (only if Jayant asks)**

```bash
git add packages/session packages/tools packages/server packages/sdk packages/cli packages/tui packages/core
git commit -m "feat: snapshot files before write/edit and restore via /revert"
```

---

### Task 4: WebSocket channel for permissions

**Files:**
- Create: `packages/server/src/ws.ts`
- Create: `packages/server/src/ws.test.ts`
- Modify: `packages/server/src/index.ts` / `app.ts` (upgrade route)
- Modify: `packages/server/openapi/openapi.yaml`
- Modify: `packages/sdk/src/client.ts`
- Create: `packages/sdk/src/ws.test.ts`

**Interfaces:**
- Consumes: `SessionEventBus`, existing `POST /permissions/:requestId` resolver
- Produces:

```ts
export type WsClientMessage = {
  type: "permission.response";
  requestId: string;
  approved: boolean;
};

export function sessionWebSocket(opts: {
  token: string;
  getSession: (id: string) => { id: string } | undefined;
  bus: SessionEventBus;
  respondPermission: (sessionId: string, requestId: string, approved: boolean) => void;
}): (request: Request, server: Bun.Server) => Response | undefined;
```

**Locked behavior:**
- Route: `GET /sessions/:id/ws` with `Authorization: Bearer` **or** `?token=` (browsers). Reject 401/404.
- Server → client: each bus event as a JSON text frame (`ZoxEvent`).
- Client → server: `permission.response` only. Unknown types ignored (do not throw).
- SSE remains the default SDK path. `createZoxClient({ ..., transport: "ws" })` optional; default SSE.
- Same permission map as HTTP POST.

- [ ] **Step 1: Write failing WS test**

Use `Bun.serve` + `new WebSocket(url)`:

```ts
test("permission.response over websocket resolves the ask", async () => {
  // createApp + listen; create session; start a turn that asks write;
  // connect WS; send permission.response approved true;
  // expect tool.completed ok true (or session idle).
});
```

If full loop is heavy, unit-test `sessionWebSocket` with a fake bus: subscribe, publish `tool.permission_required`, send client message, assert `respondPermission` called.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/src/ws.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement upgrade + SDK helper**

Hono/Bun: in `listen()`, `fetch(req, server)` if `pathname.endsWith("/ws")` call `server.upgrade(req, { data: { sessionId, token } })`. `websocket.message` parse JSON.

SDK:

```ts
async connectEvents(sessionId: string): Promise<WebSocket>
```

Document that TUI may keep SSE; this unblocks remote clients that cannot POST while reading SSE.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/server/src/ws.test.ts packages/sdk`

Expected: PASS

- [ ] **Step 5: Commit (only if Jayant asks)**

```bash
git add packages/server packages/sdk
git commit -m "feat: session WebSocket for events and permission replies"
```

---

### Task 5: Plugin slash commands

**Files:**
- Create: `packages/server/src/slash-plugins.ts`
- Create: `packages/server/src/slash-plugins.test.ts`
- Modify: `packages/server/src/app.ts` `dispatchCommand`
- Modify: `packages/core/src/loop.ts` or command path for `UserPromptExpansion`
- Create example: `examples/commands/explain.md`

**Interfaces:**
- Consumes: session `workspaceRoot`; `hooks.run`
- Produces:

```ts
export type SlashPluginResult =
  | { kind: "prompt"; content: string }
  | { kind: "json"; value: unknown }
  | { kind: "unknown" };

export async function resolveCustomSlash(opts: {
  workspaceRoot: string;
  name: string;
  args: string[];
}): Promise<SlashPluginResult>;
```

**Locked behavior (two sources from spec):**
1. **Project markdown:** `.zox/commands/<name>.md` — body is a user-message template. Replace `$ARGUMENTS` with `args.join(" ")`. Result `{ kind: "prompt" }` → server starts a turn with that content (same as `POST /messages`) **or** returns `{ expanded: true, content }` and CLI/TUI send it. Prefer: `dispatchCommand` returns `{ type: "expand", content }` and CLI `executeSlash` calls `session.send(content)` when it sees that shape. Fire `UserPromptExpansion` **before** send; deny → 400.
2. **JS module:** `<workspace>/.zox/zox.config.ts` default export `{ slash?: Record<string, (args: string[]) => string | { json: unknown } | Promise<...>> }`. Load via `await import(pathHref)` once per process (cache). Names must not override built-in `SLASH_NAMES`.

Built-ins always win.

- [ ] **Step 1: Write failing tests**

```ts
test("expands .zox/commands/foo.md with $ARGUMENTS", async () => {
  const root = await mkdtemp(join(tmpdir(), "zox-cmd-"));
  await mkdir(join(root, ".zox/commands"), { recursive: true });
  await writeFile(
    join(root, ".zox/commands/foo.md"),
    "Explain $ARGUMENTS in one sentence.",
  );
  const result = await resolveCustomSlash({
    workspaceRoot: root,
    name: "foo",
    args: ["the parser"],
  });
  expect(result).toEqual({
    kind: "prompt",
    content: "Explain the parser in one sentence.",
  });
});

test("loads slash from zox.config.ts", async () => {
  const root = await mkdtemp(join(tmpdir(), "zox-cfg-"));
  await mkdir(join(root, ".zox"), { recursive: true });
  await writeFile(
    join(root, ".zox/zox.config.ts"),
    `export default { slash: { ping: (args: string[]) => "pong " + args[0] } };`,
  );
  const result = await resolveCustomSlash({
    workspaceRoot: root,
    name: "ping",
    args: ["1"],
  });
  expect(result).toEqual({ kind: "prompt", content: "pong 1" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/server/src/slash-plugins.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement resolver + dispatch**

If `SLASH_NAMES` includes name, skip plugins.

Markdown: `join(workspaceRoot, ".zox/commands", `${name}.md`)` — reject `..` in name.

Config: only `.zox/zox.config.ts` (not arbitrary JS from the internet).

`dispatchCommand`: if plugin prompt, run hooks `UserPromptExpansion` with `prompt: content`, `matcher: name`. On deny return `{ error: reason }` status 400. On allow return `{ type: "expand", content }`.

CLI `executeSlash`: if JSON has `type === "expand"`, `session.send(content)` and print nothing extra.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/server/src/slash-plugins.test.ts packages/cli`

Expected: PASS

- [ ] **Step 5: Commit (only if Jayant asks)**

```bash
git add packages/server packages/cli examples/commands
git commit -m "feat: project markdown and zox.config.ts slash commands"
```

---

### Task 6: LSP post-edit diagnostics (TypeScript first)

**Files:**
- Create: `packages/lsp/package.json`
- Create: `packages/lsp/src/typescript.ts`
- Create: `packages/lsp/src/typescript.test.ts`
- Create: `packages/lsp/src/index.ts`
- Modify: `packages/tools/src/types.ts` (`afterFileMutate?: (path: string) => Promise<string | undefined>`)
- Modify: `packages/tools/src/write.ts` / `edit.ts`
- Modify: root `package.json` workspaces (already `packages/*`)

**Interfaces:**
- Consumes: file path under `sandboxRoot`
- Produces:

```ts
export type LspDiagnostic = {
  file: string;
  line: number;
  character: number;
  message: string;
  code?: string;
};

export async function typescriptDiagnostics(opts: {
  sandboxRoot: string;
  filePath: string;
  exec?: (argv: string[], cwd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}): Promise<LspDiagnostic[]>;

export function formatDiagnostics(diags: LspDiagnostic[]): string;
```

**Locked behavior:**
- Only `.ts` / `.tsx` / `.mts` / `.cts`. Other writes skip LSP.
- Implementation: `bunx tsc --noEmit --pretty false --pretty false` is wrong — use `tsc --noEmit --pretty false -p <sandboxRoot>` if `tsconfig.json` exists, else `tsc --noEmit --pretty false <file>`.
- Timeout 15s. Failures of `tsc` spawn → no throw; return empty list (don’t fail the tool).
- Append to tool result:

```
--- diagnostics (typescript) ---
file:line:col: message
```

- No language-server JSON-RPC in this phase (partial LSP per phases.md).

- [ ] **Step 1: Write failing tests**

```ts
test("parses tsc pretty-false lines", async () => {
  const diags = await typescriptDiagnostics({
    sandboxRoot: "/ws",
    filePath: "/ws/src/a.ts",
    exec: async () => ({
      stdout: "src/a.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'.\n",
      stderr: "",
      exitCode: 2,
    }),
  });
  expect(diags[0]).toMatchObject({
    file: "src/a.ts",
    line: 3,
    character: 1,
    code: "TS2322",
  });
});

test("skips non-ts files", async () => {
  const diags = await typescriptDiagnostics({
    sandboxRoot: "/ws",
    filePath: "/ws/README.md",
    exec: async () => {
      throw new Error("should not spawn");
    },
  });
  expect(diags).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/lsp/src/typescript.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement parser + append**

Regex: `/^(.*)\((\d+),(\d+)\): error (TS\d+): (.*)$/`

`write`/`edit` after successful mutate:

```ts
const extra = await ctx.afterFileMutate?.(jailed.path);
if (extra) content = `${content}\n${extra}`;
```

Server wires `afterFileMutate` → `formatDiagnostics(await typescriptDiagnostics({ sandboxRoot, filePath }))`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/lsp packages/tools`

Expected: PASS

- [ ] **Step 5: Commit (only if Jayant asks)**

```bash
git add packages/lsp packages/tools packages/server
git commit -m "feat: append TypeScript tsc diagnostics after write/edit"
```

---

### Task 7: `task` subagent

**Files:**
- Create: `packages/tools/src/descriptions/task.txt`
- Create: `packages/tools/src/task.ts`
- Create: `packages/tools/src/task.test.ts`
- Modify: `packages/tools/src/builtins.ts`
- Modify: `packages/core/src/agents.ts` (build tools + ask)
- Modify: `packages/core/src/loop.ts`
- Modify: `packages/core/src/loop.test.ts`

**Interfaces:**
- Consumes: `runTurn`, `HookRunner` (`SubagentStart` / `SubagentStop`), `ToolRegistry` without `task`
- Produces:

```ts
// task tool args
{
  prompt: string;
  agent?: "build" | "plan"; // default plan
  description?: string;
}

export type RunSubagent = (input: {
  parent: StoredSession;
  prompt: string;
  agent: "build" | "plan";
}) => Promise<{ ok: boolean; text: string }>;
```

**Locked behavior:**
- **build** profile only. **plan** does not list `task`.
- Permission default **ask**.
- One nesting level: child registry is parent tools **minus** `task`. Child calling `task` is impossible.
- Child session: in-memory copy — `id: createId("sess")`, same `workspaceRoot` / `sandboxRoot` / `model` / `activeSkills` / `planJson` clone, empty `messages`. Do not persist child as a top-level SQLite session unless `store.save` is already called per turn — skip persist (parent-only).
- Fire `SubagentStart` (matcher `task`) then nested `runTurn({ userContent: prompt, ... })` collecting assistant `message.completed` text. Then `SubagentStop`.
- Parent tool result = child final assistant text, truncated with `maxToolOutputChars`.
- Child permission uses the **same** `permission` waiter (TUI/SDK still approve).
- Child usage adds to parent `session.usage`.
- Do not yield child `message.delta` on the parent bus (keeps TUI simple). Parent sees `tool.started` / `tool.completed` only.

- [ ] **Step 1: Write failing tests**

`packages/tools/src/task.test.ts`: tool `execute` without `runSubagent` returns error.

`packages/core/src/loop.test.ts`:

```ts
test("task tool runs a nested plan turn and returns its text", async () => {
  const tools = new ToolRegistry();
  // register read + task; mock router: first parent round tool-call task,
  // child round text-delta "investigated", done;
  // parent second round text "ok", done.
});
```

Use the existing mock adapter `streamChatImpl` style if present; otherwise a fake `TurnRouter` queue.

Assert `hooks.run` names include `SubagentStart` then `SubagentStop`.

Assert a nested tool-call `task` cannot occur because child tools omit it (unit: `createBuiltinTools().filter(t => t.name !== "task")`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/tools/src/task.test.ts packages/core/src/loop.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement tool + nested runTurn**

`task.txt`: “Launch a subagent with a prompt. Use for isolated investigation. agent is plan (default) or build.”

In `executeToolCall`, if `call.name === "task"` after permission/PreToolUse, do not `tools.get("task").execute` with FS — either:

**Preferred:** `task` tool’s `execute` calls `ctx.runSubagent`. Loop sets `runSubagent` on `ToolContext`.

```ts
runSubagent?: RunSubagent;
```

Loop implementation of `runSubagent`:

```ts
async (input) => {
  await opts.hooks?.run("SubagentStart", {
    matcher: "task",
    session: { id: input.parent.id, workspaceRoot: input.parent.workspaceRoot },
    prompt: input.prompt,
  });
  const child = { ...cloneSession(input.parent), id: createId("sess"), agent: input.agent, messages: [], status: "idle" as const };
  const childTools = opts.tools.without("task"); // add ToolRegistry.without
  let text = "";
  for await (const event of runTurn({ ...opts, session: child, userContent: input.prompt, tools: childTools })) {
    if (event.type === "message.completed") text = event.content;
  }
  input.parent.usage.inputTokens += child.usage.inputTokens;
  input.parent.usage.outputTokens += child.usage.outputTokens;
  await opts.hooks?.run("SubagentStop", { matcher: "task", session: { id: input.parent.id, workspaceRoot: input.parent.workspaceRoot } });
  return { ok: true, text };
};
```

`ToolRegistry.without(name)` returns a new registry copy.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/core packages/tools packages/core/src/agents.test.ts`

Expected: PASS. Plan agent still denies `task`.

- [ ] **Step 5: Commit (only if Jayant asks)**

```bash
git add packages/tools packages/core
git commit -m "feat: add one-level task subagent for the build profile"
```

---

### Task 8: Share / export session (redacted)

**Files:**
- Create: `packages/contracts/src/export.ts`
- Create: `packages/server/src/redact.ts`
- Create: `packages/server/src/redact.test.ts`
- Create: `packages/server/src/export-session.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/openapi/openapi.yaml`
- Modify: `packages/sdk/src/client.ts`
- Modify: `packages/cli/src/index.ts` / `parse.ts` (`zox export session <id>`)

**Interfaces:**
- Consumes: `StoredSession`, usage rows; durable memory files **not** included by default
- Produces:

```ts
export const sessionExportSchema = z.object({
  version: z.literal(1),
  session: z.object({
    id: z.string(),
    agent: z.string(),
    model: z.string(),
    status: sessionStatusSchema,
    createdAt: z.number().optional(),
  }),
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.string(),
      name: z.string().optional(),
    }),
  ),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
  }),
  memory: z.array(z.string()).optional(),
});

export function redactSecrets(text: string): string;

export function exportSession(opts: {
  session: StoredSession;
  includeMemory?: boolean;
  readMemory?: () => Promise<string[]>;
}): Promise<z.infer<typeof sessionExportSchema>>;
```

**Locked behavior:**
- Redact: `sk-`/`sk-ant-`/`AIza` prefixes, `Bearer ` tokens, `apiKey` JSON values, env assignments `OPENAI_API_KEY=...`, `ZOXX_SERVER_TOKEN`.
- Replace matches with `[redacted]`.
- `GET /sessions/:id/export?includeMemory=true` — query default false ([memory.md](../../../spec/memory.md)).
- CLI: `zox export session <id> [--include-memory] [--url] [--token]` prints JSON to stdout.
- Exported message content uses **full** SQLite bodies (not prune overlay). Then redact.

- [ ] **Step 1: Write failing redact + export tests**

```ts
test("redacts bearer and openai keys", () => {
  expect(redactSecrets("Authorization: Bearer abc.def")).toContain("[redacted]");
  expect(redactSecrets("OPENAI_API_KEY=sk-123456789")).toContain("[redacted]");
});

test("export omits memory by default", async () => {
  const json = await exportSession({
    session: fakeSession(),
    includeMemory: false,
    readMemory: async () => ["secret fact"],
  });
  expect(json.memory).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/server/src/redact.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement redact, route, CLI**

OpenAPI `GET /sessions/{id}/export`.

SDK `session.export({ includeMemory?: boolean })`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/server packages/sdk packages/cli`

Expected: PASS

- [ ] **Step 5: Commit (only if Jayant asks)**

```bash
git add packages/contracts packages/server packages/sdk packages/cli
git commit -m "feat: export sessions as redacted JSON without memory by default"
```

---

### Task 9: Sandbox tiers 2–3 (container, remote adapters)

**Files:**
- Modify: `packages/sandbox/src/types.ts`
- Create: `packages/sandbox/src/adapter.ts`
- Create: `packages/sandbox/src/container.ts`
- Create: `packages/sandbox/src/container.test.ts`
- Create: `packages/sandbox/src/remote.ts`
- Create: `packages/sandbox/src/remote.test.ts`
- Modify: `packages/sandbox/src/subprocess.ts` (delegate by mode)
- Modify: `packages/config/src/schema.ts` (`sandbox.envAllowlist`, `sandbox.network`)
- Modify: `packages/core/src/agents.ts` / webfetch defaults: tiers 2–3 deny network unless allowlist (webfetch permission deny if mode is container/remote and host not allowlisted)
- Modify: `packages/cli/src/parse.ts` (`--sandbox container|remote`)

**Interfaces:**
- Consumes: existing denylist + `ToolExecutionResult`
- Produces:

```ts
export interface SandboxAdapter {
  readonly mode: "host" | "worktree" | "container" | "remote";
  exec(opts: {
    argv: string[];
    cwd: string;
    env: Record<string, string>;
    timeoutMs: number;
    maxOutputBytes: number;
  }): Promise<ToolExecutionResult>;
}

export function createContainerAdapter(opts: {
  image?: string; // default "docker.io/library/node:22-bookworm"
  dockerBin?: string; // default "docker"
  spawn?: typeof Bun.spawn;
}): SandboxAdapter;

export function createRemoteAdapter(opts: {
  exec: SandboxAdapter["exec"];
}): SandboxAdapter;
```

**Locked behavior:**
- Tier 2: `docker run --rm -v <sandboxRoot>:/workspace:rw -w /workspace --network none` unless `sandbox.network.allowHosts` non-empty then still **no** host `$HOME` mount. Strip env to `sandbox.envAllowlist` or default `PATH,HOME,LANG,USER`.
- If `docker` missing, `exec` returns `{ denied: true, denyReason: "docker unavailable", exitCode: -100 }`.
- Tier 3: **no host FS**. Adapter `exec` is injected (E2B/Daytona). Default production stub returns denied `"remote adapter not configured"` unless `ZOXX_REMOTE_EXEC` module path — **YAGNI:** only injected `exec` in `createApp({ remoteExec })`.
- Path jail still runs **before** adapter on the controller for `host`/`worktree`/`container`. Remote: skip local jail; adapter is the boundary.
- Tests never call real Docker: inject `spawn` that records argv.

- [ ] **Step 1: Write failing adapter tests**

```ts
test("container adapter uses docker run with workspace mount and no network", async () => {
  const argvSeen: string[][] = [];
  const adapter = createContainerAdapter({
    spawn: ((cmd: string[]) => {
      argvSeen.push(cmd);
      return fakeExited(0, "ok", "");
    }) as never,
  });
  await adapter.exec({
    argv: ["bun", "test"],
    cwd: "/ws",
    env: { SECRET: "x", PATH: "/bin" },
    timeoutMs: 1000,
    maxOutputBytes: 1000,
  });
  const dockerArgv = argvSeen[0] ?? [];
  expect(dockerArgv[0]).toBe("docker");
  expect(dockerArgv.join(" ")).toContain("--network none");
  expect(dockerArgv.join(" ")).toContain("/workspace");
});

test("remote adapter delegates to injected exec and does not read host cwd", async () => {
  const adapter = createRemoteAdapter({
    exec: async () => ({
      ok: true,
      exitCode: 0,
      stdout: "remote",
      stderr: "",
      truncated: false,
      timedOut: false,
      denied: false,
      durationMs: 1,
    }),
  });
  const result = await adapter.exec({
    argv: ["echo"],
    cwd: "/should-not-matter",
    env: {},
    timeoutMs: 1,
    maxOutputBytes: 10,
  });
  expect(result.stdout).toBe("remote");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/sandbox/src/container.test.ts packages/sandbox/src/remote.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement adapters + config + CLI flags**

`parseArgs`: `--sandbox` accepts `host | worktree | container | remote`.

`webfetch`: if `session.sandboxMode` is `container` or `remote`, treat as deny unless host in `allowedHosts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/sandbox packages/cli/src/parse.test.ts packages/tools/src/webfetch.test.ts`

Expected: PASS

- [ ] **Step 5: Commit (only if Jayant asks)**

```bash
git add packages/sandbox packages/config packages/cli packages/tools packages/server
git commit -m "feat: add container and remote sandbox adapters"
```

---

### Task 10: `zox agent run` + worktree lifecycle

**Files:**
- Create: `packages/cli/src/agent-run.ts`
- Create: `packages/cli/src/agent-run.test.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/config/src/schema.ts` (`budget.maxTurns`, `budget.maxUsdPerTask`)
- Modify: `packages/core/src/loop.ts` (budget stop)
- Modify: `packages/contracts/src/events.ts` (`budget.exceeded`)
- Modify: `packages/sandbox/src/worktree.ts` if needed (already `cleanup: remove|keep`)

**Interfaces:**
- Consumes: `@zox/sdk` `createZoxClient`, existing session create + send + `waitForIdle`
- Produces: CLI

```
zox agent run <workspace> <task> [--sandbox worktree|container|remote|host] [--max-turns N]
```

**Locked behavior:**
- Capstone: default sandbox for this command is still **worktree** unless `--sandbox remote`. Do not silently switch to remote (keys/network). Document that autonomy **should** pass `--sandbox remote` when configured.
- Create session, `send(task)`, `waitForIdle()`, `session.close()`.
- Exit `0` if last status idle and no `error` event; else `1`.
- `budget.maxTurns` default **50** for this command only (not interactive `zox`). Loop: if turn index > max, yield `budget.exceeded` and stop.
- Worktree: SessionEnd already calls `removeWorktree` based on `cleanup`. For `agent run`, pass `sandbox.worktree.cleanup=remove` unless `--keep-worktree`.
- Non-interactive: if permission would ask, fail (existing REPL fail-closed). `agent run` sets session agent `build` and should use ruleset allow for tests via mock provider without tools, or `--auto-approve` flag that POSTs approve for every `tool.permission_required` (SDK loop). Include `--auto-approve` for CI.

Add event:

```ts
export const budgetExceededEventSchema = z.object({
  type: z.literal("budget.exceeded"),
  sessionId: z.string(),
  reason: z.enum(["max_turns", "max_usd"]),
});
```

Add to `zoxEventSchema` union. Update `events.test.ts`.

- [ ] **Step 1: Write failing parse + loop budget tests**

```ts
test("parseArgs agent run positionals", () => {
  const parsed = parseArgs(["agent", "run", "/tmp/repo", "fix the bug"]);
  expect(parsed.positionals).toEqual(["agent", "run", "/tmp/repo", "fix the bug"]);
});
```

Loop: fake router that always tool-calls `todowrite` would infinite-loop — instead count model rounds with a router that never tool-calls, and set `maxTurns: 0` to fire immediately… Use `maxTurns: 1` and a router that returns tools every time; after 1 completed round of tools+model, stop. Simpler: in `runTurnBody` increment `session.turnCount`; if `opts.maxTurns` set and `turnCount > maxTurns` at start, yield budget.exceeded.

Add `turnCount` on `StoredSession` default 0; increment at start of `runTurnBody`.

Add `usageUsd?: number` on `StoredSession`. When handling `usage.turn`, if `estimatedUsd` is a number, add it. If `opts.maxUsdPerTask` is a number and `usageUsd > maxUsdPerTask`, yield `{ type: "budget.exceeded", reason: "max_usd" }` and idle/stop without another model call. If `estimatedUsd` is always undefined (mock), this branch never fires — that is correct.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/cli/src/agent-run.test.ts packages/core/src/loop.test.ts packages/contracts/src/events.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement CLI + budget + close cleanup**

`agent-run.ts` uses `listen()` or `--url`. Prefer attaching to embedded `createApp` like `embed.ts`.

`--keep-worktree` sets cleanup keep.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/cli packages/core packages/contracts/src/events.test.ts`

Expected: PASS

- [ ] **Step 5: Commit (only if Jayant asks)**

```bash
git add packages/cli packages/core packages/contracts packages/config
git commit -m "feat: add zox agent run with turn budget and worktree cleanup"
```

---

### Task 11: `zox eval` fixture harness

**Files:**
- Create: `packages/contracts/src/eval.ts`
- Create: `packages/cli/src/eval-run.ts`
- Create: `packages/cli/src/eval-run.test.ts`
- Create: `eval/tasks/echo.yaml`
- Create: `eval/tasks/readme.md` — one paragraph: fixtures only; SWE-bench subset is optional extra yaml with `assert.files`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/observability` optional JSON writer

**Interfaces:**
- Consumes: `zox agent run` semantics in-process (do not spawn a nested CLI if tests can call `runEvalTask`)
- Produces:

```ts
export const evalTaskSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  workspace: z.string().optional(), // default: temp copy of fixture dir
  model: z.string().default("mock/echo"),
  expect: z.object({
    stdoutIncludes: z.string().optional(),
    files: z
      .array(z.object({ path: z.string(), contains: z.string() }))
      .optional(),
  }),
});

export type EvalRunSummary = {
  taskId: string;
  pass: boolean;
  turns: number;
  usd: number | null;
  traceId?: string;
};

export async function runEvalTask(task: EvalTask): Promise<EvalRunSummary>;
```

**Locked behavior:**
- `zox eval run [eval/tasks]` loads `*.yaml`, runs sequentially with mock provider unless `--model`.
- pass@1 = `passed / total` printed at end.
- turns = count of `usage.turn` events.
- `$/task` = sum `estimatedUsd` or `null` if unknown.
- Write `eval/results/<taskId>.json` summaries (gitignored).
- SWE-bench subset: **do not** clone SWE-bench. Add `eval/tasks/swe-lite-example.yaml` whose `expect.files` checks a tiny in-repo fixture under `eval/fixtures/swe-lite-example/` (one failing test file + prompt to fix). That is the “subset” for CI.

- [ ] **Step 1: Write failing tests**

```ts
test("echo fixture passes with mock/echo", async () => {
  const summary = await runEvalTask({
    id: "echo",
    prompt: "ping",
    model: "mock/echo",
    expect: { stdoutIncludes: "ping" },
  });
  expect(summary.pass).toBe(true);
  expect(summary.turns).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/eval-run.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement runner**

Start in-process server (copy `client.test.ts` pattern), create session, send prompt, `collectText()`, assert, close.

Aggregate print:

```
pass@1 1/1
turns/task echo=1
$/task echo=n/a
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/cli/src/eval-run.test.ts`

Expected: PASS

- [ ] **Step 5: Commit (only if Jayant asks)**

```bash
git add packages/cli packages/contracts eval .gitignore
git commit -m "feat: add zox eval fixture harness with pass@1 and cost fields"
```

Add `eval/results/` to `.gitignore`.

---

### Task 12: Semantic code index (`code_search`)

**Files:**
- Modify: `packages/session/src/schema.ts` (SCHEMA_VERSION 6)
- Create: `packages/memory/src/code-index.ts`
- Create: `packages/memory/src/code-index.test.ts`
- Create: `packages/tools/src/code_search.ts`
- Create: `packages/tools/src/descriptions/code_search.txt`
- Create: `packages/tools/src/code_search.test.ts`
- Modify: `packages/tools/src/builtins.ts`
- Modify: `packages/core/src/agents.ts` (build + plan: allow `code_search`)
- Modify: `packages/config/src/schema.ts` (`index.embeddings` optional unused)

**Interfaces:**
- Consumes: workspace files + gitignore; FTS5
- Produces:

```ts
export async function indexWorkspace(opts: {
  db: Database;
  workspaceRoot: string;
  sandboxRoot: string;
}): Promise<{ chunks: number }>;

export function searchCode(opts: {
  db: Database;
  query: string;
  limit?: number; // default 8
}): Array<{ path: string; startLine: number; text: string; rank: number }>;
```

**Locked behavior:**
- Hybrid “BM25 + dense” in spec: **BM25/FTS5 only** this phase. Do not call embedding APIs. Config `index.embeddings.apiKeyEnv` may parse and be ignored (comment in schema). Avoid fake vector columns.
- Chunk: ~80 lines, overlap 10, skip `node_modules`, `.git`, `.zox`, binary.
- Tool `code_search` args `{ query: string, limit?: number }`. Permission **allow** for plan and build.
- Not stuffed into system prompt ([memory.md](../../../spec/memory.md)).
- Index on first `code_search` if empty; `POST /index/rebuild` optional YAGNI — skip HTTP unless tests need it. Rebuild inside the tool when `chunks = 0`.

- [ ] **Step 1: Write failing tests**

```ts
test("indexes a ts file and finds a symbol via FTS", async () => {
  const root = await mkdtemp(join(tmpdir(), "zox-idx-"));
  await writeFile(join(root, "hello.ts"), "export function findMe() { return 1 }\n");
  const db = new Database(":memory:");
  migrate(db);
  await indexWorkspace({ db, workspaceRoot: root, sandboxRoot: root });
  const hits = searchCode({ db, query: "findMe" });
  expect(hits[0]?.path).toContain("hello.ts");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/memory/src/code-index.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement FTS table + tool**

```sql
CREATE TABLE IF NOT EXISTS code_chunks (
  id INTEGER PRIMARY KEY,
  workspace_root TEXT NOT NULL,
  path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS code_chunks_fts USING fts5(
  text,
  content='code_chunks',
  content_rowid='id'
);
```

Respect `.gitignore` via `git ls-files` when git exists; else walk with skip dirs.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/memory/src/code-index.test.ts packages/tools/src/code_search.test.ts packages/core/src/agents.test.ts`

Expected: PASS

- [ ] **Step 5: Commit (only if Jayant asks)**

```bash
git add packages/memory packages/session packages/tools packages/core packages/config
git commit -m "feat: add BM25 code_search index without prompt stuffing"
```

---

## Self-review

**1. Spec coverage (Phase 2 checklist in `spec/phases.md`):**

| Requirement | Task |
|-------------|------|
| Optional prune policy | 1 |
| Protected skill (and todowrite) from prune | 1 |
| `task` subagent | 7 |
| File snapshots + revert | 3 |
| LSP post-edit diagnostics (typescript first) | 6 |
| WS channel for permissions | 4 |
| Share/export session (redacted) | 8 |
| Plugin slash commands | 5 |
| Sandbox tier 2–3 | 9 |
| `zox agent run` + worktree lifecycle | 10 |
| `zox eval` pass@1, turns/$, SWE-bench subset | 11 |
| Extended hook events (Permission*, PostToolBatch) | 2 (+ Subagent* in 7, UserPromptExpansion in 5) |
| Semantic code index / RAG | 12 |
| OTel + eval export | 11 writes JSON; existing OTel spans unchanged |
| `budget.maxTurns` / `budget.exceeded` for agent run | 10 |

**Parity matrix extras not in the Phase 2 checkbox list:** MCP OAuth — out of scope.

**2. Placeholder scan:** No TBD. Remote E2B is an injected `exec` (explicit, testable). Dense embeddings deferred with a parsed-but-ignored config field.

**3. Type consistency:**
- `PruneOptions` used in assemble + `runTurn`
- Hook event strings match contracts + `HOOK_EVENTS`
- `SandboxAdapter.exec` → `ToolExecutionResult`
- `RunSubagent` on `ToolContext`
- `budget.exceeded` event `reason: "max_turns" | "max_usd"`
- Export schema version `1`
- `ToolRegistry.without("task")` for children

**4. Gaps closed during review:** `UserPromptExpansion` and `SubagentStart/Stop` are in hooks.md extended list — typed in Task 2, fired in Tasks 5 and 7. `maxUsdPerTask` event reason is defined; enforcement: if `usage.estimatedUsd` sum exceeds config, yield `budget.exceeded` `max_usd` in the same Task 10 loop check (session usage has no USD today — use last `usage.turn.estimatedUsd` accumulation on `StoredSession.usageUsd?: number`, default skip if undefined).
