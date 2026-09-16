import { describe, expect, test } from "bun:test";
import { buildSkillsCatalog } from "./catalog.ts";

describe("buildSkillsCatalog", () => {
  test("returns undefined when catalog is false", () => {
    expect(
      buildSkillsCatalog([{ name: "a", description: "alpha" }], {
        catalog: false,
      }),
    ).toBeUndefined();
  });

  test("returns undefined when there are no skills", () => {
    expect(buildSkillsCatalog([])).toBeUndefined();
  });

  test("caps skill count and description length", () => {
    const text = buildSkillsCatalog(
      [
        { name: "one", description: "x".repeat(50) },
        { name: "two", description: "second" },
        { name: "three", description: "third" },
      ],
      { catalogMaxSkills: 2, catalogMaxDescriptionChars: 8 },
    );
    expect(text).toContain("Available skills");
    expect(text).toContain("- one:");
    expect(text).toContain("xxxxxxxx");
    expect(text).not.toContain("xxxxxxxxx");
    expect(text).toContain("- two:");
    expect(text).not.toContain("- three:");
  });
});
