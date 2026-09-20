import { resolve } from "node:path";

export async function archiveEvalRun(opts: {
  cwd?: string;
  dest?: string;
}): Promise<string> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-").slice(0, 16);
  const dest = resolve(opts.dest ?? `eval-${stamp}.tar.gz`);
  const argv = ["tar", "czf", dest, "-C", cwd];
  const members = [
    "predictions.jsonl",
    "eval/results",
    "eval/private",
    "eval/tasks",
  ];
  const existing: string[] = [];
  for (const member of members) {
    const check = Bun.spawn(["test", "-e", resolve(cwd, member)], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await check.exited) === 0) existing.push(member);
  }
  if (existing.length === 0) {
    throw new Error("nothing to archive");
  }
  const proc = Bun.spawn([...argv, ...existing], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  if ((await proc.exited) !== 0) {
    throw new Error(`tar failed: ${stderr}`);
  }
  return dest;
}
