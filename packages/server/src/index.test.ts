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
    const server = listen({
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
});
