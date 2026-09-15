import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ZoxConfig, zoxConfigSchema } from "./schema.ts";

export function resolveZoxConfigPaths(workspaceRoot: string): {
  user: string;
  project: string;
} {
  return {
    user: join(homedir(), ".config", "zox", "config.json"),
    project: join(workspaceRoot, ".zox", "config.json"),
  };
}

export function loadZoxConfig(workspaceRoot: string): ZoxConfig {
  const paths = resolveZoxConfigPaths(workspaceRoot);
  const layers: unknown[] = [];
  if (existsSync(paths.user)) {
    layers.push(parseJsonFile(paths.user));
  }
  if (existsSync(paths.project)) {
    layers.push(parseJsonFile(paths.project));
  }
  const merged = deepMerge({}, ...layers);
  const envOverlay = envConfigOverlay();
  const withEnv = deepMerge(merged, envOverlay);
  return zoxConfigSchema.parse(withEnv);
}

function parseJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function envConfigOverlay(): Record<string, unknown> {
  const memory: Record<string, unknown> = {};
  const auto = process.env.ZOXX_MEMORY_AUTO_SUMMARIZE;
  if (auto === "0" || auto === "false") {
    memory.autoSummarize = false;
  } else if (auto === "1" || auto === "true") {
    memory.autoSummarize = true;
  }
  if (Object.keys(memory).length === 0) return {};
  return { memory };
}

export function resolveConfigEnv(
  value: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    const v = env[name];
    return v ?? "";
  });
}

export function resolveMcpServerEnv(
  env: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!env) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = resolveConfigEnv(value);
  }
  return out;
}

function deepMerge(
  base: Record<string, unknown>,
  ...layers: unknown[]
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const layer of layers) {
    if (!isRecord(layer)) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (isRecord(value) && isRecord(out[key])) {
        out[key] = deepMerge(out[key] as Record<string, unknown>, value);
      } else {
        out[key] = value;
      }
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
