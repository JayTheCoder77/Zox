import { describe, expect, test } from "bun:test";
import { foldTool, formatStatus } from "./format.ts";

describe("formatStatus", () => {
  test("single line containing model, agent, cwd, and token counts", () => {
    const line = formatStatus({
      model: "mock/echo",
      agent: "build",
      cwd: "/tmp/ws",
      inputTokens: 1200,
      outputTokens: 340,
    });
    expect(line).not.toContain("\n");
    expect(line).toContain("mock/echo");
    expect(line).toContain("build");
    expect(line).toContain("/tmp/ws");
    expect(line).toContain("1200");
    expect(line).toContain("340");
  });
});

describe("foldTool", () => {
  test("ok tool contains name and ok", () => {
    expect(foldTool("read", true)).toContain("read");
    expect(foldTool("read", true)).toContain("ok");
  });

  test("denied tool contains name and denied", () => {
    expect(foldTool("bash", false)).toContain("bash");
    expect(foldTool("bash", false)).toContain("denied");
  });
});
