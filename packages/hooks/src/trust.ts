import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export type TrustOptions = {
  storePath?: string;
};

export function defaultTrustStorePath(): string {
  return resolve(homedir(), ".config", "zox", "trusted-projects.json");
}

export async function isProjectTrusted(
  projectRoot: string,
  opts: TrustOptions = {},
): Promise<boolean> {
  const abs = resolve(projectRoot);
  const store = await readStore(opts.storePath ?? defaultTrustStorePath());
  return store[abs] === hashPath(abs);
}

export async function recordTrust(
  projectRoot: string,
  opts: TrustOptions = {},
): Promise<void> {
  const abs = resolve(projectRoot);
  const storePath = opts.storePath ?? defaultTrustStorePath();
  const store = await readStore(storePath);
  store[abs] = hashPath(abs);
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`);
}

function hashPath(absPath: string): string {
  return createHash("sha256").update(absPath).digest("hex");
}

async function readStore(storePath: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(storePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}
