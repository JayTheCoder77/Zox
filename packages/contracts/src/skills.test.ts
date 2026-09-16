import { describe, expect, test } from "bun:test";
import {
  mutateSessionSkillsRequestSchema,
  sessionSkillsResponseSchema,
  skillSummarySchema,
} from "./skills.ts";

describe("skill DTOs", () => {
  test("parses a catalog summary", () => {
    const parsed = skillSummarySchema.parse({
      name: "helper",
      description: "help",
      path: "/ws/.zox/skills/helper/SKILL.md",
    });
    expect(parsed.name).toBe("helper");
  });

  test("parses session skills GET", () => {
    const parsed = sessionSkillsResponseSchema.parse({
      catalog: [{ name: "helper", description: "help" }],
      active: [{ name: "helper", body: "do x", path: "/x" }],
    });
    expect(parsed.active[0]?.name).toBe("helper");
  });

  test("parses load/unload POST", () => {
    expect(
      mutateSessionSkillsRequestSchema.parse({
        action: "load",
        name: "helper",
      }),
    ).toEqual({ action: "load", name: "helper" });
  });
});
