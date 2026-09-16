import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadZoxConfig, resolveConfigEnv } from "./load.ts";

describe("loadZoxConfig", () => {
  test("merges project config over defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-cfg-"));
    await mkdir(join(root, ".zox"), { recursive: true });
    await writeFile(
      join(root, ".zox", "config.json"),
      JSON.stringify({ model: "openai/gpt-4.1", agent: "plan" }),
    );
    const config = loadZoxConfig(root);
    expect(config.model).toBe("openai/gpt-4.1");
    expect(config.agent).toBe("plan");
  });

  test("parses skills catalogMaxSkills from project config", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-cfg-"));
    await mkdir(join(root, ".zox"), { recursive: true });
    await writeFile(
      join(root, ".zox", "config.json"),
      JSON.stringify({ skills: { catalogMaxSkills: 3 } }),
    );
    const config = loadZoxConfig(root);
    expect(config.skills?.catalogMaxSkills).toBe(3);
  });
});

describe("resolveConfigEnv", () => {
  test("substitutes env placeholders", () => {
    expect(resolveConfigEnv("${FOO}", { FOO: "bar" })).toBe("bar");
  });
});
