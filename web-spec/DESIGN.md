# Design system

Match **opencode.ai** aesthetics as closely as possible: terminal-native, monospace-first, cream + near-black, flat, minimal motion.

---

## Principles

1. **One typeface** — monospace everywhere (headlines, body, nav, code).
2. **Flat** — no drop shadows, no gradients, no glassmorphism.
3. **Warm neutrals** — cream canvas, warm near-black ink (not pure #000 / #fff).
4. **ASCII as iconography** — `[+]`, `[-]`, `[x]`, `[*]` instead of SVG icons where possible.
5. **One dark surface as hero** — the TUI mock is the main visual moment; rest of page stays light (or inverted in dark mode).
6. **Minimal motion** — 150–400ms opacity / tab transitions; typing cursor in TUI mock only.

---

## Color tokens

### Light (default marketing canvas)

| Token | Hex | Role |
|-------|-----|------|
| `--canvas` | `#fdfcfc` | Page background |
| `--surface-soft` | `#f8f7f7` | Inputs, install snippet bg |
| `--surface-card` | `#f1eeee` | Subtle cards / FAQ rows |
| `--ink` | `#201d1d` | Headlines, primary text, primary button fill |
| `--ink-deep` | `#0f0000` | Pressed primary |
| `--body` | `#424245` | Secondary body |
| `--mute` | `#646262` | Borders, muted labels |
| `--stone` | `#6e6e73` | Captions |
| `--ash` | `#9a9898` | Placeholder, disabled |
| `--hairline` | `rgba(15,0,0,0.12)` | Dividers |
| `--on-primary` | `#fdfcfc` | Text on primary button |

### Dark (theme + TUI mock surface)

| Token | Hex | Role |
|-------|-----|------|
| `--canvas` | `#201d1d` | Page / TUI background |
| `--surface` | `#302c2c` | Elevated panels |
| `--ink` | `#fdfcfc` | Primary text |
| `--body` | `#c8c6c4` | Secondary |
| `--mute` | `#9a9898` | Muted |
| `--hairline` | `rgba(253,252,252,0.12)` | Dividers |

### Semantic (sparingly)

| Token | Hex |
|-------|-----|
| `--accent` | `#007aff` |
| `--success` | `#30d158` |
| `--warning` | `#ff9f0a` |
| `--danger` | `#ff3b30` |

Use accent only for links / focus rings if needed. Primary CTAs stay **ink filled** (near-black on cream, cream on dark).

---

## Typography

**Font:** Berkeley Mono (or license-free stand-in: `IBM Plex Mono` / `JetBrains Mono` / `ui-monospace` stack).

```css
--font-mono: "Berkeley Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular,
  Menlo, Monaco, Consolas, "Liberation Mono", monospace;
```

| Role | Size | Weight | Line-height | Use |
|------|------|--------|-------------|-----|
| `display` | 38px (clamp 28–38) | 700 | 1.5 | Hero headline |
| `heading` | 16px | 700 | 1.5 | Section titles |
| `body` | 16px | 400 | 1.5 | Paragraphs, lists |
| `body-strong` | 16px | 500 | 1.5 | Nav, buttons, links |
| `caption` | 14px | 400 | 1.75–2 | Footer, meta |
| `code` | 14–16px | 400 | 1.5 | Snippets |

No italic. No serif. No second family.

---

## Spacing

4px base unit.

| Step | px |
|------|-----|
| 1 | 4 |
| 2 | 8 |
| 3 | 12 |
| 4 | 16 |
| 5 | 24 |
| 6 | 32 |
| 7 | 48 |
| 8 | 64 |
| 9 | 96 |

Section vertical rhythm: **64–96px** between major blocks. Max content width ~ **720–800px** for prose; install / hero can be slightly wider (~900px).

---

## Radius & borders

- Radius: **4px** for buttons, inputs, code blocks. **0** for full-bleed TUI mock.
- Borders: 1px `hairline` only. No heavy outlines.

---

## Motion

| Kind | Duration | Easing |
|------|----------|--------|
| Micro (hover opacity) | 150ms | `cubic-bezier(0.4, 0, 0.2, 1)` |
| Tab / snippet switch | 180–220ms | same |
| Section fade-in | 300–400ms | same |
| TUI cursor blink | 1s step | — |
| Typing effect | 30–50ms per char | linear |

Prefer `opacity` and `transform: translateY(4px)` — avoid layout thrash.

---

## Theme toggle

- System preference default, then user override in `localStorage`.
- Toggle in header (simple sun/moon or text `light` / `dark`).
- CSS variables swap on `html[data-theme="dark"]` (or `.dark` class).

---

## Accessibility

- Contrast: ink on canvas ≥ 7:1 for body.
- Focus rings: 2px accent or ink outline.
- Reduced motion: respect `prefers-reduced-motion` (disable typing / fade).