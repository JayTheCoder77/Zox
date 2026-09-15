import { describe, expect, test } from "bun:test";
import { parsePlan, type PlanItem } from "./plan.ts";

const valid: PlanItem[] = [
  { id: "1", content: "first", status: "pending" },
  { id: "2", content: "second", status: "in_progress", notes: "wip" },
  { id: "3", content: "third", status: "done" },
];

describe("parsePlan", () => {
  test("round-trips a valid list", () => {
    expect(parsePlan(valid)).toEqual(valid);
  });

  test("rejects invalid status", () => {
    expect(() =>
      parsePlan([{ id: "a", content: "x", status: "blocked" }]),
    ).toThrow();
  });

  test("rejects non-array input", () => {
    expect(() => parsePlan({ items: [] })).toThrow();
  });

  test("rejects missing required fields", () => {
    expect(() => parsePlan([{ id: "a", status: "pending" }])).toThrow();
  });
});
