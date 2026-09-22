# Tech stack

Minimal, modern, static-friendly.

---

## Core

| Piece | Choice | Notes |
|-------|--------|--------|
| Framework | **Next.js 15** (App Router) | SSG for landing + docs |
| Language | TypeScript | strict |
| Styling | **Tailwind CSS v4** or CSS variables + Tailwind | Tokens in `globals.css` |
| Fonts | `next/font` → IBM Plex Mono (or self-host Berkeley if licensed) | subset latin |
| Docs | **MDX** via `fumadocs` / `contentlayer2` / `next-mdx-remote` | pick one; fumadocs is closest to “docs product” |
| Theme | `next-themes` | class or data-attribute |
| Icons | Almost none; ASCII preferred. If needed: `lucide-react` sparingly | |

---

## Recommended package.json (sketch)

```json
{
  "name": "zox-web",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "^15",
    "react": "^19",
    "react-dom": "^19",
    "next-themes": "^0.4",
    "clsx": "^2",
    "tailwind-merge": "^2"
  },
  "devDependencies": {
    "typescript": "^5",
    "@types/react": "^19",
    "@types/node": "^22",
    "tailwindcss": "^4",
    "@tailwindcss/typography": "^0.5"
  }
}
```

Add MDX stack of choice (example fumadocs or `@next/mdx`).

Optional: `framer-motion` only if CSS is insufficient for install tabs / TUI.

---

## Conventions

1. **No client JS unless needed** — landing mostly server components; theme toggle, copy button, accordion, TUI mock are client islands.
2. **Tokens only** — colors / spacing via CSS variables, not hard-coded hex in components.
3. **File naming** — kebab-case for routes and content; PascalCase for React components.
4. **Images** — avoid; if OG needed, generate simple mono text card.
5. **Analytics** — none by default (privacy-first product).

---

## Deploy

- Vercel / Cloudflare Pages / static export  
- `output: 'export'` possible if no server features  
- Env: none required for v1  

---

## Implementation order

1. Scaffold Next app + theme tokens + header/footer  
2. Landing hero + install snippet + static feature list  
3. TUI mock animation  
4. Docs layout + MDX pipeline + first 4 pages (overview, install, quickstart, CLI)  
5. Polish motion + dark mode parity  
6. Fill remaining docs from Zox `docs.md`  

---

## Alignment checklist

- [ ] Monospace only  
- [ ] Cream `#fdfcfc` / ink `#201d1d`  
- [ ] 4px radius  
- [ ] `[+]` feature markers  
- [ ] Light + dark  
- [ ] Landing + `/docs` only  
- [ ] No auth  
- [ ] Content matches Zox README / docs.md flags and names