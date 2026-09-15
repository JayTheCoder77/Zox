# Phase 0 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Commits:** Do not `git commit` unless Jayant explicitly asks. Commit steps below are checkpoints only.

**Goal:** A Bun monorepo where a mock provider completes one chat turn over HTTP and `@zox/sdk` receives SSE `message.delta` events.

**Architecture:** Contract-first. `@zox/contracts` owns Zod event schemas and an OpenAPI stub. `@zox/providers` exposes `ProviderAdapter` (mock + OpenAI). `@zox/core` runs a no-tools agent loop that yields typed events. `@zox/server` is a Hono HTTP+SSE process that is the source of truth. `@zox/sdk` talks HTTP only (never imports `core`). In-memory session store (SQLite is Phase 1).

**Tech Stack:** Bun workspaces, TypeScript (strict), Zod 4.6.x, Hono 4.13.x, Vercel AI SDK (`ai` 7.x + `@ai-sdk/openai` 4.x), Biome 2.x, `bun test`.

## Global Constraints

- Runtime and toolchain: Bun only (`bun install`, `bun run`, `bun test`). No pnpm/npm CLI in scripts.
- Workspaces: root `"workspaces": ["packages/*"]`. Inter-package deps use `workspace:*`. Shared versions use `catalog:`.
- Package names: `@zox/contracts`, `@zox/providers`, `@zox/core`, `@zox/server`, `@zox/sdk`.
- `cli` and `sdk` depend on `contracts` + HTTP only at runtime; they do not import `core`.
- Secrets never persist in session storage or logs; config references env var names.
- Server is source of truth for sessions; clients are thin.
- Auth: `Authorization: Bearer <token>`; token from `ZOXX_SERVER_TOKEN` or generated on start.
- Default bind: `127.0.0.1`.
- Model ids: `provider/model` (example: `openai/gpt-4.1`, `mock/echo`).
- Phase 0 loop: **no tools**. Tool-related event schemas exist in contracts but are not emitted.
- Do not create `packages/cli`, `tui`, `tools`, `sandbox`, `hooks`, `mcp`, `skills`, `session`, `context`, `memory`, `observability` in this phase.
- Do not add SQLite, MCP, TUI, slash commands, compaction, or extra BYOK providers beyond mock + OpenAI.

---

## File structure

| Path | Responsibility |
|------|----------------|
| `package.json` | Private root, workspaces, catalog, scripts (`test`, `lint`, `typecheck`) |
| `tsconfig.json` | Bun-recommended compiler options; project references |
| `biome.json` | Lint + format |
| `.gitignore` | `node_modules`, dist, env files, OS junk |
| `.github/workflows/ci.yml` | `bun install`, lint, typecheck, test |
| `packages/contracts/src/events.ts` | Zod event schemas + `ZoxEvent` union |
| `packages/contracts/src/session.ts` | Session status, create/get DTO schemas |
| `packages/contracts/src/index.ts` | Public exports |
| `packages/server/openapi/openapi.yaml` | OpenAPI 3.1 stub for Phase 0 routes |
| `packages/providers/src/types.ts` | `ProviderAdapter`, `StreamChatParams`, `StreamEvent` |
| `packages/providers/src/mock.ts` | Deterministic mock adapter |
| `packages/providers/src/openai.ts` | OpenAI adapter via AI SDK |
| `packages/providers/src/router.ts` | Select adapter by `provider/` prefix |
| `packages/core/src/loop.ts` | `runTurn` — assemble messages, stream, yield events |
| `packages/core/src/store.ts` | In-memory session store |
| `packages/server/src/app.ts` | Hono app factory |
| `packages/server/src/auth.ts` | Bearer token middleware |
| `packages/server/src/index.ts` | `serve()` entry |
| `packages/sdk/src/client.ts` | `createZoxClient` |
| `packages/sdk/src/sse.ts` | SSE parser |

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.base.json`
- Create: `biome.json`
- Create: `.gitignore`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/scaffold.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing
- Produces: Bun workspaces that resolve `@zox/contracts`; root scripts `test`, `lint`, `typecheck`

- [ ] **Step 1: Write the failing workspace smoke test**

Create `packages/contracts/src/scaffold.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { CONTRACTS_PACKAGE_NAME } from "./index.ts";

describe("monorepo scaffold", () => {
  test("exports the contracts package name", () => {
    expect(CONTRACTS_PACKAGE_NAME).toBe("@zox/contracts");
  });
});
```

Create `packages/contracts/src/index.ts` **without** the export (empty file) so the test fails for the right reason.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/contracts/src/scaffold.test.ts`

Expected: FAIL — `CONTRACTS_PACKAGE_NAME` is not exported / cannot find module export.

If `bun test` itself is missing because there is no `package.json` yet, create the root and contracts `package.json` files first (configuration; TDD exception), then re-run until the failure is the missing export.

Root `package.json`:

```json
{
  "name": "zox",
  "private": true,
  "type": "module",
  "workspaces": {
    "packages": ["packages/*"],
    "catalog": {
      "typescript": "5.9.3",
      "zod": "4.6.5",
      "hono": "4.13.7",
      "ai": "7.0.101",
      "@ai-sdk/openai": "4.0.66",
      "@biomejs/biome": "2.5.13"
    }
  },
  "scripts": {
    "test": "bun test",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "typecheck": "tsc --build --pretty false"
  },
  "devDependencies": {
    "@biomejs/biome": "catalog:",
    "@types/bun": "1.4.2",
    "typescript": "catalog:"
  }
}
```

If `typescript@5.9.3` is not on the registry, pin the latest 5.x that `bun add -d typescript@5` resolves (stay on TypeScript 5 for this phase; do not jump to 7).

`packages/contracts/package.json`:

```json
{
  "name": "@zox/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/bun": "1.4.2",
    "typescript": "catalog:"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "jsx": "react-jsx",
    "allowJs": true,
    "types": ["bun"],
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "composite": true,
    "customConditions": ["@zox/source"]
  }
}
```

Drop `"composite": true` and `"customConditions"` if `tsc --build` complains; keep `strict` and `types: ["bun"]`. Prefer `noEmit: true` plus a root `typecheck` of `"tsc -p tsconfig.json --noEmit"` if project references fight `allowImportingTsExtensions`. **Fallback typecheck script (use this if `--build` fails):** `"typecheck": "tsc -p tsconfig.json --noEmit"`.

`tsconfig.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["packages/*/src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`packages/contracts/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

`biome.json`:

```json
{
  "$schema": "https://biomejs.dev/schemas/2.3.10/schema.json",
  "linter": { "enabled": true },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2 },
  "files": {
    "includes": ["packages/**", "*.json"],
    "ignore": ["node_modules", "bun.lock"]
  }
}
```

If Biome 2.5 rejects `files.ignore`, switch to the version's documented ignore key (`files.experimentalScannerIgnores` or `ignore`).

`.gitignore`:

```
node_modules
*.log
.DS_Store
.env
.env.*
!.env.example
dist
coverage
.turbo
```

Run: `bun install` from repo root.

- [ ] **Step 3: Write minimal implementation**

`packages/contracts/src/index.ts`:

```ts
export const CONTRACTS_PACKAGE_NAME = "@zox/contracts";
```

Update `README.md` to:

```md
# Zox

Bun-first coding agent harness. Spec lives in [`spec/`](./spec/).

## Develop

```sh
bun install
bun test
bun run lint
bun run typecheck
```
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/contracts/src/scaffold.test.ts`

Expected: PASS

Then: `bun test` (PASS, 1+ tests)

- [ ] **Step 5: Commit (only if Jayant asks)**

```bash
git add package.json bun.lock tsconfig.json tsconfig.base.json biome.json .gitignore README.md packages/contracts
git commit -m "chore: scaffold Bun workspaces for Phase 0"
```

---

### Task 2: Event and session contracts

**Files:**
- Create: `packages/contracts/src/events.ts`
- Create: `packages/contracts/src/session.ts`
- Create: `packages/contracts/src/events.test.ts`
- Create: `packages/contracts/src/session.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/package.json` (add `zod: catalog:`)

**Interfaces:**
- Consumes: Task 1 scaffold
- Produces: `zoxEventSchema`, `ZoxEvent`, `sessionStatusSchema`, `createSessionRequestSchema`, `createSessionResponseSchema`, `sessionRecordSchema`

- [ ] **Step 1: Add zod and write failing event tests**

From repo root:

```sh
bun add zod@catalog: --filter @zox/contracts
```

Create `packages/contracts/src/events.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { zoxEventSchema } from "./events.ts";

describe("zoxEventSchema", () => {
  test("parses message.delta", () => {
    const event = zoxEventSchema.parse({
      type: "message.delta",
      sessionId: "sess_1",
      messageId: "msg_1",
      delta: "Hello",
    });
    expect(event.type).toBe("message.delta");
    if (event.type === "message.delta") {
      expect(event.delta).toBe("Hello");
    }
  });

  test("parses session.status idle", () => {
    const event = zoxEventSchema.parse({
      type: "session.status",
      sessionId: "sess_1",
      status: "idle",
    });
    expect(event).toMatchObject({ status: "idle" });
  });

  test("rejects unknown event types", () => {
    const result = zoxEventSchema.safeParse({
      type: "not.a.real.event",
      sessionId: "sess_1",
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/contracts/src/events.test.ts`

Expected: FAIL — `./events.ts` missing or `zoxEventSchema` undefined.

- [ ] **Step 3: Implement event schemas**

`packages/contracts/src/events.ts`:

```ts
import { z } from "zod";

export const sessionStatusSchema = z.enum([
  "idle",
  "running",
  "compacting",
  "awaiting_permission",
  "error",
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const sessionStatusEventSchema = z.object({
  type: z.literal("session.status"),
  sessionId: z.string(),
  status: sessionStatusSchema,
});

export const messageDeltaEventSchema = z.object({
  type: z.literal("message.delta"),
  sessionId: z.string(),
  messageId: z.string(),
  delta: z.string(),
});

export const messageCompletedEventSchema = z.object({
  type: z.literal("message.completed"),
  sessionId: z.string(),
  messageId: z.string(),
  role: z.literal("assistant"),
  content: z.string(),
});

export const toolStartedEventSchema = z.object({
  type: z.literal("tool.started"),
  sessionId: z.string(),
  toolCallId: z.string(),
  name: z.string(),
});

export const toolCompletedEventSchema = z.object({
  type: z.literal("tool.completed"),
  sessionId: z.string(),
  toolCallId: z.string(),
  name: z.string(),
  ok: z.boolean(),
});

export const toolPermissionRequiredEventSchema = z.object({
  type: z.literal("tool.permission_required"),
  sessionId: z.string(),
  requestId: z.string(),
  toolCallId: z.string(),
  name: z.string(),
});

export const usageTurnEventSchema = z.object({
  type: z.literal("usage.turn"),
  sessionId: z.string(),
  turnId: z.string(),
  provider: z.string(),
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
  durationMs: z.number(),
  estimatedUsd: z.number().optional(),
});

export const usageSessionEventSchema = z.object({
  type: z.literal("usage.session"),
  sessionId: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
});

export const contextOverflowEventSchema = z.object({
  type: z.literal("context.overflow"),
  sessionId: z.string(),
  estimatedTokens: z.number(),
});

export const contextCompactedEventSchema = z.object({
  type: z.literal("context.compacted"),
  sessionId: z.string(),
  fromMessageId: z.string(),
  toMessageId: z.string(),
});

export const errorEventSchema = z.object({
  type: z.literal("error"),
  sessionId: z.string().optional(),
  message: z.string(),
  code: z.string().optional(),
});

export const zoxEventSchema = z.discriminatedUnion("type", [
  sessionStatusEventSchema,
  messageDeltaEventSchema,
  messageCompletedEventSchema,
  toolStartedEventSchema,
  toolCompletedEventSchema,
  toolPermissionRequiredEventSchema,
  usageTurnEventSchema,
  usageSessionEventSchema,
  contextOverflowEventSchema,
  contextCompactedEventSchema,
  errorEventSchema,
]);

export type ZoxEvent = z.infer<typeof zoxEventSchema>;
```

- [ ] **Step 4: Run event tests**

Run: `bun test packages/contracts/src/events.test.ts`

Expected: PASS

- [ ] **Step 5: Write failing session DTO tests**

`packages/contracts/src/session.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import {
  createSessionRequestSchema,
  createSessionResponseSchema,
} from "./session.ts";

describe("session DTOs", () => {
  test("create request defaults agent to build", () => {
    const parsed = createSessionRequestSchema.parse({
      workspaceRoot: "/tmp/ws",
    });
    expect(parsed.agent).toBe("build");
    expect(parsed.model).toBe("mock/echo");
  });

  test("create response requires id and idle status", () => {
    const parsed = createSessionResponseSchema.parse({
      id: "sess_1",
      workspaceRoot: "/tmp/ws",
      agent: "build",
      model: "mock/echo",
      status: "idle",
    });
    expect(parsed.id).toBe("sess_1");
  });
});
```

- [ ] **Step 6: Run session tests to verify they fail**

Run: `bun test packages/contracts/src/session.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 7: Implement session DTOs**

`packages/contracts/src/session.ts`:

```ts
import { z } from "zod";
import { sessionStatusSchema } from "./events.ts";

export const createSessionRequestSchema = z.object({
  workspaceRoot: z.string().min(1),
  agent: z.string().default("build"),
  model: z.string().default("mock/echo"),
});
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export const createSessionResponseSchema = z.object({
  id: z.string(),
  workspaceRoot: z.string(),
  agent: z.string(),
  model: z.string(),
  status: sessionStatusSchema,
});
export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>;

export const sendMessageRequestSchema = z.object({
  content: z.string().min(1),
});
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const sessionRecordSchema = createSessionResponseSchema;
export type SessionRecord = CreateSessionResponse;
```

Export from `packages/contracts/src/index.ts`:

```ts
export const CONTRACTS_PACKAGE_NAME = "@zox/contracts";
export * from "./events.ts";
export * from "./session.ts";
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun test packages/contracts`

Expected: PASS (scaffold + events + session)

- [ ] **Step 9: Commit (only if Jayant asks)**

```bash
git add packages/contracts package.json bun.lock
git commit -m "feat: add Zod session and SSE event contracts"
```

---

### Task 3: OpenAPI stub

**Files:**
- Create: `packages/server/openapi/openapi.yaml`
- Create: `packages/server/package.json`
- Create: `packages/server/src/openapi-stub.test.ts`

**Interfaces:**
- Consumes: paths from `spec/clients.md` Phase 0 subset
- Produces: OpenAPI 3.1 document covering `POST /sessions`, `GET /sessions/{id}`, `POST /sessions/{id}/messages`, `GET /sessions/{id}/events`

Phase 0 implements only those four routes. Other client.md routes stay documented as later (`x-zox-phase: 1`) so the stub is the living contract.

- [ ] **Step 1: Write failing test that the OpenAPI file exists and lists Phase 0 paths**

`packages/server/src/openapi-stub.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const yaml = readFileSync(
  join(import.meta.dir, "../openapi/openapi.yaml"),
  "utf8",
);

describe("openapi stub", () => {
  test("declares OpenAPI 3.1", () => {
    expect(yaml).toContain("openapi: 3.1.0");
  });

  test("includes Phase 0 session routes", () => {
    expect(yaml).toContain("/sessions:");
    expect(yaml).toContain("/sessions/{id}:");
    expect(yaml).toContain("/sessions/{id}/messages:");
    expect(yaml).toContain("/sessions/{id}/events:");
  });

  test("uses Bearer auth", () => {
    expect(yaml).toContain("bearerAuth:");
    expect(yaml).toContain("Bearer");
  });
});
```

`packages/server/package.json`:

```json
{
  "name": "@zox/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@zox/contracts": "workspace:*",
    "@zox/core": "workspace:*",
    "hono": "catalog:"
  },
  "devDependencies": {
    "@types/bun": "1.4.2",
    "typescript": "catalog:"
  }
}
```

Do **not** add `@zox/core` until Task 5 if `bun install` fails on a missing workspace. Until then, omit the `core` dependency and add it in Task 6.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/server/src/openapi-stub.test.ts`

Expected: FAIL — ENOENT `openapi.yaml`

- [ ] **Step 3: Write OpenAPI stub**

`packages/server/openapi/openapi.yaml`:

```yaml
openapi: 3.1.0
info:
  title: Zox Server API
  version: 0.0.0
servers:
  - url: http://127.0.0.1:8787
security:
  - bearerAuth: []
paths:
  /sessions:
    post:
      summary: Create session
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateSessionRequest"
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Session"
  /sessions/{id}:
    get:
      summary: Session metadata + status
      parameters:
        - $ref: "#/components/parameters/SessionId"
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Session"
        "404":
          description: Not found
  /sessions/{id}/messages:
    post:
      summary: Send user message (starts turn)
      parameters:
        - $ref: "#/components/parameters/SessionId"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/SendMessageRequest"
      responses:
        "202":
          description: Turn accepted
        "409":
          description: Session not idle
  /sessions/{id}/events:
    get:
      summary: SSE event stream
      parameters:
        - $ref: "#/components/parameters/SessionId"
      responses:
        "200":
          description: text/event-stream of ZoxEvent
          content:
            text/event-stream:
              schema:
                type: string
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
  parameters:
    SessionId:
      name: id
      in: path
      required: true
      schema:
        type: string
  schemas:
    CreateSessionRequest:
      type: object
      required: [workspaceRoot]
      properties:
        workspaceRoot:
          type: string
        agent:
          type: string
          default: build
        model:
          type: string
          default: mock/echo
    SendMessageRequest:
      type: object
      required: [content]
      properties:
        content:
          type: string
    Session:
      type: object
      required: [id, workspaceRoot, agent, model, status]
      properties:
        id:
          type: string
        workspaceRoot:
          type: string
        agent:
          type: string
        model:
          type: string
        status:
          type: string
          enum: [idle, running, compacting, awaiting_permission, error]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/server/src/openapi-stub.test.ts`

Expected: PASS

- [ ] **Step 5: Commit (only if Jayant asks)**

```bash
git add packages/server
git commit -m "feat: add OpenAPI 3.1 stub for Phase 0 session routes"
```

---

### Task 4: Provider types and mock adapter

**Files:**
- Create: `packages/providers/package.json`
- Create: `packages/providers/src/types.ts`
- Create: `packages/providers/src/mock.ts`
- Create: `packages/providers/src/mock.test.ts`
- Create: `packages/providers/src/index.ts`

**Interfaces:**
- Consumes: nothing from core
- Produces:

```ts
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type StreamChatParams = {
  model: string;
  messages: ChatMessage[];
  abortSignal?: AbortSignal;
};

export type StreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "error"; message: string }
  | { type: "done" };

export interface ProviderAdapter {
  id: string;
  streamChat(params: StreamChatParams): AsyncIterable<StreamEvent>;
}
```

- [ ] **Step 1: Write failing mock adapter tests**

`packages/providers/package.json`:

```json
{
  "name": "@zox/providers",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "devDependencies": {
    "@types/bun": "1.4.2",
    "typescript": "catalog:"
  }
}
```

`packages/providers/src/mock.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createMockAdapter } from "./mock.ts";

async function collect(iter: AsyncIterable<{ type: string }>) {
  const items = [];
  for await (const item of iter) items.push(item);
  return items;
}

describe("createMockAdapter", () => {
  test("streams the last user message as text-delta then usage and done", async () => {
    const adapter = createMockAdapter();
    expect(adapter.id).toBe("mock");
    const events = await collect(
      adapter.streamChat({
        model: "echo",
        messages: [{ role: "user", content: "ping" }],
      }),
    );
    expect(events).toEqual([
      { type: "text-delta", text: "ping" },
      { type: "usage", inputTokens: 1, outputTokens: 1 },
      { type: "done" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/providers/src/mock.test.ts`

Expected: FAIL — `createMockAdapter` not defined.

- [ ] **Step 3: Implement types + mock**

`packages/providers/src/types.ts`:

```ts
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type StreamChatParams = {
  model: string;
  messages: ChatMessage[];
  abortSignal?: AbortSignal;
};

export type StreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "error"; message: string }
  | { type: "done" };

export interface ProviderAdapter {
  id: string;
  streamChat(params: StreamChatParams): AsyncIterable<StreamEvent>;
}
```

`packages/providers/src/mock.ts`:

```ts
import type { ProviderAdapter, StreamChatParams, StreamEvent } from "./types.ts";

export function createMockAdapter(): ProviderAdapter {
  return {
    id: "mock",
    async *streamChat(params: StreamChatParams): AsyncIterable<StreamEvent> {
      const lastUser = [...params.messages]
        .reverse()
        .find((message) => message.role === "user");
      const text = lastUser?.content ?? "";
      yield { type: "text-delta", text };
      yield { type: "usage", inputTokens: 1, outputTokens: 1 };
      yield { type: "done" };
    },
  };
}
```

`packages/providers/src/index.ts`:

```ts
export type {
  ChatMessage,
  ProviderAdapter,
  StreamChatParams,
  StreamEvent,
} from "./types.ts";
export { createMockAdapter } from "./mock.ts";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/providers/src/mock.test.ts`

Expected: PASS

- [ ] **Step 5: Commit (only if Jayant asks)**

```bash
git add packages/providers
git commit -m "feat: add mock provider adapter"
```

---

### Task 5: OpenAI adapter + provider router

**Files:**
- Create: `packages/providers/src/openai.ts`
- Create: `packages/providers/src/openai.test.ts`
- Create: `packages/providers/src/router.ts`
- Create: `packages/providers/src/router.test.ts`
- Modify: `packages/providers/package.json`
- Modify: `packages/providers/src/index.ts`

**Interfaces:**
- Consumes: `ProviderAdapter` from Task 4
- Produces: `createOpenAIAdapter({ apiKey, streamChatImpl? })`, `createProviderRouter({ adapters })`, `parseModelRef(modelRef) => { providerId, modelId }`

Auth resolution for the adapter itself: `apiKey` argument required. Env lookup (`OPENAI_API_KEY`) happens in the server factory (Task 7), not inside the adapter, so tests never touch process env.

- [ ] **Step 1: Write failing parse + router tests**

`packages/providers/src/router.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createMockAdapter } from "./mock.ts";
import { createProviderRouter, parseModelRef } from "./router.ts";

describe("parseModelRef", () => {
  test("splits provider/model", () => {
    expect(parseModelRef("openai/gpt-4.1")).toEqual({
      providerId: "openai",
      modelId: "gpt-4.1",
    });
  });

  test("keeps extra slashes in the model id", () => {
    expect(parseModelRef("openrouter/anthropic/claude-3.5-sonnet")).toEqual({
      providerId: "openrouter",
      modelId: "anthropic/claude-3.5-sonnet",
    });
  });
});

describe("createProviderRouter", () => {
  test("routes mock/echo to the mock adapter", async () => {
    const router = createProviderRouter({
      adapters: [createMockAdapter()],
    });
    const adapter = router.resolve("mock/echo");
    expect(adapter.id).toBe("mock");
    const first = (await router.streamChat({
      model: "mock/echo",
      messages: [{ role: "user", content: "hi" }],
    })[Symbol.asyncIterator]().next()).value;
    expect(first).toEqual({ type: "text-delta", text: "hi" });
  });

  test("throws on unknown provider", () => {
    const router = createProviderRouter({ adapters: [createMockAdapter()] });
    expect(() => router.resolve("missing/x")).toThrow(/unknown provider/i);
  });
});
```

Simplify the stream assertion if the iterator dance is awkward — collect events instead:

```ts
const events = [];
for await (const event of router.streamChat({
  model: "mock/echo",
  messages: [{ role: "user", content: "hi" }],
})) {
  events.push(event);
}
expect(events[0]).toEqual({ type: "text-delta", text: "hi" });
```

`ProviderRouter` shape:

```ts
export type ProviderRouter = {
  resolve(modelRef: string): ProviderAdapter;
  streamChat(params: StreamChatParams & { model: string }): AsyncIterable<StreamEvent>;
};
```

`streamChat` on the router must pass `modelId` (suffix) into the adapter, not the full `provider/model` ref.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/providers/src/router.test.ts`

Expected: FAIL — `parseModelRef` missing.

- [ ] **Step 3: Implement router**

`packages/providers/src/router.ts`:

```ts
import type { ProviderAdapter, StreamChatParams, StreamEvent } from "./types.ts";

export function parseModelRef(modelRef: string): {
  providerId: string;
  modelId: string;
} {
  const slash = modelRef.indexOf("/");
  if (slash <= 0 || slash === modelRef.length - 1) {
    throw new Error(`Invalid model id: ${modelRef}`);
  }
  return {
    providerId: modelRef.slice(0, slash),
    modelId: modelRef.slice(slash + 1),
  };
}

export function createProviderRouter(opts: {
  adapters: ProviderAdapter[];
}): {
  resolve(modelRef: string): ProviderAdapter;
  streamChat(params: StreamChatParams): AsyncIterable<StreamEvent>;
} {
  const byId = new Map(opts.adapters.map((adapter) => [adapter.id, adapter]));
  const resolve = (modelRef: string) => {
    const { providerId } = parseModelRef(modelRef);
    const adapter = byId.get(providerId);
    if (!adapter) {
      throw new Error(`Unknown provider: ${providerId}`);
    }
    return adapter;
  };
  return {
    resolve,
    streamChat(params: StreamChatParams): AsyncIterable<StreamEvent> {
      const adapter = resolve(params.model);
      const { modelId } = parseModelRef(params.model);
      return adapter.streamChat({ ...params, model: modelId });
    },
  };
}
```

- [ ] **Step 4: Run router tests**

Run: `bun test packages/providers/src/router.test.ts`

Expected: PASS

- [ ] **Step 5: Write failing OpenAI adapter test (injected stream, no network)**

`packages/providers/src/openai.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createOpenAIAdapter } from "./openai.ts";
import type { StreamEvent } from "./types.ts";

describe("createOpenAIAdapter", () => {
  test("maps injected stream chunks to StreamEvent", async () => {
    async function* fakeStream(): AsyncIterable<StreamEvent> {
      yield { type: "text-delta", text: "ok" };
      yield { type: "usage", inputTokens: 2, outputTokens: 1 };
      yield { type: "done" };
    }
    const adapter = createOpenAIAdapter({
      apiKey: "sk-test",
      streamChatImpl: fakeStream,
    });
    expect(adapter.id).toBe("openai");
    const events: StreamEvent[] = [];
    for await (const event of adapter.streamChat({
      model: "gpt-4.1",
      messages: [{ role: "user", content: "hi" }],
    })) {
      events.push(event);
    }
    expect(events).toEqual([
      { type: "text-delta", text: "ok" },
      { type: "usage", inputTokens: 2, outputTokens: 1 },
      { type: "done" },
    ]);
  });
});
```

- [ ] **Step 6: Run OpenAI test to verify it fails**

Run: `bun test packages/providers/src/openai.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 7: Implement OpenAI adapter**

Add deps:

```sh
bun add ai@catalog: @ai-sdk/openai@catalog: --filter @zox/providers
```

`packages/providers/src/openai.ts`:

```ts
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";
import type { ProviderAdapter, StreamChatParams, StreamEvent } from "./types.ts";

export type OpenAIAdapterOptions = {
  apiKey: string;
  streamChatImpl?: (
    params: StreamChatParams,
  ) => AsyncIterable<StreamEvent>;
};

export function createOpenAIAdapter(
  options: OpenAIAdapterOptions,
): ProviderAdapter {
  return {
    id: "openai",
    streamChat(params: StreamChatParams): AsyncIterable<StreamEvent> {
      if (options.streamChatImpl) {
        return options.streamChatImpl(params);
      }
      return streamViaAiSdk(params, options.apiKey);
    },
  };
}

async function* streamViaAiSdk(
  params: StreamChatParams,
  apiKey: string,
): AsyncIterable<StreamEvent> {
  const result = streamText({
    model: openai(params.model),
    messages: params.messages,
    abortSignal: params.abortSignal,
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") {
      const text =
        "text" in part && typeof part.text === "string"
          ? part.text
          : "delta" in part && typeof part.delta === "string"
            ? part.delta
            : "";
      if (text) yield { type: "text-delta", text };
    } else if (part.type === "finish") {
      const usage =
        "totalUsage" in part
          ? part.totalUsage
          : "usage" in part
            ? part.usage
            : undefined;
      const inputTokens =
        usage && typeof usage === "object" && "inputTokens" in usage
          ? Number(usage.inputTokens ?? 0)
          : 0;
      const outputTokens =
        usage && typeof usage === "object" && "outputTokens" in usage
          ? Number(usage.outputTokens ?? 0)
          : 0;
      yield { type: "usage", inputTokens, outputTokens };
    } else if (part.type === "error") {
      const message =
        "error" in part ? String(part.error) : "OpenAI stream error";
      yield { type: "error", message };
    }
  }
  yield { type: "done" };
}
```

If `openai()` ignores `headers` and wants `createOpenAI({ apiKey })`, use that instead:

```ts
import { createOpenAI } from "@ai-sdk/openai";
const client = createOpenAI({ apiKey });
model: client(params.model);
```

Prefer `createOpenAI({ apiKey })`. Adjust the implementation to whatever the installed `@ai-sdk/openai` exports; keep `streamChatImpl` as the test seam so unit tests never call the network.

- [ ] **Step 8: Run provider tests**

Run: `bun test packages/providers`

Expected: PASS

Export router + openai from `index.ts`.

- [ ] **Step 9: Commit (only if Jayant asks)**

```bash
git add packages/providers package.json bun.lock
git commit -m "feat: add OpenAI adapter and provider router"
```

---

### Task 6: Core loop (no tools) + in-memory store

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/src/ids.ts`
- Create: `packages/core/src/store.ts`
- Create: `packages/core/src/store.test.ts`
- Create: `packages/core/src/loop.ts`
- Create: `packages/core/src/loop.test.ts`
- Create: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `ZoxEvent` from `@zox/contracts`; `ProviderRouter` from `@zox/providers`
- Produces:

```ts
type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
};

type StoredSession = {
  id: string;
  workspaceRoot: string;
  agent: string;
  model: string;
  status: SessionStatus;
  messages: StoredMessage[];
};

class MemorySessionStore {
  create(input: CreateSessionRequest): StoredSession;
  get(id: string): StoredSession | undefined;
  update(id: string, patch: Partial<Pick<StoredSession, "status" | "messages">>): StoredSession;
}

function runTurn(opts: {
  session: StoredSession;
  userContent: string;
  router: { streamChat(params: StreamChatParams): AsyncIterable<StreamEvent> };
  now?: () => number;
  ids?: { messageId(): string; turnId(): string };
}): AsyncIterable<ZoxEvent>;
```

`runTurn` must:
1. Append the user message to `session.messages`.
2. Yield `session.status` with `running`.
3. Call `router.streamChat` with session `model` and messages mapped to `{ role, content }`.
4. Yield `message.delta` for each `text-delta`.
5. Yield `usage.turn` when usage arrives (or zeros if none).
6. Append assistant message; yield `message.completed`.
7. Yield `session.status` with `idle`.
8. On provider `error`, yield `error` and `session.status` `error`.

- [ ] **Step 1: Write failing store tests**

`packages/core/package.json`:

```json
{
  "name": "@zox/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@zox/contracts": "workspace:*",
    "@zox/providers": "workspace:*"
  },
  "devDependencies": {
    "@types/bun": "1.4.2",
    "typescript": "catalog:"
  }
}
```

`packages/core/src/store.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { MemorySessionStore } from "./store.ts";

describe("MemorySessionStore", () => {
  test("creates an idle session", () => {
    const store = new MemorySessionStore();
    const session = store.create({
      workspaceRoot: "/tmp/ws",
      agent: "build",
      model: "mock/echo",
    });
    expect(session.status).toBe("idle");
    expect(session.messages).toEqual([]);
    expect(store.get(session.id)?.id).toBe(session.id);
  });

  test("returns undefined for unknown ids", () => {
    const store = new MemorySessionStore();
    expect(store.get("missing")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run store tests to verify they fail**

Run: `bun test packages/core/src/store.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement store**

`packages/core/src/ids.ts`:

```ts
export function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
```

`packages/core/src/store.ts`:

```ts
import type { CreateSessionRequest, SessionStatus } from "@zox/contracts";
import { createId } from "./ids.ts";

export type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
};

export type StoredSession = {
  id: string;
  workspaceRoot: string;
  agent: string;
  model: string;
  status: SessionStatus;
  messages: StoredMessage[];
};

export class MemorySessionStore {
  #sessions = new Map<string, StoredSession>();

  create(input: CreateSessionRequest): StoredSession {
    const session: StoredSession = {
      id: createId("sess"),
      workspaceRoot: input.workspaceRoot,
      agent: input.agent,
      model: input.model,
      status: "idle",
      messages: [],
    };
    this.#sessions.set(session.id, session);
    return session;
  }

  get(id: string): StoredSession | undefined {
    return this.#sessions.get(id);
  }

  update(
    id: string,
    patch: Partial<Pick<StoredSession, "status" | "messages">>,
  ): StoredSession {
    const current = this.#sessions.get(id);
    if (!current) {
      throw new Error(`Unknown session: ${id}`);
    }
    const next = { ...current, ...patch };
    this.#sessions.set(id, next);
    return next;
  }
}
```

- [ ] **Step 4: Run store tests**

Run: `bun test packages/core/src/store.test.ts`

Expected: PASS

- [ ] **Step 5: Write failing loop tests**

`packages/core/src/loop.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createMockAdapter, createProviderRouter } from "@zox/providers";
import { runTurn } from "./loop.ts";
import type { StoredSession } from "./store.ts";

function session(): StoredSession {
  return {
    id: "sess_1",
    workspaceRoot: "/tmp/ws",
    agent: "build",
    model: "mock/echo",
    status: "idle",
    messages: [],
  };
}

describe("runTurn", () => {
  test("yields running, deltas, usage, completed, idle", async () => {
    const router = createProviderRouter({ adapters: [createMockAdapter()] });
    const events = [];
    for await (const event of runTurn({
      session: session(),
      userContent: "ping",
      router,
      ids: { messageId: () => "msg_asst", turnId: () => "turn_1" },
    })) {
      events.push(event);
    }
    expect(events.map((event) => event.type)).toEqual([
      "session.status",
      "message.delta",
      "usage.turn",
      "message.completed",
      "session.status",
    ]);
    expect(events[1]).toMatchObject({
      type: "message.delta",
      delta: "ping",
      messageId: "msg_asst",
    });
    expect(events.at(-1)).toMatchObject({ type: "session.status", status: "idle" });
  });
});
```

- [ ] **Step 6: Run loop test to verify it fails**

Run: `bun test packages/core/src/loop.test.ts`

Expected: FAIL — `runTurn` missing.

- [ ] **Step 7: Implement runTurn**

`packages/core/src/loop.ts`:

```ts
import type { ZoxEvent } from "@zox/contracts";
import type { StreamChatParams, StreamEvent } from "@zox/providers";
import { createId } from "./ids.ts";
import type { StoredSession } from "./store.ts";

export type TurnRouter = {
  streamChat(params: StreamChatParams): AsyncIterable<StreamEvent>;
};

export async function* runTurn(opts: {
  session: StoredSession;
  userContent: string;
  router: TurnRouter;
  ids?: { messageId(): string; turnId(): string };
}): AsyncIterable<ZoxEvent> {
  const messageId = opts.ids?.messageId() ?? createId("msg");
  const turnId = opts.ids?.turnId() ?? createId("turn");
  const userId = createId("msg");
  opts.session.messages.push({
    id: userId,
    role: "user",
    content: opts.userContent,
  });
  opts.session.status = "running";
  yield {
    type: "session.status",
    sessionId: opts.session.id,
    status: "running",
  };

  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let sawUsage = false;
  const started = Date.now();

  try {
    for await (const part of opts.router.streamChat({
      model: opts.session.model,
      messages: opts.session.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    })) {
      if (part.type === "text-delta") {
        text += part.text;
        yield {
          type: "message.delta",
          sessionId: opts.session.id,
          messageId,
          delta: part.text,
        };
      } else if (part.type === "usage") {
        sawUsage = true;
        inputTokens = part.inputTokens;
        outputTokens = part.outputTokens;
      } else if (part.type === "error") {
        opts.session.status = "error";
        yield {
          type: "error",
          sessionId: opts.session.id,
          message: part.message,
        };
        yield {
          type: "session.status",
          sessionId: opts.session.id,
          status: "error",
        };
        return;
      }
    }
  } catch (error) {
    opts.session.status = "error";
    yield {
      type: "error",
      sessionId: opts.session.id,
      message: error instanceof Error ? error.message : String(error),
    };
    yield {
      type: "session.status",
      sessionId: opts.session.id,
      status: "error",
    };
    return;
  }

  const { providerId } = splitProvider(opts.session.model);
  yield {
    type: "usage.turn",
    sessionId: opts.session.id,
    turnId,
    provider: providerId,
    model: opts.session.model,
    inputTokens: sawUsage ? inputTokens : 0,
    outputTokens: sawUsage ? outputTokens : 0,
    durationMs: Date.now() - started,
  };

  opts.session.messages.push({
    id: messageId,
    role: "assistant",
    content: text,
  });
  opts.session.status = "idle";
  yield {
    type: "message.completed",
    sessionId: opts.session.id,
    messageId,
    role: "assistant",
    content: text,
  };
  yield {
    type: "session.status",
    sessionId: opts.session.id,
    status: "idle",
  };
}

function splitProvider(modelRef: string): { providerId: string } {
  const slash = modelRef.indexOf("/");
  return { providerId: slash === -1 ? modelRef : modelRef.slice(0, slash) };
}
```

`packages/core/src/index.ts`:

```ts
export { MemorySessionStore, type StoredSession, type StoredMessage } from "./store.ts";
export { runTurn, type TurnRouter } from "./loop.ts";
export { createId } from "./ids.ts";
```

- [ ] **Step 8: Run core tests**

Run: `bun test packages/core`

Expected: PASS

- [ ] **Step 9: Commit (only if Jayant asks)**

```bash
git add packages/core
git commit -m "feat: add no-tools agent loop and in-memory session store"
```

---

### Task 7: Hono server (POST message + SSE)

**Files:**
- Create: `packages/server/src/auth.ts`
- Create: `packages/server/src/auth.test.ts`
- Create: `packages/server/src/bus.ts`
- Create: `packages/server/src/app.ts`
- Create: `packages/server/src/app.test.ts`
- Create: `packages/server/src/index.ts`
- Modify: `packages/server/package.json` (ensure `@zox/core`, `@zox/providers`, `hono`)

**Interfaces:**
- Consumes: `runTurn`, `MemorySessionStore`, `createProviderRouter`, `createMockAdapter`
- Produces: `createApp({ token, store, router }) => Hono`; routes as OpenAPI stub

SSE encoding:

```
id: <monotonic>
event: <ZoxEvent.type>
data: <JSON.stringify(ZoxEvent)>

```

`POST /sessions/{id}/messages` returns `202` immediately and runs `runTurn` in the background, publishing events to an in-process bus keyed by session id. `GET /events` subscribes to that bus. If the client connects after some events, replay buffered events for that session (buffer the current turn).

Reject `POST /messages` with `409` when `status !== "idle"`.

- [ ] **Step 1: Write failing auth tests**

`packages/server/src/auth.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { bearerAuth } from "./auth.ts";

describe("bearerAuth", () => {
  const app = new Hono();
  app.use("*", bearerAuth("secret"));
  app.get("/ping", (c) => c.json({ ok: true }));

  test("rejects missing token", async () => {
    const res = await app.request("/ping");
    expect(res.status).toBe(401);
  });

  test("accepts matching bearer token", async () => {
    const res = await app.request("/ping", {
      headers: { Authorization: "Bearer secret" },
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run auth test to verify it fails**

Run: `bun test packages/server/src/auth.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement auth**

```sh
bun add hono@catalog: --filter @zox/server
```

`packages/server/src/auth.ts`:

```ts
import { createMiddleware } from "hono/factory";

export function bearerAuth(token: string) {
  return createMiddleware(async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const expected = `Bearer ${token}`;
    if (header !== expected) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });
}
```

If `hono/factory` is unavailable, use a plain `(c, next) => ...` middleware.

- [ ] **Step 4: Run auth tests**

Run: `bun test packages/server/src/auth.test.ts`

Expected: PASS

- [ ] **Step 5: Write failing HTTP+SSE integration test**

`packages/server/src/app.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { createMockAdapter, createProviderRouter } from "@zox/providers";
import { MemorySessionStore } from "@zox/core";
import { createApp } from "./app.ts";

const token = "test-token";

function app() {
  return createApp({
    token,
    store: new MemorySessionStore(),
    router: createProviderRouter({ adapters: [createMockAdapter()] }),
  });
}

const auth = { Authorization: `Bearer ${token}` };

describe("createApp", () => {
  test("creates a session, streams mock deltas over SSE, then idles", async () => {
    const server = app();
    const created = await server.request("/sessions", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceRoot: "/tmp/ws" }),
    });
    expect(created.status).toBe(201);
    const session = await created.json();
    expect(session.status).toBe("idle");
    expect(session.model).toBe("mock/echo");

    const eventsRes = await server.request(`/sessions/${session.id}/events`, {
      headers: auth,
    });
    expect(eventsRes.status).toBe(200);
    expect(eventsRes.headers.get("content-type") ?? "").toContain(
      "text/event-stream",
    );

    const send = server.request(`/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ content: "ping" }),
    });

    const body = await eventsRes.text();
    await send;
    expect(body).toContain("message.delta");
    expect(body).toContain("ping");
    expect(body).toContain("message.completed");

    const got = await server.request(`/sessions/${session.id}`, { headers: auth });
    const json = await got.json();
    expect(json.status).toBe("idle");
  });
});
```

Hono `app.request` plus SSE is racey if `eventsRes.text()` waits forever. **Required implementation detail:** close the SSE stream after the turn reaches `idle` or `error` (Phase 0 only). That makes `eventsRes.text()` finish. Document in a comment: Phase 1 may keep the stream open for multiple turns.

If the test still hangs, use `AbortSignal.timeout(2000)` on the events request and assert the partial body.

- [ ] **Step 6: Run app test to verify it fails**

Run: `bun test packages/server/src/app.test.ts`

Expected: FAIL — `createApp` missing. If it hangs, abort and fix the test to use a timeout before implementing.

- [ ] **Step 7: Implement bus + app**

`packages/server/src/bus.ts`:

```ts
import type { ZoxEvent } from "@zox/contracts";

type Subscriber = (event: ZoxEvent) => void;

export class SessionEventBus {
  #subs = new Map<string, Set<Subscriber>>();
  #buffers = new Map<string, ZoxEvent[]>();

  publish(sessionId: string, event: ZoxEvent): void {
    const buffer = this.#buffers.get(sessionId) ?? [];
    buffer.push(event);
    this.#buffers.set(sessionId, buffer);
    for (const sub of this.#subs.get(sessionId) ?? []) {
      sub(event);
    }
  }

  subscribe(sessionId: string, subscriber: Subscriber): () => void {
    const set = this.#subs.get(sessionId) ?? new Set();
    set.add(subscriber);
    this.#subs.set(sessionId, set);
    for (const event of this.#buffers.get(sessionId) ?? []) {
      subscriber(event);
    }
    return () => {
      set.delete(subscriber);
    };
  }
}
```

`packages/server/src/app.ts`:

```ts
import {
  createSessionRequestSchema,
  sendMessageRequestSchema,
  type ZoxEvent,
} from "@zox/contracts";
import { MemorySessionStore, runTurn } from "@zox/core";
import type { createProviderRouter } from "@zox/providers";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { bearerAuth } from "./auth.ts";
import { SessionEventBus } from "./bus.ts";

export type AppRouter = ReturnType<typeof createProviderRouter>;

export function createApp(opts: {
  token: string;
  store: MemorySessionStore;
  router: AppRouter;
}): Hono {
  const bus = new SessionEventBus();
  const app = new Hono();
  app.use("*", bearerAuth(opts.token));

  app.post("/sessions", async (c) => {
    const body = createSessionRequestSchema.parse(await c.req.json());
    const session = opts.store.create(body);
    return c.json(
      {
        id: session.id,
        workspaceRoot: session.workspaceRoot,
        agent: session.agent,
        model: session.model,
        status: session.status,
      },
      201,
    );
  });

  app.get("/sessions/:id", (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json({
      id: session.id,
      workspaceRoot: session.workspaceRoot,
      agent: session.agent,
      model: session.model,
      status: session.status,
    });
  });

  app.post("/sessions/:id/messages", async (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    if (session.status !== "idle") {
      return c.json({ error: "Session not idle" }, 409);
    }
    const body = sendMessageRequestSchema.parse(await c.req.json());
    session.status = "running";
    void (async () => {
      for await (const event of runTurn({
        session,
        userContent: body.content,
        router: opts.router,
      })) {
        bus.publish(session.id, event);
      }
    })();
    return c.json({ ok: true }, 202);
  });

  app.get("/sessions/:id/events", (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    let id = 0;
    return streamSSE(c, async (stream) => {
      await new Promise<void>((resolve) => {
        const unsubscribe = bus.subscribe(session.id, (event: ZoxEvent) => {
          void stream
            .writeSSE({
              id: String(id++),
              event: event.type,
              data: JSON.stringify(event),
            })
            .then(() => {
              if (
                event.type === "session.status" &&
                (event.status === "idle" || event.status === "error")
              ) {
                unsubscribe();
                resolve();
              }
            });
        });
      });
    });
  });

  return app;
}
```

Fix the SSE close race: if subscribe replays a buffer that already ended, still close. Handle Zod parse errors with 400.

`packages/server/src/index.ts`:

```ts
import { MemorySessionStore } from "@zox/core";
import { createMockAdapter, createOpenAIAdapter, createProviderRouter } from "@zox/providers";
import { createApp } from "./app.ts";

export function listen(opts?: { port?: number; hostname?: string; token?: string }) {
  const token = opts?.token ?? process.env.ZOXX_SERVER_TOKEN ?? crypto.randomUUID();
  const adapters = [createMockAdapter()];
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    adapters.push(createOpenAIAdapter({ apiKey: openaiKey }));
  }
  const app = createApp({
    token,
    store: new MemorySessionStore(),
    router: createProviderRouter({ adapters }),
  });
  const hostname = opts?.hostname ?? "127.0.0.1";
  const port = opts?.port ?? 8787;
  return Bun.serve({
    hostname,
    port,
    fetch: app.fetch,
  });
}
```

Do not log the token in plaintext beyond a one-line stderr `ZOXX_SERVER_TOKEN set` / `generated` without the value.

- [ ] **Step 8: Run server tests**

Run: `bun test packages/server`

Expected: PASS. If SSE test flakes, serialize: start the events request, wait a tick, POST message, then read stream.

- [ ] **Step 9: Commit (only if Jayant asks)**

```bash
git add packages/server
git commit -m "feat: serve session CRUD and SSE turns over Hono"
```

---

### Task 8: `@zox/sdk` client

**Files:**
- Create: `packages/sdk/package.json`
- Create: `packages/sdk/src/sse.ts`
- Create: `packages/sdk/src/sse.test.ts`
- Create: `packages/sdk/src/client.ts`
- Create: `packages/sdk/src/client.test.ts`
- Create: `packages/sdk/src/index.ts`

**Interfaces:**
- Consumes: `@zox/contracts` types; HTTP to `@zox/server`
- Produces:

```ts
function createZoxClient(opts: { baseUrl: string; token: string }): {
  sessions: {
    create(input: { workspaceRoot: string; agent?: string; model?: string }): Promise<SessionHandle>;
  };
};

type SessionHandle = {
  id: string;
  send(content: string): {
    events(): AsyncIterable<ZoxEvent>;
  };
};
```

`send().events()`: POST messages, then GET events, parse SSE until `session.status` idle/error. Alternatively GET events first then POST — match the server (events subscription should replay the turn buffer, so POST-then-GET also works). Prefer **open events, then POST**, then iterate.

SDK must not import `@zox/core`.

- [ ] **Step 1: Write failing SSE parser test**

`packages/sdk/package.json`:

```json
{
  "name": "@zox/sdk",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@zox/contracts": "workspace:*"
  },
  "devDependencies": {
    "@types/bun": "1.4.2",
    "typescript": "catalog:"
  }
}
```

`packages/sdk/src/sse.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { parseSseBlock } from "./sse.ts";

describe("parseSseBlock", () => {
  test("parses event and json data", () => {
    const event = parseSseBlock(
      `event: message.delta\ndata: {"type":"message.delta","sessionId":"s","messageId":"m","delta":"hi"}`,
    );
    expect(event).toMatchObject({ type: "message.delta", delta: "hi" });
  });
});
```

- [ ] **Step 2: Run parser test to verify it fails**

Run: `bun test packages/sdk/src/sse.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement parser**

`packages/sdk/src/sse.ts`:

```ts
import { zoxEventSchema, type ZoxEvent } from "@zox/contracts";

export function parseSseBlock(block: string): ZoxEvent | undefined {
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("data:")) {
      data += line.slice(5).trim();
    }
  }
  if (!data) return undefined;
  return zoxEventSchema.parse(JSON.parse(data));
}

export async function* iterateSse(response: Response): AsyncIterable<ZoxEvent> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const event = parseSseBlock(part.trim());
      if (event) yield event;
    }
    if (done) break;
  }
}
```

- [ ] **Step 4: Run parser tests**

Run: `bun test packages/sdk/src/sse.test.ts`

Expected: PASS

- [ ] **Step 5: Write failing SDK client test against `createApp`**

`packages/sdk/src/client.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { MemorySessionStore } from "@zox/core";
import { createMockAdapter, createProviderRouter } from "@zox/providers";
import { createApp } from "@zox/server";
import { createZoxClient } from "./client.ts";

describe("createZoxClient", () => {
  test("receives mock message.delta over SSE", async () => {
    const token = "sdk-token";
    const hono = createApp({
      token,
      store: new MemorySessionStore(),
      router: createProviderRouter({ adapters: [createMockAdapter()] }),
    });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: hono.fetch,
    });
    try {
      const client = createZoxClient({
        baseUrl: `http://127.0.0.1:${server.port}`,
        token,
      });
      const session = await client.sessions.create({ workspaceRoot: "/tmp/ws" });
      const deltas: string[] = [];
      for await (const event of session.send("ping").events()) {
        if (event.type === "message.delta") deltas.push(event.delta);
      }
      expect(deltas.join("")).toBe("ping");
    } finally {
      server.stop(true);
    }
  });
});
```

This test may import `@zox/server` **only in tests**, which the architecture allows for integration tests. Production `packages/sdk/src/client.ts` must not import core/server.

If `@zox/server` has no export yet, add `"exports": { ".": "./src/index.ts" }` and `export { createApp } from "./app.ts"`.

- [ ] **Step 6: Run client test to verify it fails**

Run: `bun test packages/sdk/src/client.test.ts`

Expected: FAIL — `createZoxClient` missing.

- [ ] **Step 7: Implement client**

`packages/sdk/src/client.ts`:

```ts
import {
  createSessionResponseSchema,
  type ZoxEvent,
} from "@zox/contracts";
import { iterateSse } from "./sse.ts";

export function createZoxClient(opts: { baseUrl: string; token: string }) {
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${opts.token}`,
    "Content-Type": "application/json",
  };

  return {
    sessions: {
      async create(input: {
        workspaceRoot: string;
        agent?: string;
        model?: string;
      }) {
        const res = await fetch(`${baseUrl}/sessions`, {
          method: "POST",
          headers,
          body: JSON.stringify(input),
        });
        if (!res.ok) {
          throw new Error(`create session failed: ${res.status}`);
        }
        const session = createSessionResponseSchema.parse(await res.json());
        return {
          id: session.id,
          send(content: string) {
            return {
              async *events(): AsyncIterable<ZoxEvent> {
                const eventsRes = await fetch(
                  `${baseUrl}/sessions/${session.id}/events`,
                  { headers: { Authorization: headers.Authorization } },
                );
                if (!eventsRes.ok) {
                  throw new Error(`events failed: ${eventsRes.status}`);
                }
                const sendRes = await fetch(
                  `${baseUrl}/sessions/${session.id}/messages`,
                  {
                    method: "POST",
                    headers,
                    body: JSON.stringify({ content }),
                  },
                );
                if (!sendRes.ok) {
                  throw new Error(`send failed: ${sendRes.status}`);
                }
                for await (const event of iterateSse(eventsRes)) {
                  yield event;
                  if (
                    event.type === "session.status" &&
                    (event.status === "idle" || event.status === "error")
                  ) {
                    return;
                  }
                }
              },
            };
          },
        };
      },
    },
  };
}
```

Race: opening SSE then POSTing is correct, but `fetch(events)` returns only after headers. Hono `streamSSE` should send headers immediately. If POST happens too late and the turn already finished, bus replay must still deliver buffered events.

`packages/sdk/src/index.ts`:

```ts
export { createZoxClient } from "./client.ts";
```

- [ ] **Step 8: Run SDK tests**

Run: `bun test packages/sdk`

Expected: PASS

- [ ] **Step 9: Commit (only if Jayant asks)**

```bash
git add packages/sdk packages/server/src/index.ts packages/server/package.json
git commit -m "feat: add @zox/sdk session create and SSE stream"
```

---

### Task 9: CI (lint, test, typecheck)

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/ci.test.ts` is not required — add a small script test that `ci.yml` contains the three commands, or skip and verify by running locally.

- [ ] **Step 1: Write a failing check that the workflow file exists**

Create `packages/contracts/src/ci-workflow.test.ts` only if you want TDD for YAML; otherwise treat workflow as config. Preferred: no extra test; verify by running the same commands CI will run.

- [ ] **Step 2: Implement workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.2.21"
      - run: bun install --frozen-lockfile
      - run: bun run lint
      - run: bun run typecheck
      - run: bun test
```

If `bun-version: 1.2.21` is stale, use `"latest"` but prefer pinning whatever `bun --version` is on the implementer's machine.

- [ ] **Step 3: Run local CI commands**

```sh
bun run lint
bun run typecheck
bun test
```

Expected: all succeed. Fix Biome/tsc issues in the same task; do not weaken `strict`.

- [ ] **Step 4: Commit (only if Jayant asks)**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run lint, typecheck, and bun test"
```

---

## Self-review

**Spec coverage (Phase 0 only):**

| Requirement | Task |
|-------------|------|
| Monorepo scaffold (Bun workspaces, TypeScript, `bun test`) | 1 |
| `@zox/contracts` Zod event schemas + OpenAPI stub | 2, 3 |
| `@zox/providers` one real provider + mock | 4, 5 |
| `@zox/core` minimal loop (no tools) | 6 |
| `@zox/server` POST message, SSE events | 7 |
| `@zox/sdk` create session, send, stream | 8 |
| CI: lint, test, typecheck | 9 |
| Exit: fake provider completes one turn over HTTP; SDK receives SSE deltas | 8 client test |
| Secrets not in session store | 5/7: API key only in env / adapter opts |
| Server source of truth; sdk HTTP-only | 8 |
| Bearer token / loopback | 7 |
| Model id `provider/model` | 5 |

**Out of scope (do not implement now):** TUI, CLI bin, tools, MCP, skills, slash, SQLite, compaction, hooks, sandbox, OTel, extra providers.

**Placeholder scan:** none remaining; OpenAI `fullStream` field names may need a one-line adjust to the installed AI SDK — covered by the `streamChatImpl` seam so tests stay green.

**Type consistency:** `ZoxEvent` / `session.status` / `createZoxClient` / `runTurn` names are stable across tasks.
