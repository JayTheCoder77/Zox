import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isProjectTrusted, recordTrust } from "./trust.ts";

describe("project hook trust", () => {
  test("is untrusted until recordTrust", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zox-trust-"));
    const storePath = join(dir, "trusted-projects.json");
    const projectRoot = join(dir, "proj");
    expect(await isProjectTrusted(projectRoot, { storePath })).toBe(false);
    await recordTrust(projectRoot, { storePath });
    expect(await isProjectTrusted(projectRoot, { storePath })).toBe(true);
  });
});
