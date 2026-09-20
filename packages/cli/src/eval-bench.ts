import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CliFlags } from "./parse.ts";

export const DEFAULT_SMOKE_LIMIT = 3;

export function assertOfficialBenchModel(
  kind: string,
  model: string | undefined,
): void {
  if (!model) {
    throw new Error(`${kind} requires --model <provider/id>`);
  }
  if (model.startsWith("mock/")) {
    throw new Error(`${kind} reject mock models; pass a real --model`);
  }
}

export async function loadSmokeIds(
  path: string,
  key: string,
): Promise<string[]> {
  const raw = JSON.parse(await readFile(path, "utf8")) as Record<
    string,
    unknown
  >;
  const ids = raw[key];
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    throw new Error(`invalid smoke manifest ${path}`);
  }
  return ids;
}

export function selectSmokeIds(
  smoke: string[],
  flags: Pick<CliFlags, "instanceIds" | "tasks" | "limit"> = {},
): string[] {
  const explicit = flags.instanceIds?.length
    ? flags.instanceIds
    : flags.tasks?.length
      ? flags.tasks
      : smoke;
  const limit = flags.limit ?? DEFAULT_SMOKE_LIMIT;
  return explicit.slice(0, limit);
}

export async function commandExists(name: string): Promise<boolean> {
  const proc = Bun.spawn(["which", name], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return (await proc.exited) === 0;
}

export function pythonCandidates(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const bins: string[] = [];
  if (env.VIRTUAL_ENV) {
    bins.push(join(env.VIRTUAL_ENV, "bin", "python"));
  }
  bins.push(join(repoRoot, ".venv", "bin", "python"));
  bins.push("python3", "python");
  return [...new Set(bins)];
}

export async function resolvePythonWithModule(
  mod: string,
  opts: {
    repoRoot: string;
    env?: NodeJS.ProcessEnv;
    tryImport?: (bin: string) => Promise<boolean>;
  },
): Promise<string | undefined> {
  const tryImport =
    opts.tryImport ??
    (async (bin: string) => {
      const proc = Bun.spawn([bin, "-c", `import ${mod}`], {
        stdout: "ignore",
        stderr: "ignore",
      });
      return (await proc.exited) === 0;
    });
  for (const bin of pythonCandidates(opts.repoRoot, opts.env ?? process.env)) {
    if (await tryImport(bin)) return bin;
  }
  return undefined;
}

export async function pythonModuleExists(
  mod: string,
  opts: { repoRoot?: string } = {},
): Promise<boolean> {
  const bin = await resolvePythonWithModule(mod, {
    repoRoot: opts.repoRoot ?? process.cwd(),
  });
  return Boolean(bin);
}

export const BUN_VERSION = "1.4.0";
export const LINUX_BUN_SLUGS = ["bun-linux-aarch64", "bun-linux-x64"] as const;

export function linuxBunSlug(arch: string): string {
  if (arch === "aarch64" || arch === "arm64") return "bun-linux-aarch64";
  return "bun-linux-x64";
}

export function linuxBunDownloadUrls(slug: string): string[] {
  return [
    `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${slug}.zip`,
    `https://registry.npmjs.org/@oven/${slug}/-/${slug}-${BUN_VERSION}.tgz`,
  ];
}

export function cachedLinuxBunPath(repoRoot: string, slug: string): string {
  return join(repoRoot, "eval/benchmarks/cache/bun", slug, "bun");
}

export async function dockerAvailable(): Promise<boolean> {
  if (!(await commandExists("docker"))) return false;
  const proc = Bun.spawn(["docker", "info"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return (await proc.exited) === 0;
}
