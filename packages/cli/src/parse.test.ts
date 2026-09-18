import { describe, expect, test } from "bun:test";
import { parseArgs, parseSlash, SLASH_NAMES } from "./parse.ts";

describe("parseSlash", () => {
  test("parses model with provider/model arg", () => {
    expect(parseSlash("/model openai/gpt-4.1")).toEqual({
      name: "model",
      args: ["openai/gpt-4.1"],
    });
  });

  test("returns undefined for non-slash input", () => {
    expect(parseSlash("hello")).toBeUndefined();
  });

  test("parses mcp add with trailing args", () => {
    expect(parseSlash("/mcp add mysrv bun run mcp.ts")).toEqual({
      name: "mcp",
      args: ["add", "mysrv", "bun", "run", "mcp.ts"],
    });
  });

  test("SLASH_NAMES includes all MVP commands", () => {
    const mvpCommands = [
      "help",
      "model",
      "agent",
      "compact",
      "context",
      "usage",
      "clear",
      "mcp",
      "skill",
      "skills",
      "cancel",
      "sandbox",
      "trace",
      "remember",
      "revert",
      "exit",
    ] as const;
    for (const name of mvpCommands) {
      expect(SLASH_NAMES).toContain(name);
    }
    expect(SLASH_NAMES).toContain("skills");
  });
});

describe("parseArgs", () => {
  test("parses sandbox and model flags", () => {
    expect(
      parseArgs(["--sandbox", "host", "--model", "mock/echo"]),
    ).toMatchObject({
      flags: {
        sandbox: "host",
        model: "mock/echo",
      },
    });
  });

  test("parses --sandbox container and remote", () => {
    expect(parseArgs(["--sandbox", "container"]).flags.sandbox).toBe(
      "container",
    );
    expect(parseArgs(["--sandbox", "remote"]).flags.sandbox).toBe("remote");
    expect(parseArgs(["--sandbox", "worktree"]).flags.sandbox).toBe("worktree");
  });

  test("collects positionals after flags", () => {
    expect(parseArgs(["hooks", "trust"]).positionals).toEqual([
      "hooks",
      "trust",
    ]);
    expect(parseArgs(["serve", "--port", "9000"]).positionals).toEqual([
      "serve",
    ]);
  });

  test("parses --session id", () => {
    expect(parseArgs(["--session", "sess_abc"]).flags.session).toBe("sess_abc");
  });

  test("parses --no-tui and --workspace", () => {
    expect(
      parseArgs(["--no-tui", "--workspace", "/tmp/ws", "--agent", "plan"]),
    ).toMatchObject({
      flags: {
        noTui: true,
        workspace: "/tmp/ws",
        agent: "plan",
      },
    });
  });

  test("parses export session positionals and --include-memory", () => {
    const parsed = parseArgs(["agent", "run", "/tmp/repo", "fix the bug"]);
    expect(parsed.positionals).toEqual([
      "agent",
      "run",
      "/tmp/repo",
      "fix the bug",
    ]);
  });

  test("parseArgs agent run flags", () => {
    expect(
      parseArgs([
        "agent",
        "run",
        "/tmp/repo",
        "task",
        "--max-turns",
        "3",
        "--keep-worktree",
        "--auto-approve",
      ]).flags,
    ).toMatchObject({
      maxTurns: 3,
      keepWorktree: true,
      autoApprove: true,
    });
  });

  test("parses --timeout-ms", () => {
    expect(parseArgs(["--timeout-ms", "120000"]).flags.timeoutMs).toBe(120000);
  });

  test("parseArgs legacy", () => {
    const parsed = parseArgs([
      "export",
      "session",
      "sess_abc",
      "--include-memory",
      "--url",
      "http://127.0.0.1:8787",
      "--token",
      "tok",
    ]);
    expect(parsed.positionals).toEqual(["export", "session", "sess_abc"]);
    expect(parsed.flags.includeMemory).toBe(true);
    expect(parsed.flags.url).toBe("http://127.0.0.1:8787");
    expect(parsed.flags.token).toBe("tok");
  });
});
