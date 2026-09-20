import { expect, test } from "bun:test";
import { join } from "node:path";

test("dry-run does not write out.txt", async () => {
  const cwd = import.meta.dir;
  const proc = Bun.spawn(["bun", "cli.ts", "process", "--dry-run"], {
    cwd,
    stdout: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  expect(out.toLowerCase()).toContain("out.txt");
  expect(await Bun.file(join(cwd, "out.txt")).exists()).toBe(false);
});
