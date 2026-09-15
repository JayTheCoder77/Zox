import { describe, expect, test } from "bun:test";
import { CONTRACTS_PACKAGE_NAME } from "./index.ts";

describe("monorepo scaffold", () => {
  test("exports the contracts package name", () => {
    expect(CONTRACTS_PACKAGE_NAME).toBe("@zox/contracts");
  });
});
