# Jev User-Prompt Guardrail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Jev-backed user-prompt guardrail that maps injection/policy Nouls to allow/ask/deny on human turns, fail-open on errors, and stays disabled by default.

**Architecture:** New `@zox/judge` package owns TypeSafe HTTP, state assembly, and band mapping. `@zox/core` `runTurn` calls a narrow `PromptJudge` port after the user message is queued and before `UserPromptSubmit`. Subagent `task` turns pass `skipJudge: true`. Clients handle `prompt.permission_required` separately from tool auto-approve.

**Tech Stack:** Bun workspaces, TypeScript, Zod 4, `bun test`, existing PermissionResponder + SSE events.

## Global Constraints

- `judge.enabled` default false: no network, no skip events.
- Fail-open on missing key / timeout / HTTP / invalid JSON / schema mismatch: `{ outcome: "skipped" }`.
- Jev never overrides sandbox, path jail, denylist, or permission globs.
- BYOK: TypeSafe secret never persisted in session DB or events.
- v1 skip-on-error only; no `judge.onError: "closed"`.
- Tool `autoApprove` must not approve prompt `ask`.
- Noul answers may omit `confidence`; treat missing confidence as `1` so `P(yes)` bands apply.

---

### Task 1: Contracts events

**Files:**
- Modify: `packages/contracts/src/events.ts`
- Test: `packages/contracts/src/events.test.ts`
- Modify: `packages/server/openapi/openapi.yaml`

- [ ] Add `prompt.guardrail`, `prompt.blocked`, `prompt.permission_required` to `zoxEventSchema`.
- [ ] Tests parse each event and reject unknown types (existing).
- [ ] Document events in OpenAPI `ZoxEvent` schema.

### Task 2: Config schema

**Files:**
- Modify: `packages/config/src/schema.ts`
- Test: `packages/config/src/load.test.ts`

- [ ] Add `judge` object matching the spec (`enabled`, `apiKeyEnv`, `baseURL`, `model`, `prompt` + `BandConfig`).
- [ ] Test parses `judge` fields; extra unknown nested keys follow existing Zod strip/reject behavior.

### Task 3: `@zox/judge` package

**Files:**
- Create: `packages/judge/package.json`, `src/index.ts`, `src/types.ts`, `src/defaults.ts`, `src/map.ts`, `src/client.ts`, tests.

- [ ] Fixture JSON → allow / ask / deny per band table.
- [ ] Max-severity combine (injection deny + policy ask → deny; both deny prefers higher `P(yes)`, then `injection`).
- [ ] Truncate `prompt` to `maxPromptChars`.
- [ ] Fetch throw / 500 / invalid body / missing key → `skipped`.
- [ ] Inject `fetch` (no live network).

### Task 4: Core loop port

**Files:**
- Modify: `packages/core/src/loop.ts`, `packages/core/src/index.ts`, `packages/core/package.json`
- Test: `packages/core/src/loop.test.ts`

- [ ] `judge?: PromptJudge` and `skipJudge?: boolean` on `runTurn`.
- [ ] Deny: no `streamChat`, status `idle`, `prompt.blocked`, user message retained.
- [ ] Ask + approve: hooks then LLM; ask + reject / no waiter: deny.
- [ ] Skipped: LLM runs; `prompt.guardrail` skipped; no `error` turn.
- [ ] Subagent `task`: `skipJudge: true`.
- [ ] `UserPromptSubmit` after allow and after ask-approve only.

### Task 5: Observability

**Files:**
- Modify: `packages/observability/src/metrics.ts`, `index.ts`, tests; `TurnObservability` in `loop.ts`.

- [ ] Record latency, outcome, skipped vs decided, fired question.
- [ ] Prompt text on spans only when `observability.recordContent` is true.

### Task 6: Server + clients + docs

**Files:**
- `packages/server/src/app.ts`, `index.ts`, `package.json`
- `packages/sdk/src/client.ts`
- `packages/tui/src/app.tsx`, `permission-dialog.tsx`
- `packages/cli/src/repl.ts`, `permission.ts`, `agent-run.ts`, `eval-run.ts` + tests
- `README.md`

- [ ] Wire `createPromptJudge` when `judge.enabled`.
- [ ] TUI/REPL copy: “Submit this prompt anyway?”
- [ ] Non-interactive: prompt ask is deny; `prompt.blocked` exits nonzero; `--auto-approve` does not approve prompt asks.
- [ ] Document `TYPESAFE_API_KEY` + `judge.enabled: true`.
