import { describe, expect, test } from "bun:test";
import { taskTool } from "./task.ts";

describe("task tool", () => {
  test("execute without runSubagent returns error", async () => {
    const result = await taskTool.execute(
      { prompt: "investigate" },
      {
        sandboxRoot: "/tmp",
        maxToolOutputChars: 1000,
        session: { id: "s1", workspaceRoot: "/tmp", agent: "build" },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("Subagent");
  });
});
