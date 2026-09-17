import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatDiagnostics, typescriptDiagnostics } from "./typescript.ts";

describe("typescript diagnostics", () => {
  test("parses tsc pretty-false lines", async () => {
    const diags = await typescriptDiagnostics({
      sandboxRoot: "/ws",
      filePath: "/ws/src/a.ts",
      exec: async () => ({
        stdout:
          "src/a.ts(3,1): error TS2322: Type 'string' is not assignable to type 'number'.\n",
        stderr: "",
        exitCode: 2,
      }),
    });
    expect(diags[0]).toMatchObject({
      file: "src/a.ts",
      line: 3,
      character: 1,
      code: "TS2322",
    });
  });

  test("skips non-ts files", async () => {
    const diags = await typescriptDiagnostics({
      sandboxRoot: "/ws",
      filePath: "/ws/README.md",
      exec: async () => {
        throw new Error("should not spawn");
      },
    });
    expect(diags).toEqual([]);
  });

  test("runs tsc -p when tsconfig.json exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-lsp-"));
    await Bun.write(join(root, "tsconfig.json"), "{}");
    let argv: string[] = [];
    let cwd = "";
    await typescriptDiagnostics({
      sandboxRoot: root,
      filePath: join(root, "src/a.ts"),
      exec: async (received, receivedCwd) => {
        argv = received;
        cwd = receivedCwd;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    expect(argv).toEqual(["tsc", "--noEmit", "--pretty", "false", "-p", root]);
    expect(cwd).toBe(root);
  });

  test("runs tsc on the file when tsconfig.json is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-lsp-"));
    const filePath = join(root, "a.tsx");
    let argv: string[] = [];
    await typescriptDiagnostics({
      sandboxRoot: root,
      filePath,
      exec: async (received) => {
        argv = received;
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    });
    expect(argv).toEqual(["tsc", "--noEmit", "--pretty", "false", filePath]);
  });

  test("returns empty diagnostics when spawn fails", async () => {
    const diags = await typescriptDiagnostics({
      sandboxRoot: "/ws",
      filePath: "/ws/a.mts",
      exec: async () => {
        throw new Error("tsc missing");
      },
    });
    expect(diags).toEqual([]);
  });

  test("formats diagnostics for tool output", () => {
    expect(
      formatDiagnostics([
        {
          file: "src/a.ts",
          line: 3,
          character: 1,
          message: "Type 'string' is not assignable to type 'number'.",
          code: "TS2322",
        },
      ]),
    ).toBe(
      "--- diagnostics (typescript) ---\nsrc/a.ts:3:1: Type 'string' is not assignable to type 'number'.",
    );
    expect(formatDiagnostics([])).toBe("");
  });
});
