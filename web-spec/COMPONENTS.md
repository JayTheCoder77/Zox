# Components

Shared UI and motion pieces. Keep the surface tiny.

---

## Site

### `Header`

- Logo link `/`  
- Nav: Docs, GitHub (external)  
- Theme toggle  
- Primary CTA  

### `Footer`

- Minimal links + license line  

### `ThemeToggle`

- Cycles light / dark / system (or light ↔ dark)  
- Persist preference  

---

## Landing

### `InstallSnippet`

- Tab list: `curl` | `bun` | `npm` (or whatever install methods you document)  
- Active panel with mono code + copy button  
- Tab indicator slides under active tab (CSS or Framer Motion)  

### `TuiMock`

- Dark surface, monospace transcript  
- Props: optional script of lines `{ type: 'user' | 'assistant' | 'tool' | 'permission', text }`  
- On viewport enter: type user line, then reveal tools with stagger  
- Blinking cursor on final idle line  
- Respect `prefers-reduced-motion` → show final state immediately  

### `AsciiList`

```tsx
// rows: { mark: '+' | '-' | 'x' | '*', title: string, body?: string }[]
[+ ] Local-first     Server binds 127.0.0.1
```

### `FeatureSection` / `HowItWorks` / `Faq`

- Thin wrappers around content from `LANDING.md`  
- FAQ: uncontrolled accordion or Radix Accordion (unstyled)  

---

## Docs

### `DocsSidebar`

- Tree from `lib/docs.ts`  
- Active path highlight  

### `DocsToc`

- IntersectionObserver on h2/h3  

### `MdxComponents`

Map:

| MDX | Component |
|-----|-----------|
| `pre` / `code` | `CodeBlock` |
| `a` | Next `Link` for internal |
| custom `Callout` | bordered note |
| custom `Steps` | numbered list |

---

## UI primitives

### `Button`

Variants:

- `primary` — filled ink, text on-primary  
- `ghost` — no fill, hairline optional  
- `link` — underline on hover  

Size: default 16px mono, padding `8px 16px`, radius 4px.

### `CodeBlock`

- Header optional (language label + copy)  
- Surface-soft background  
- Overflow-x auto  

### Copy feedback

- Button text flips to `copied` for 1.5s  

---

## Animation library

Prefer **CSS** + small React state. If needed:

- `framer-motion` only for tab indicator + TUI stagger  
- Or pure CSS `@keyframes` for cursor blink / type  

Do not load heavy Lottie / Three.js.