import { describe, expect, test } from "bun:test";
import { activateSkill, deactivateSkill } from "./activate.ts";

describe("activateSkill", () => {
  test("appends and dedupes by name, last body wins", () => {
    const once = activateSkill([], { name: "a", body: "1", path: "/a" });
    const twice = activateSkill(once, { name: "a", body: "2", path: "/a" });
    expect(twice).toEqual([{ name: "a", body: "2", path: "/a" }]);
  });
});

describe("deactivateSkill", () => {
  test("removes by name", () => {
    const next = deactivateSkill(
      [
        { name: "a", body: "1" },
        { name: "b", body: "2" },
      ],
      "a",
    );
    expect(next).toEqual([{ name: "b", body: "2" }]);
  });
});
