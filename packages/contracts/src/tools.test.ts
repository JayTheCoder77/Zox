import { describe, expect, test } from "bun:test";
import { permissionRulesetSchema } from "./tools.ts";

describe("permissionRulesetSchema", () => {
  test("parses tool defaults and allow and deny lists", () => {
    const parsed = permissionRulesetSchema.parse({
      bash: {
        default: "ask",
        allow: ["git status*"],
        deny: ["rm -rf /"],
      },
    });

    expect(parsed.bash?.default).toBe("ask");
  });

  test("rejects unsupported permission decisions", () => {
    expect(() =>
      permissionRulesetSchema.parse({ bash: { default: "prompt" } }),
    ).toThrow();
  });
});
