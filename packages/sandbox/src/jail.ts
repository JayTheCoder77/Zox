import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

export type JailResult =
  | { ok: true; path: string }
  | { ok: false; reason: string };

export async function jailPath(
  root: string,
  candidate: string,
): Promise<JailResult> {
  const lexicalRoot = resolve(root);
  const resolvedRoot = await realpath(root);
  const requested = isAbsolute(candidate)
    ? candidate
    : resolve(lexicalRoot, candidate);
  let real: string;
  try {
    real = await realpath(requested);
  } catch {
    const parent = await realpath(resolve(requested, "..")).catch(() => null);
    if (!parent) {
      return { ok: false, reason: "path jail: parent does not exist" };
    }
    if (outside(resolvedRoot, parent)) {
      return { ok: false, reason: "path jail: escaped sandbox.root" };
    }
    real = join(parent, requested.split("/").pop() ?? requested);
    if (outside(resolvedRoot, real)) {
      return { ok: false, reason: "path jail: escaped sandbox.root" };
    }
    return { ok: true, path: join(lexicalRoot, relative(resolvedRoot, real)) };
  }
  if (outside(resolvedRoot, real)) {
    return { ok: false, reason: "path jail: escaped sandbox.root" };
  }
  return { ok: true, path: join(lexicalRoot, relative(resolvedRoot, real)) };
}

function outside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === ".." || rel.startsWith(`..${"/"}`) || isAbsolute(rel);
}
