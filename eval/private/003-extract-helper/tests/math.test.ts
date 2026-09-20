import { expect, test } from "bun:test";
import { incA, incB } from "./math.ts";

test("increments", () => {
  expect(incA(1)).toBe(2);
  expect(incB(3)).toBe(4);
});
