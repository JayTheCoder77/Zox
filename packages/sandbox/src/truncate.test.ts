import { expect, test } from "bun:test";
import { truncateUtf8 } from "./truncate.ts";

test("truncates without splitting a UTF-8 character", () => {
  const result = truncateUtf8("a😀b", 4);
  expect(result).toEqual({ text: "a", truncated: true });
  expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(4);
});

test("returns text unchanged when within the byte limit", () => {
  expect(truncateUtf8("hello", 5)).toEqual({
    text: "hello",
    truncated: false,
  });
});
