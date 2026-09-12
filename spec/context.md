# Context management

## Objectives

- Maximize task-relevant information within the model window.
- Make behavior **predictable**: users see token usage and when compaction runs.
- Preserve audit history locally even when provider context shrinks.
- Enforce an **observation budget** so tool output cannot poison context or cost (capstone: multi-MB ripgrep dumps).

See also [memory.md](./memory.md) (plan + prior-state) and [observability.md](./observability.md) (budgets).

## Context assembly (per turn)

Order of message parts sent to the provider:

1. **System** — agent base prompt + global rules.
2. **Project instructions** — from `AGENTS.md`, `ZOXX.md`, or config `instructions.files[]`.
3. **Session system** — one-time or rare session-level notes.
4. **Prior-state block** — if present, injected after compaction ([memory.md](./memory.md)).
5. **Conversation** — user/assistant/tool messages, subject to compaction and prune rules.
6. **Ephemeral attachments** — files referenced this turn (`@path`, slash `/read`, tool-injected).
7. **Plan snapshot** — current `todowrite` state (or excerpt) when plan pane enabled.

Tool definitions are attached per provider requirements (not counted as conversation tokens in UI, but tracked separately where API reports `tools` overhead).

## Token accounting

### Sources (priority)

1. **Provider usage** from last response (`usage` object).
2. **Tokenizer** per provider family (tiktoken, anthropic counter, or approximation).
3. **Heuristic** — chars/4 with safety margin when unknown.

### UI / API reporting

| Metric | Scope | Notes |
|--------|-------|-------|
| `turn.input` / `turn.output` | Per model call | Includes tool loop substeps |
| `session.total` | Session | Sum across turns |
| `context.window` | Model metadata | From model catalog |
| `context.estimated` | Pre-request | What we will send |
| `cache.read` / `cache.write` | When supported | Show in `/usage` |

Store aggregates in SQLite for `/usage` and billing awareness (no automatic charging — informational).

## Overflow detection

Before each model call:

```
estimated = contextEngine.estimate(session, agent, pendingAttachments)
if estimated > model.contextWindow * threshold:
  queueCompaction(session, { auto: true })
```

Default `threshold = 0.85`. Configurable via `context.overflowThreshold`.

**Soft threshold (capstone):** at `budget.preCompactTokenThreshold` (default 150_000), run `PreCompact` hooks to build a prior-state summary *before* hard overflow — see [hooks.md](./hooks.md).

## Observation budget (verification gate)

Limits what enters the model from tool **observe** step (distinct from sandbox capture limits):

| Limit | Default | Notes |
|-------|---------|-------|
| `sandbox.maxToolOutputChars` | 32_000 | Truncate tool result in message |
| `tools.grep.maxMatches` | 500 | Cap match lines |
| `tools.grep.maxBytes` | 256_000 | Pre-truncate at source |
| `budget.maxTurns` | null | Hard stop (e.g. 50 for `agent run`) |
| `budget.maxUsdPerTask` | null | Uses usage + catalog pricing |

Denied or truncated observations set flags on the tool result (`truncated: true`) for OTel and TUI.

## Compaction

### Behavior

- Trigger: auto on overflow, manual `/compact`, or SDK `session.compact()`.
- Uses a **hidden compaction agent** (small/fast model configurable) with a fixed summarization prompt.
- Output: assistant message with `meta.summary = true` covering a message range `[fromId, toId]`.
- **Provider context** excludes summarized range content (replaced by summary message).
- **SQLite** retains full history for export/revert analysis.

### Compaction prompt inputs

- Transcript of messages in range (tool results truncated for summarizer only — see below).
- Current user goal (last user message).
- Open todos if any (full `plan_json`).
- Existing prior-state block (if hook already ran).

### Summarizer-only truncation

- `TOOL_OUTPUT_MAX_CHARS` (default 2000) applies only to text fed to compaction agent, not live turns.

## Pruning (optional, off by default)

When `context.prune.enabled = true`:

- Clear **bodies** of old tool results in stored messages.
- Keep tool call metadata (name, args).
- Protect recent `PRUNE_PROTECT_MIN_TOKENS` (default 40k) of tool output.
- Only run if reclaimable > `PRUNE_MIN_RECLAIM` (default 20k).
- **Protected tools:** `skill` (and configurable list) — never prune their results.

## File and repo context

- **Ripgrep/glob** tools preferred over stuffing directories into system prompt.
- Optional **codebase index** (V2): embeddings local or BYOK — not in MVP.
- Respect `.gitignore` and `.zoxignore`.

## Slash / SDK commands

| Action | Effect |
|--------|--------|
| `/compact` | Force compaction pass (+ `PreCompact` hooks) |
| `/context` | Show estimated tokens breakdown |
| `/usage` | Session usage table |
| `/remember` | Write durable memory (V1.5) |
| `/clear` | New session id, same workspace |
| `/model` | Switch model for subsequent turns |
| `/trace` | Show last turn trace id (OTel) |

## Failure modes

- Compaction fails → return error to user; suggest smaller task or manual `/clear`.
- Model window unknown → conservative threshold (e.g. 0.75) and warn once per session.
