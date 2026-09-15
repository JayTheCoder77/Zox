import { describe, expect, test } from "bun:test";
import { estimateSession, estimateTokens } from "./estimate.ts";

describe("estimateTokens", () => {
  test("ceil(chars/4)", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("estimateSession", () => {
  test("sums message contents", () => {
    expect(estimateSession([{ content: "abcd" }, { content: "x" }])).toBe(2);
  });
});
