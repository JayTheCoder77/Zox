import { expect, test } from "bun:test";
import { add } from "./add.ts";

test("adds two numbers", () => {
  expect(add(2, 2)).toBe(4);
});
