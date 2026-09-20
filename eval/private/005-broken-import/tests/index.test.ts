import { expect, test } from "bun:test";
import { ok } from "./index.ts";

test("ok", () => {
  expect(ok()).toBe("ok");
});
