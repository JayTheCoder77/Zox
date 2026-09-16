import { describe, expect, test } from "bun:test";
import { foldTool, formatStatus, toolInvocationSummary } from "./format.ts";

describe("formatStatus", () => {
  test("shows context fill and labeled API usage totals", () => {
    const line = formatStatus({
      model: "mock/echo",
      agent: "build",
      cwd: "/tmp/ws",
      contextEstimated: 12_000,
      contextWindow: 128_000,
      contextWindowKnown: false,
      inputTokens: 49_607,
      outputTokens: 953,
    });
    expect(line).not.toContain("\n");
    expect(line).toContain("mock/echo");
    expect(line).toContain("build");
    expect(line).toContain("ctx");
    expect(line).toContain("12k");
    expect(line).toContain("~128k");
    expect(line).toContain("(9%)");
    expect(line).toContain("in 50k");
    expect(line).toContain("out 953");
    expect(line).not.toMatch(/49607\/953/);
  });
});

describe("toolInvocationSummary", () => {
  test("bash shows command", () => {
    expect(toolInvocationSummary("bash", { command: "ls -la" })).toContain(
      "ls -la",
    );
  });

  test("read shows path", () => {
    expect(toolInvocationSummary("read", { path: "src/foo.ts" })).toContain(
      "src/foo.ts",
    );
  });
});

describe("foldTool", () => {
  test("ok tool contains summary and ok", () => {
    expect(foldTool("read", true, { path: "a.ts" })).toContain("a.ts");
    expect(foldTool("read", true, { path: "a.ts" })).toContain("ok");
  });

  test("denied tool contains summary and denied", () => {
    expect(foldTool("bash", false, { command: "rm -rf" })).toContain("rm");
    expect(foldTool("bash", false, { command: "rm -rf" })).toContain("denied");
  });
});
