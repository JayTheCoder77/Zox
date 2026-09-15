import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadHooksFile, runHooks } from "./runner.ts";
import type { HookInput, HooksFile } from "./types.ts";

async function writeScript(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zox-hook-script-"));
  const path = join(dir, "hook.sh");
  await Bun.write(path, body);
  await chmod(path, 0o755);
  return path;
}

function input(overrides: Partial<HookInput> = {}): HookInput {
  return {
    event: "PreToolUse",
    session: { id: "sess_1", workspaceRoot: "/tmp/ws" },
    tool: { name: "bash", arguments: { command: "ls" } },
    ...overrides,
  };
}

function hooksFile(command: string, matcher = "bash"): HooksFile {
  return {
    zoxHooksVersion: 1,
    hooks: {
      PreToolUse: [{ matcher, type: "command", command }],
    },
  };
}

describe("runHooks", () => {
  test("PreToolUse matcher bash denies when command prints deny JSON", async () => {
    const command = await writeScript(
      `#!/bin/sh\nprintf '{"decision":"deny"}\\n'\n`,
    );
    const result = await runHooks({
      files: [hooksFile(command)],
      event: "PreToolUse",
      input: input(),
      matchValue: "bash",
      trusted: true,
      cwd: process.cwd(),
    });
    expect(result.decision).toBe("deny");
  });

  test("untrusted skips project file and allows without running the command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zox-hook-untrusted-"));
    const marker = join(dir, "ran");
    const command = await writeScript(
      `#!/bin/sh\ntouch "${marker}"\nprintf '{"decision":"deny"}\\n'\n`,
    );
    const result = await runHooks({
      files: [hooksFile(command)],
      event: "PreToolUse",
      input: input(),
      matchValue: "bash",
      trusted: false,
      cwd: process.cwd(),
    });
    expect(result.decision).toBe("allow");
    expect(await Bun.file(marker).exists()).toBe(false);
  });

  test("untrusted still runs user hooks when only the project file is untrusted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zox-hook-split-trust-"));
    const projectMarker = join(dir, "project-ran");
    const userMarker = join(dir, "user-ran");
    const projectCommand = await writeScript(
      `#!/bin/sh\ntouch "${projectMarker}"\nprintf '{"decision":"allow"}\\n'\n`,
    );
    const userCommand = await writeScript(
      `#!/bin/sh\ntouch "${userMarker}"\nprintf '{"decision":"deny"}\\n'\n`,
    );
    const result = await runHooks({
      files: [
        { ...hooksFile(projectCommand), trusted: false },
        { ...hooksFile(userCommand), trusted: true },
      ],
      event: "PreToolUse",
      input: input(),
      matchValue: "bash",
      cwd: process.cwd(),
    });
    expect(result.decision).toBe("deny");
    expect(await Bun.file(projectMarker).exists()).toBe(false);
    expect(await Bun.file(userMarker).exists()).toBe(true);
  });

  test("exit 2 is deny", async () => {
    const command = await writeScript(`#!/bin/sh\nexit 2\n`);
    const result = await runHooks({
      files: [hooksFile(command)],
      event: "PreToolUse",
      input: input(),
      matchValue: "bash",
      trusted: true,
      cwd: process.cwd(),
    });
    expect(result.decision).toBe("deny");
  });

  test("other exits warn then allow by default", async () => {
    const command = await writeScript(`#!/bin/sh\nexit 1\n`);
    const result = await runHooks({
      files: [hooksFile(command)],
      event: "PreToolUse",
      input: input(),
      matchValue: "bash",
      trusted: true,
      cwd: process.cwd(),
    });
    expect(result.decision).toBe("allow");
  });

  test("SessionStart ignore deny", async () => {
    const command = await writeScript(
      `#!/bin/sh\nprintf '{"decision":"deny"}\\n'\n`,
    );
    const result = await runHooks({
      files: [
        {
          zoxHooksVersion: 1,
          hooks: {
            SessionStart: [{ matcher: "*", type: "command", command }],
          },
        },
      ],
      event: "SessionStart",
      input: input({ event: "SessionStart", tool: undefined }),
      matchValue: "startup",
      trusted: true,
      cwd: process.cwd(),
    });
    expect(result.decision).toBe("allow");
  });

  test("PostToolUse and SessionEnd cannot deny", async () => {
    const command = await writeScript(
      `#!/bin/sh\nprintf '{"decision":"deny"}\\n'\n`,
    );
    for (const event of ["PostToolUse", "SessionEnd"] as const) {
      const result = await runHooks({
        files: [
          {
            zoxHooksVersion: 1,
            hooks: {
              [event]: [{ matcher: "*", type: "command", command }],
            },
          },
        ],
        event,
        input: input({ event, tool: undefined }),
        matchValue: "bash",
        trusted: true,
        cwd: process.cwd(),
      });
      expect(result.decision).toBe("allow");
    }
  });

  test("non-matching matcher does not run the command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zox-hook-nomatch-"));
    const marker = join(dir, "ran");
    const command = await writeScript(
      `#!/bin/sh\ntouch "${marker}"\nprintf '{"decision":"deny"}\\n'\n`,
    );
    const result = await runHooks({
      files: [hooksFile(command, "write")],
      event: "PreToolUse",
      input: input(),
      matchValue: "bash",
      trusted: true,
      cwd: process.cwd(),
    });
    expect(result.decision).toBe("allow");
    expect(await Bun.file(marker).exists()).toBe(false);
  });
});

describe("loadHooksFile", () => {
  test("parses zoxHooksVersion 1 JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zox-hooks-file-"));
    const path = join(dir, "hooks.json");
    await Bun.write(
      path,
      JSON.stringify({
        zoxHooksVersion: 1,
        hooks: {
          Stop: [{ matcher: "*", type: "command", command: "true" }],
        },
      }),
    );
    const file = loadHooksFile(path);
    expect(file.zoxHooksVersion).toBe(1);
    expect(file.hooks.Stop?.[0]?.command).toBe("true");
  });
});
