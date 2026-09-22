# Zox Website Spec

Specification for a **minimal Next.js** marketing + docs site for [Zox](https://github.com/JayTheCoder77/Zox) — the local coding agent harness.

**Reference aesthetic:** [opencode.ai](https://opencode.ai/)  
**Scope:** Landing page + Docs only. No auth, no dashboard, no account system.

---

## Goals

| Goal | Detail |
|------|--------|
| **Minimal AF** | One font family (monospace), flat surfaces, no gradients, no heavy illustration, almost no icons (prefer ASCII / brackets). |
| **Terminal-native** | Page should feel like a manpage / README rendered at modern resolution. |
| **Light + dark** | Full theme support; dark is the “TUI moment,” light is the cream canvas. |
| **Animated, not busy** | Subtle motion: install tab switch, TUI mock typing, fade-ins, cursor blink. No parallax spam. |
| **Docs-first** | Docs are first-class. Landing sells the product; docs teach it. |

---

## Site map

```
/                 → Landing
/docs             → Docs index (redirect or overview)
/docs/[...slug]   → Individual doc pages
```

No other routes required for v1.

---

## Documents in this folder

| File | Purpose |
|------|---------|
| [FOLDER_STRUCTURE.md](./FOLDER_STRUCTURE.md) | Next.js app directory layout |
| [DESIGN.md](./DESIGN.md) | Colors, type, spacing, motion (opencode-matched) |
| [LANDING.md](./LANDING.md) | Landing page sections, copy, interactive pieces |
| [DOCS.md](./DOCS.md) | Docs content map, navigation, MDX conventions |
| [COMPONENTS.md](./COMPONENTS.md) | Shared UI + animated components |
| [TECH.md](./TECH.md) | Stack, packages, conventions |

---

## Product one-liner (use everywhere)

> **Zox** is a local coding agent harness: an LLM with tools on your repo, wrapped in permissions, sandboxing, sessions, and observability. BYOK. Server on your machine. Terminal UI + SDK as thin clients.

---

## Out of scope (v1)

- Authentication / accounts  
- Hosted agent / cloud runs  
- Blog, changelog UI, pricing tables  
- Enterprise sales pages  
- Multi-language i18n  

Add later only if needed.