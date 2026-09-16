# Skills

User skills are markdown playbooks (`SKILL.md`) that extend agent behavior without changing core harness code. They follow the same discovery model as Cursor/Codex-style agent skills: frontmatter metadata plus a body the model should follow when the skill is **active**.

See also [tools-extensibility.md](./tools-extensibility.md) (tool + slash), [context.md](./context.md) (protected from prune), [memory.md](./memory.md) (session vs durable), [hooks.md](./hooks.md) (`InstructionsLoaded`).

## Phase 1 baseline (shipped)

| Capability | Behavior |
|------------|----------|
| Discovery | `.zox/skills/<name>/SKILL.md`, `~/.config/zox/skills/<name>/SKILL.md`, `skills.loadPaths[]` (project wins over user over load paths) |
| Format | YAML frontmatter: `name`, `description`; body is markdown instructions |
| `/skill <name>` | Loads skill into `activeSkills`; body injected on every turn via context assembly (`skillBodies` system prefix) |
| `skills.autoLoad[]` | On session create, same as manual load |
| `skill` tool | Returns skill body as **tool result only**; does **not** add to `activeSkills` (gap) |
| `GET /memory` | Returns `activeSkills` for debugging |
| Agents | `build` and `plan` both include `skill` in tool allowlist |

Phase 1 is enough to **manually** load skills via slash or config; the model is not given a reliable catalog of what exists, and tool-based loads do not stay active across turns.

## Phase 1.5 — Skills in the harness (target)

**Exit criteria:** A user can discover skills from the TUI/CLI, load them explicitly or via the model, see what is active, and have instructions persist for the session (and across resume when session persistence lands). The model is steered toward the right skill without reading the whole repo.

### 1. Skill catalog (model-facing)

- On each turn (or once per session with invalidation on reload), inject a compact **skills index** system block:
  - For each discovered skill: `name`, `description` (from frontmatter), optional `path` hint.
  - Cap entries and description length (`skills.catalogMaxSkills`, `skills.catalogMaxDescriptionChars`).
- Index is **metadata only**; full bodies load only when a skill becomes active.
- Optional config: `skills.catalog: true | false` (default `true` when any skills exist).

### 2. Unified activation paths

All paths must update the same session state (`activeSkills`) and trigger the same injection rules:

| Path | Phase 1.5 behavior |
|------|-------------------|
| `/skill <name>` | Load (existing); add **`/skill -u <name>`** or **`/skills unload <name>`** to remove |
| `skill` tool | On success: append to `activeSkills` (dedupe by name), return short ack in tool result (not full body duplicate in tool channel when already injected) |
| `skills.autoLoad[]` | Unchanged; failures surface once in `systemNotes` or session warning event |
| SDK | `client.sessions.skills.list()`, `.load(name)`, `.unload(name)`, `.active()` |
| HTTP | `GET /skills` (workspace-scoped catalog), `GET /sessions/:id/skills`, `POST /sessions/:id/skills` with `{ action: "load" \| "unload", name }` |

Wire **`skills.loadPaths`** into the `skill` tool and all server loaders (parity with `loadAutoSkills`).

### 3. Slash and TUI

| Command | Action |
|---------|--------|
| `/skills` | List discovered skills (name, description, loaded yes/no) |
| `/skills reload` | Rescan disk; refresh catalog; keep active bodies unless file deleted |
| `/skill <name>` | Load (existing) |
| `/skill -u <name>` | Unload |

TUI:

- Show **active skills** in status bar or a one-line summary (`skills: commit-helper, brainstorming`).
- Optional: `o` on a skill row or `/skills` output in transcript (system lines).

### 4. Persistence and resume

- Persist `activeSkills` (names + bodies or names + paths with lazy reload) in SQLite `sessions` row.
- On session **resume** (Phase 1.5 session list/resume APIs), restore active skills before first turn.
- `/clear` resets `activeSkills` (already resets related session fields).

### 5. Context and compaction

- Active skill bodies remain in the **system prefix** via `assembleProviderMessages` (existing).
- Mark tool results from `skill` and messages tagged as skill-sourced as **protected** when prune lands ([context.md](./context.md)).
- Compaction summarizer: do not drop active skill names from `priorStateMarkdown`; optional one-line “Active skills: …” in compact summary.

### 6. Hooks and observability

- Emit **`InstructionsLoaded`** (new hook event, Phase 1.5) after `autoLoad` and after manual/tool load, payload: `{ skills: [{ name, path }] }`.
- OTel: attribute `zox.skills.active` on turn span (comma-separated names).
- Prometheus (optional): `zox_skills_loads_total` label `source=slash|tool|auto`.

### 7. Config schema (`@zox/config`)

```json
{
  "skills": {
    "autoLoad": ["commit-helper"],
    "loadPaths": ["/path/to/extra/skills"],
    "catalog": true,
    "catalogMaxSkills": 64,
    "catalogMaxDescriptionChars": 200
  }
}
```

### 8. Contracts and OpenAPI

- Zod: `skillSummarySchema`, `activeSkillSchema`, events optional `skills.changed` `{ sessionId, active: string[] }`.
- OpenAPI: paths above; document in [clients.md](./clients.md).

### 9. Testing (Phase 1.5)

- Unit: catalog truncation, load/unload dedupe, discovery precedence.
- Integration: `skill` tool → next turn still has body in assembled messages without calling tool again.
- SDK e2e: list → load → send message → assert skill prefix present.

## Phase 2 (out of scope for 1.5)

- Plugin-registered skills (JS module).
- Skill marketplace / remote install.
- Semantic “suggest skill for this prompt”.
- Import paths from other products’ skill directories.

## Security

- Skills are **trusted content** from the user’s disk (same trust model as `AGENTS.md`). Project `.zox/skills` requires no extra trust bit; arbitrary `loadPaths` in shared config should be documented as equivalent to running untrusted instructions.
- Do not execute code in frontmatter; body is text-only for the model.
