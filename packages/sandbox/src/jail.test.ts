import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jailPath } from "./jail.ts";

describe("jailPath", () => {
  test("resolves a path inside the root", async () => {
    const root = await makeTmpDir();
    await Bun.write(join(root, "hello.txt"), "ok");
    const result = await jailPath(root, "hello.txt");
    expect(result).toEqual({
      ok: true,
      path: join(await realpath(root), "hello.txt"),
    });
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

  test("returns the canonical path through an in-jail symlink", async () => {
    const root = await makeTmpDir();
    const realDir = join(root, "real");
    await mkdir(realDir);
    await Bun.write(join(realDir, "hello.txt"), "ok");
    await symlink(realDir, join(root, "link"));

    expect(await jailPath(root, "link/hello.txt")).toEqual({
      ok: true,
      path: join(await realpath(realDir), "hello.txt"),
    });
    expect(await jailPath(root, "link/new.txt")).toEqual({
      ok: true,
      path: join(await realpath(realDir), "new.txt"),
    });
  });

  test("returns paths under the real root when the sandbox root is a symlink", async () => {
    const parent = await makeTmpDir();
    const realRoot = join(parent, "real-root");
    const linkedRoot = join(parent, "linked-root");
    await mkdir(realRoot);
    await Bun.write(join(realRoot, "hello.txt"), "ok");
    await symlink(realRoot, linkedRoot);

    const canonicalRoot = await realpath(realRoot);
    expect(await jailPath(linkedRoot, "hello.txt")).toEqual({
      ok: true,
      path: join(canonicalRoot, "hello.txt"),
    });
    expect(await jailPath(linkedRoot, "new.txt")).toEqual({
      ok: true,
      path: join(canonicalRoot, "new.txt"),
    });
  });
});

async function makeTmpDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "zox-jail-"));
}
