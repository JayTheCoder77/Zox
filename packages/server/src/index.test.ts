import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordTrust } from "@zox/hooks";
import { listen } from "./index.ts";

describe("listen", () => {
  const servers: Array<{ stop(): void }> = [];
  let prevCwd = process.cwd();

  afterEach(() => {
    for (const server of servers.splice(0)) server.stop();
    process.chdir(prevCwd);
  });

  test("wires SessionStart startup hooks from .zox/hooks.json", async () => {
    const project = await mkdtemp(join(tmpdir(), "zox-listen-hooks-"));
    const hookDir = join(project, ".zox");
    await mkdir(hookDir, { recursive: true });
    const marker = join(project, "session-start.ran");
    const script = join(hookDir, "on-start.sh");
    await writeFile(
      script,
      `#!/bin/sh\ntouch "${marker}"\necho '{"decision":"allow"}'\n`,
    );
    await chmod(script, 0o755);
    await writeFile(
      join(hookDir, "hooks.json"),
      JSON.stringify({
        zoxHooksVersion: 1,
        hooks: {
          SessionStart: [
            { matcher: "startup", type: "command", command: script },
          ],
        },
      }),
    );
    const storePath = join(project, "trusted.json");
    await recordTrust(project, { storePath });

    prevCwd = process.cwd();
    process.chdir(project);
    const server = await listen({
      port: 0,
      token: "hook-test-token",
      trustStorePath: storePath,
      sandboxMode: "host",
    });
    servers.push(server);

    const created = await fetch(`http://127.0.0.1:${server.port}/sessions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer hook-test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ workspaceRoot: project }),
    });
    expect(created.status).toBe(201);
    expect(await Bun.file(marker).exists()).toBe(true);
  });

  test("forwards context from project config to GET /config", async () => {
    const project = await mkdtemp(join(tmpdir(), "zox-listen-context-"));
    const hookDir = join(project, ".zox");
    await mkdir(hookDir, { recursive: true });
    await writeFile(
      join(hookDir, "config.json"),
      JSON.stringify({ context: { overflowThreshold: 0.42 } }),
    );

    prevCwd = process.cwd();
    process.chdir(project);
    const server = await listen({
      port: 0,
      token: "context-test-token",
      sandboxMode: "host",
    });
    servers.push(server);

    const cfg = await fetch(`http://127.0.0.1:${server.port}/config`, {
      headers: { Authorization: "Bearer context-test-token" },
    });
    expect(cfg.status).toBe(200);
    const json = (await cfg.json()) as {
      context?: { overflowThreshold?: number };
    };
    expect(json.context?.overflowThreshold).toBe(0.42);
  });

  test("creates sessions with model from .zox/config.json when omitted", async () => {
    const project = await mkdtemp(join(tmpdir(), "zox-listen-model-"));
    await mkdir(join(project, ".zox"), { recursive: true });
    await writeFile(
      join(project, ".zox", "config.json"),
      JSON.stringify({
        model: "openrouter/openai/gpt-4.1",
        agent: "plan",
      }),
    );

    prevCwd = process.cwd();
    process.chdir(project);
    const server = await listen({
      port: 0,
      token: "model-test-token",
      sandboxMode: "host",
      workspaceRoot: project,
    });
    servers.push(server);

    const created = await fetch(`http://127.0.0.1:${server.port}/sessions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer model-test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ workspaceRoot: project }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as { model: string; agent: string };
    expect(session.model).toBe("openrouter/openai/gpt-4.1");
    expect(session.agent).toBe("plan");
  });

  test("rejects listen when observability.otlp.endpoint is not a URL", async () => {
    const project = await mkdtemp(join(tmpdir(), "zox-listen-otlp-"));
    await mkdir(join(project, ".zox"), { recursive: true });
    await writeFile(
      join(project, ".zox", "config.json"),
      JSON.stringify({
        observability: { otlp: { endpoint: "not-a-url" } },
      }),
    );

    prevCwd = process.cwd();
    process.chdir(project);
    await expect(
      listen({
        port: 0,
        token: "otlp-bad-token",
        sandboxMode: "host",
      }),
    ).rejects.toThrow("Invalid OTLP endpoint: not-a-url");
  });
});
