import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemorySessionStore } from "@zox/core";
import { createHookRunner } from "@zox/hooks";
import { createMockAdapter, createProviderRouter } from "@zox/providers";
import { createBuiltinTools, ToolRegistry } from "@zox/tools";
import { createApp } from "./app.ts";
import { resolveCustomSlash } from "./slash-plugins.ts";

const token = "test-token";
const auth = { Authorization: `Bearer ${token}` };

function app(
  overrides: Parameters<typeof createApp>[0] extends infer T
    ? Partial<T>
    : never = {},
) {
  const tools = new ToolRegistry();
  for (const tool of createBuiltinTools()) tools.register(tool);
  const { config: overrideConfig, ...rest } = overrides;
  return createApp({
    token,
    store: new MemorySessionStore(),
    router: createProviderRouter({ adapters: [createMockAdapter()] }),
    tools,
    ...rest,
    config: {
      sandbox: { mode: "host" },
      ...overrideConfig,
    },
  });
}

async function createSession(
  server: ReturnType<typeof createApp>,
  workspaceRoot: string,
) {
  const created = await server.request("/sessions", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceRoot }),
  });
  expect(created.status).toBe(201);
  return (await created.json()) as { id: string };
}

describe("resolveCustomSlash", () => {
  test("expands .zox/commands/foo.md with $ARGUMENTS", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-cmd-"));
    await mkdir(join(root, ".zox/commands"), { recursive: true });
    await writeFile(
      join(root, ".zox/commands/foo.md"),
      "Explain $ARGUMENTS in one sentence.",
    );
    const result = await resolveCustomSlash({
      workspaceRoot: root,
      name: "foo",
      args: ["the parser"],
    });
    expect(result).toEqual({
      kind: "prompt",
      content: "Explain the parser in one sentence.",
    });
  });

  test("loads slash from zox.config.ts", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-cfg-"));
    await mkdir(join(root, ".zox"), { recursive: true });
    await writeFile(
      join(root, ".zox/zox.config.ts"),
      `export default { slash: { ping: (args: string[]) => "pong " + args[0] } };`,
    );
    const result = await resolveCustomSlash({
      workspaceRoot: root,
      name: "ping",
      args: ["1"],
    });
    expect(result).toEqual({ kind: "prompt", content: "pong 1" });
  });

  test("returns json from zox.config.ts slash handlers", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-cfg-json-"));
    await mkdir(join(root, ".zox"), { recursive: true });
    await writeFile(
      join(root, ".zox/zox.config.ts"),
      `export default { slash: { ping: () => ({ json: { ok: true } }) } };`,
    );
    const result = await resolveCustomSlash({
      workspaceRoot: root,
      name: "ping",
      args: [],
    });
    expect(result).toEqual({ kind: "json", value: { ok: true } });
  });

  test("rejects .. in markdown command names", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-cmd-dotdot-"));
    await mkdir(join(root, ".zox/commands"), { recursive: true });
    await writeFile(
      join(root, "secret.md"),
      "Explain $ARGUMENTS in one sentence.",
    );
    const result = await resolveCustomSlash({
      workspaceRoot: root,
      name: "../secret",
      args: ["x"],
    });
    expect(result).toEqual({ kind: "unknown" });
  });

  test("does not override built-in SLASH_NAMES", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-cmd-builtin-"));
    await mkdir(join(root, ".zox/commands"), { recursive: true });
    await writeFile(
      join(root, ".zox/commands/help.md"),
      "Explain $ARGUMENTS in one sentence.",
    );
    const result = await resolveCustomSlash({
      workspaceRoot: root,
      name: "help",
      args: [],
    });
    expect(result).toEqual({ kind: "unknown" });
  });
});

describe("dispatchCommand plugin slash", () => {
  test("returns type expand for markdown commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-cmd-http-"));
    await mkdir(join(root, ".zox/commands"), { recursive: true });
    await writeFile(
      join(root, ".zox/commands/foo.md"),
      "Explain $ARGUMENTS in one sentence.",
    );
    const server = app();
    const session = await createSession(server, root);
    const res = await server.request(`/sessions/${session.id}/commands`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "foo", args: ["the parser"] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      type: "expand",
      content: "Explain the parser in one sentence.",
    });
  });

  test("UserPromptExpansion deny returns 400", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-cmd-deny-"));
    await mkdir(join(root, ".zox/commands"), { recursive: true });
    await writeFile(
      join(root, ".zox/commands/foo.md"),
      "Explain $ARGUMENTS in one sentence.",
    );
    const denyScript = join(root, "deny.sh");
    await writeFile(
      denyScript,
      `#!/bin/sh\nprintf '{"decision":"deny","reason":"blocked"}\\n'\n`,
    );
    await chmod(denyScript, 0o755);
    const server = app({
      hooks: createHookRunner({
        files: [
          {
            zoxHooksVersion: 1,
            hooks: {
              UserPromptExpansion: [
                { matcher: "foo", type: "command", command: denyScript },
              ],
            },
          },
        ],
        cwd: root,
      }),
    });
    const session = await createSession(server, root);
    const res = await server.request(`/sessions/${session.id}/commands`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "foo", args: ["the parser"] }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "blocked" });
  });
});
