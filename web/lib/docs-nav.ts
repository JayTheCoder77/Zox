export type DocsNavItem = { title: string; href: string };
export type DocsNavGroup = { label: string; items: DocsNavItem[] };

export const docsNav: DocsNavGroup[] = [
  {
    label: "Intro",
    items: [
      { title: "Overview", href: "/docs" },
      { title: "Install", href: "/docs/install" },
      { title: "Quickstart", href: "/docs/quickstart" },
    ],
  },
  {
    label: "Using Zox",
    items: [
      { title: "CLI reference", href: "/docs/cli" },
      { title: "TUI & REPL", href: "/docs/tui" },
      { title: "Sessions", href: "/docs/sessions" },
      { title: "Models & BYOK", href: "/docs/models" },
      { title: "Agents", href: "/docs/agents" },
    ],
  },
  {
    label: "Safety & tools",
    items: [
      { title: "Tools", href: "/docs/tools" },
      { title: "Permissions", href: "/docs/permissions" },
      { title: "Sandbox", href: "/docs/sandbox" },
      { title: "Hooks", href: "/docs/hooks" },
      { title: "Prompt guardrail", href: "/docs/prompt-guardrail" },
    ],
  },
  {
    label: "Extensibility",
    items: [
      { title: "Configuration", href: "/docs/configuration" },
      { title: "Skills", href: "/docs/skills" },
      { title: "Slash commands", href: "/docs/slash-commands" },
      { title: "MCP", href: "/docs/mcp" },
    ],
  },
  {
    label: "Advanced",
    items: [
      { title: "Architecture", href: "/docs/architecture" },
      { title: "Server, OpenAPI & SDK", href: "/docs/sdk" },
      { title: "Memory & context", href: "/docs/memory" },
      { title: "Observability", href: "/docs/observability" },
      { title: "Evals", href: "/docs/evals" },
      { title: "Troubleshooting", href: "/docs/troubleshooting" },
    ],
  },
];
