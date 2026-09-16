import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadZoxConfig, resolveConfigEnv } from "./load.ts";
import { zoxConfigSchema } from "./schema.ts";

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

describe("zoxConfigSchema", () => {
  test("parses Phase 1.5 context, budget, memory, and webfetch fields", () => {
    const parsed = zoxConfigSchema.parse({
      context: { overflowThreshold: 0.9 },
      budget: { preCompactTokenThreshold: 120000 },
      memory: {
        autoSummarize: true,
        summarizeModel: "mock/echo",
        startupInjectCount: 5,
        rollingSummary: true,
        autoInject: ["preferences.md"],
      },
      tools: { webfetch: { maxBytes: 32000, allowedHosts: ["example.com"] } },
    });
    expect(parsed.budget?.preCompactTokenThreshold).toBe(120000);
    expect(parsed.tools?.webfetch?.allowedHosts).toEqual(["example.com"]);
  });

  test("parses observability otlp endpoint, headers, enabled, and serviceName", () => {
    const parsed = zoxConfigSchema.parse({
      observability: {
        enabled: true,
        serviceName: "zox-dev",
        recordContent: false,
        otlp: {
          endpoint: "http://localhost:4318/v1/traces",
          headers: { Authorization: "Bearer ${LANGFUSE_OTEL_TOKEN}" },
        },
        metrics: { public: false },
      },
    });
    expect(parsed.observability?.enabled).toBe(true);
    expect(parsed.observability?.serviceName).toBe("zox-dev");
    expect(parsed.observability?.otlp?.endpoint).toBe(
      "http://localhost:4318/v1/traces",
    );
    expect(parsed.observability?.otlp?.headers).toEqual({
      Authorization: "Bearer ${LANGFUSE_OTEL_TOKEN}",
    });
  });
});
