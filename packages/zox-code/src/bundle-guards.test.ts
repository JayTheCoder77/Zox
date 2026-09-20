import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { forbiddenRuntimeImports } from "./bundle-guards.ts";

describe("forbiddenRuntimeImports", () => {
  test("flags ink optional packages left external", () => {
    expect(
      forbiddenRuntimeImports('import m3e from"react-devtools-core";'),
    ).toEqual(["react-devtools-core"]);
    expect(forbiddenRuntimeImports('import A3e from"ws";')).toEqual(["ws"]);
  });

  test("allows a self-contained bundle", () => {
    expect(
      forbiddenRuntimeImports("#!/usr/bin/env bun\nconsole.log(1)"),
    ).toEqual([]);
  });

  test("buildCli emits no leftover ink optional imports", async () => {
    const repoRoot = join(import.meta.dir, "../../..");
    const proc = Bun.spawn(["bun", "packages/zox-code/build.ts"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    expect(code).toBe(0);
    const source = await Bun.file(
      join(import.meta.dir, "../dist/cli.js"),
    ).text();
    expect(forbiddenRuntimeImports(source)).toEqual([]);
  });
});
