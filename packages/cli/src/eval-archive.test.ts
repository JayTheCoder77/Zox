import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveEvalRun } from "./eval-archive.ts";

describe("archiveEvalRun", () => {
  test("creates a tar.gz of predictions, results, and tasks", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-archive-"));
    await mkdir(join(root, "eval/results"), { recursive: true });
    await mkdir(join(root, "eval/private"), { recursive: true });
    await mkdir(join(root, "eval/tasks"), { recursive: true });
    await writeFile(join(root, "predictions.jsonl"), "{}\n");
    await writeFile(join(root, "eval/results/keep.txt"), "ok\n");
    const dest = join(root, "eval.tgz");
    const archived = await archiveEvalRun({ cwd: root, dest });
    expect(archived).toBe(dest);
    const listing = Bun.spawn(["tar", "tzf", dest], { stdout: "pipe" });
    const names = await new Response(listing.stdout).text();
    expect(names).toContain("predictions.jsonl");
    expect(names).toContain("eval/results/keep.txt");
  });
});
