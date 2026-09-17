import { describe, expect, test } from "bun:test";
import { inspectArgv, inspectCommand } from "./denylist.ts";

const defaults = {
  executables: ["sudo", "rm", "mkfs", "dd", "chmod"],
  blockInterpreterOneLiners: true,
  interpreterFlags: ["-c", "-e"],
};

describe("inspectArgv", () => {
  test("allows bun test", () => {
    expect(inspectArgv(["bun", "test"], defaults).denied).toBe(false);
  });

  test("denies sudo basename", () => {
    const result = inspectArgv(["sudo", "ls"], defaults);
    expect(result.denied).toBe(true);
    expect(result.reason).toMatch(/denylist/i);
  });

  test("denies python -c", () => {
    const result = inspectArgv(["python", "-c", "print(1)"], defaults);
    expect(result.denied).toBe(true);
  });

  test("denies shell metacharacters when shell is false", () => {
    const result = inspectArgv(["echo", "a; rm -rf /"], defaults, {
      shell: false,
    });
    expect(result.denied).toBe(true);
  });
});

describe("inspectCommand", () => {
  test("denies a denylisted first token", () => {
    const result = inspectCommand("rm -rf ./build", defaults);
    expect(result.denied).toBe(true);
    expect(result.reason).toMatch(/denylist/i);
  });

  test("allows a command with a safe first token", () => {
    expect(inspectCommand("echo rm", defaults).denied).toBe(false);
  });

  test("denies python -c one-liners in a shell string", () => {
    const result = inspectCommand('python -c "print(1)"', defaults);
    expect(result.denied).toBe(true);
    expect(result.reason).toMatch(/interpreter/i);
  });
});
