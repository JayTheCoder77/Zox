import { existsSync } from "node:fs";
import { extname, join } from "node:path";

const TSC_TIMEOUT_MS = 15_000;
const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const DIAGNOSTIC_LINE = /^(.*)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

export type LspDiagnostic = {
  file: string;
  line: number;
  character: number;
  message: string;
  code?: string;
};

export type TscExec = (
  argv: string[],
  cwd: string,
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export async function typescriptDiagnostics(opts: {
  sandboxRoot: string;
  filePath: string;
  exec?: TscExec;
}): Promise<LspDiagnostic[]> {
  if (!TS_EXTENSIONS.has(extname(opts.filePath).toLowerCase())) {
    return [];
  }

  const argv = existsSync(join(opts.sandboxRoot, "tsconfig.json"))
    ? ["tsc", "--noEmit", "--pretty", "false", "-p", opts.sandboxRoot]
    : ["tsc", "--noEmit", "--pretty", "false", opts.filePath];

  try {
    const result = await (opts.exec ?? defaultExec)(argv, opts.sandboxRoot);
    return parseDiagnostics(`${result.stdout}\n${result.stderr}`);
  } catch {
    return [];
  }
}

export function formatDiagnostics(diags: LspDiagnostic[]): string {
  if (diags.length === 0) return "";
  const lines = diags.map(
    (diag) => `${diag.file}:${diag.line}:${diag.character}: ${diag.message}`,
  );
  return `--- diagnostics (typescript) ---\n${lines.join("\n")}`;
}

function parseDiagnostics(output: string): LspDiagnostic[] {
  const diags: LspDiagnostic[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const match = DIAGNOSTIC_LINE.exec(raw);
    if (!match) continue;
    const file = match[1];
    const line = match[2];
    const character = match[3];
    const code = match[4];
    const message = match[5];
    if (
      file === undefined ||
      line === undefined ||
      character === undefined ||
      code === undefined ||
      message === undefined
    ) {
      continue;
    }
    diags.push({
      file,
      line: Number(line),
      character: Number(character),
      message,
      code,
    });
  }
  return diags;
}

async function defaultExec(
  argv: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const subprocess = Bun.spawn(argv, {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    subprocess.kill("SIGKILL");
  }, TSC_TIMEOUT_MS);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]);
    if (timedOut) {
      throw new Error("tsc timed out");
    }
    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timer);
  }
}
