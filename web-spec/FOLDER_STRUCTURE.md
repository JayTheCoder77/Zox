# Folder structure

Next.js App Router project. Minimal surface area.

```
web/                          # or apps/web if monorepo
├── app/
│   ├── layout.tsx            # root layout, theme provider, fonts
│   ├── page.tsx              # landing
│   ├── globals.css           # CSS variables (light/dark)
│   ├── not-found.tsx
│   └── docs/
│       ├── layout.tsx        # docs shell (sidebar + content)
│       ├── page.tsx          # docs overview / intro
│       └── [...slug]/
│           └── page.tsx      # MDX doc page
│
├── components/
│   ├── site/
│   │   ├── header.tsx        # logo, nav, theme toggle, CTA
│   │   ├── footer.tsx
│   │   └── theme-toggle.tsx
│   ├── landing/
│   │   ├── hero.tsx          # headline + install snippet + tabs
│   │   ├── tui-mock.tsx      # animated terminal mockup
│   │   ├── features.tsx      # [+] feature list
│   │   ├── how-it-works.tsx
│   │   ├── privacy.tsx
│   │   └── faq.tsx
│   ├── docs/
│   │   ├── sidebar.tsx
│   │   ├── toc.tsx
│   │   └── mdx-components.tsx
│   └── ui/
│       ├── button.tsx
│       ├── code-block.tsx    # copy button, language tab
│       ├── install-snippet.tsx
│       └── ascii-list.tsx    # [+] / [-] / [x] rows
│
├── content/
│   └── docs/                 # MDX / Markdown source
│       ├── index.mdx
│       ├── install.mdx
│       ├── quickstart.mdx
│       ├── cli.mdx
│       ├── configuration.mdx
│       ├── tools.mdx
│       ├── sandbox.mdx
│       ├── permissions.mdx
│       ├── hooks.mdx
│       ├── mcp.mdx
│       ├── skills.mdx
│       ├── agents.mdx
│       ├── sessions.mdx
│       ├── sdk.mdx
│       ├── architecture.mdx
│       └── troubleshooting.mdx
│
├── lib/
│   ├── docs.ts               # load / parse docs, nav tree
│   └── cn.ts                 # className helper
│
├── public/
│   └── (optional favicon, og image)
│
├── package.json
├── next.config.ts
├── tailwind.config.ts        # or CSS-first tokens only
├── tsconfig.json
└── mdx-components.tsx        # if using next-mdx-remote / contentlayer / fumadocs
```

---

## Routing rules

| Path | Component | Notes |
|------|-----------|--------|
| `/` | `app/page.tsx` | Landing only |
| `/docs` | `app/docs/page.tsx` | Intro / table of contents |
| `/docs/*` | `app/docs/[...slug]/page.tsx` | File-based from `content/docs` |

No `/api` routes required for v1 (static / SSG preferred).

---

## Content source of truth

- Product facts come from the Zox repo: `README.md`, `docs.md`, `spec/*`.
- Website docs should **summarize and link** to the repo for deep reference; they must not diverge on CLI flags, config keys, or tool names.
- Prefer short pages over one giant scroll.