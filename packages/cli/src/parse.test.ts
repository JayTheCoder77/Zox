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
    for (const name of [
      "help",
      "model",
      "agent",
      "compact",
      "context",
      "usage",
      "clear",
      "mcp",
      "skill",
      "cancel",
      "sandbox",
      "trace",
      "exit",
    ]) {
      expect(SLASH_NAMES).toContain(name);
    }
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
