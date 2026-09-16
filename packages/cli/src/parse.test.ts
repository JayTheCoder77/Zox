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
});
