import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jailPath } from "./jail.ts";

describe("jailPath", () => {
  test("resolves a path inside the root", async () => {
    const root = await makeTmpDir();
    await Bun.write(join(root, "hello.txt"), "ok");
    const result = await jailPath(root, "hello.txt");
    expect(result).toEqual({ ok: true, path: join(root, "hello.txt") });
  });

  test("denies ../ escape", async () => {
    const root = await makeTmpDir();
    const result = await jailPath(root, "../secret");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/jail/i);
  });

  test("denies symlink escape", async () => {
    const parent = await makeTmpDir();
    const root = join(parent, "jail");
    const outside = join(parent, "outside.txt");
    await mkdir(root);
    await Bun.write(outside, "secret");
    await symlink(outside, join(root, "link.txt"));
    const result = await jailPath(root, "link.txt");
    expect(result.ok).toBe(false);
  });
});

async function makeTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "zox-jail-"));
}
