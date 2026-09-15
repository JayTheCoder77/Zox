import { describe, expect, test } from "bun:test";
import { todowriteTool } from "./todowrite.ts";

const ctx = {
  sandboxRoot: "/tmp",
  maxToolOutputChars: 32_000,
  session: { id: "s", workspaceRoot: "/tmp", agent: "build" },
};

describe("todowrite", () => {
  test("returns JSON of validated items", async () => {
    const items = [
      { id: "t1", content: "ship", status: "in_progress" as const },
    ];
    const result = await todowriteTool.execute({ items }, ctx);
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.content)).toEqual(items);
  });

  test("rejects invalid status", async () => {
    const result = await todowriteTool.execute(
      { items: [{ id: "t1", content: "x", status: "nope" }] },
      ctx,
    );
    expect(result.ok).toBe(false);
  });
});
