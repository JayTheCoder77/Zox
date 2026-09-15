import { describe, expect, test } from "bun:test";
import { matcherHits } from "./match.ts";

describe("matcherHits", () => {
  test("* matches any value", () => {
    expect(matcherHits("*", "bash")).toBe(true);
    expect(matcherHits("*", "")).toBe(true);
  });

  test("JS regex matches tool names", () => {
    expect(matcherHits("bash", "bash")).toBe(true);
    expect(matcherHits("bash|write|edit", "write")).toBe(true);
    expect(matcherHits("bash", "write")).toBe(false);
  });
});
