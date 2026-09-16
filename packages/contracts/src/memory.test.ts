import { describe, expect, test } from "bun:test";
import {
  memorySearchResponseSchema,
  sessionMemoryResponseSchema,
  writeMemoryRequestSchema,
} from "./memory.ts";

describe("memory DTOs", () => {
  test("write request requires content and optional pin", () => {
    expect(writeMemoryRequestSchema.parse({ content: "pin this" })).toEqual({
      content: "pin this",
    });
    expect(
      writeMemoryRequestSchema.parse({ content: "fact", pinned: true }),
    ).toEqual({ content: "fact", pinned: true });
    expect(() => writeMemoryRequestSchema.parse({ content: "" })).toThrow();
  });

  test("search response lists durable hits", () => {
    const parsed = memorySearchResponseSchema.parse({
      memories: [
        {
          id: "mem_1",
          scope: "project",
          content: "alpha",
          pinned: true,
        },
      ],
    });
    expect(parsed.memories[0]?.pinned).toBe(true);
  });

  test("session memory includes injectedDurableIds", () => {
    const parsed = sessionMemoryResponseSchema.parse({
      planJson: null,
      priorStateMarkdown: "",
      activeSkills: [],
      injectedDurableIds: ["mem_1"],
    });
    expect(parsed.injectedDurableIds).toEqual(["mem_1"]);
  });
});
