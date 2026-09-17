import { afterEach, describe, expect, mock, test } from "bun:test";
import { createApp } from "@zox/server";
import { MemorySessionStore } from "../../core/src/store.ts";
import { createMockAdapter, createProviderRouter } from "../../providers/src/index.ts";

const stop = mock(() => {});

mock.module("@zox/server", () => ({
  createApp,
  async listen(opts?: {
    hostname?: string;
    port?: number;
    token?: string;
    sandboxMode?: "host" | "worktree" | "container" | "remote";
  }) {
    const token = opts?.token ?? crypto.randomUUID();
    const hono = createApp({
      token,
      store: new MemorySessionStore(),
      router: createProviderRouter({ adapters: [createMockAdapter()] }),
      config: {
        sandbox: { mode: opts?.sandboxMode ?? "host" },
        context: { windowTokens: 128_000 },
        memory: { autoSummarize: false },
      },
    });
    const server = Bun.serve({
      hostname: opts?.hostname ?? "127.0.0.1",
      port: opts?.port ?? 0,
      fetch: hono.fetch,
    });
    return {
      port: server.port ?? opts?.port ?? 8787,
      stop() {
        stop();
        server.stop(true);
      },
    };
  },
}));

mock.module("@zox/tui", () => ({
  async runZoxApp() {},
}));

mock.module("./repl.ts", () => ({
  async runRepl() {},
}));

const { runEmbed } = await import("./embed.ts");

describe("runEmbed", () => {
  afterEach(() => {
    stop.mockClear();
  });

  test("stops the embedded listen() server after TUI exit", async () => {
    const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    try {
      await runEmbed({ port: 18787 });
    } finally {
      if (stdoutTty) Object.defineProperty(process.stdout, "isTTY", stdoutTty);
      if (stdinTty) Object.defineProperty(process.stdin, "isTTY", stdinTty);
    }
    expect(stop).toHaveBeenCalled();
  });

  test("stops the embedded listen() server after REPL exit", async () => {
    await runEmbed({ port: 18787, noTui: true });
    expect(stop).toHaveBeenCalled();
  });

  test("resumes an existing session when --session is set", async () => {
    const token = crypto.randomUUID();
    const { listen } = await import("@zox/server");
    const server = await listen({ token, port: 0, sandboxMode: "host" });
    const baseUrl = `http://127.0.0.1:${server.port}`;
    try {
      const { createZoxClient } = await import("@zox/sdk");
      const client = createZoxClient({ baseUrl, token });
      const created = await client.sessions.create({ workspaceRoot: process.cwd() });
      await created.close();

      await runEmbed({
        noTui: true,
        session: created.id,
        url: baseUrl,
        token,
      });
    } finally {
      server.stop();
    }
  });
});
