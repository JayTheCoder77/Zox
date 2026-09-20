export type TaskTrials = {
  taskId: string;
  passes: boolean[];
  latencyMs?: number[];
  usd?: Array<number | null>;
  toolCalls?: number[];
  toolFailures?: number[];
};

export function passAt1(tasks: TaskTrials[]): number {
  if (tasks.length === 0) return 0;
  const hits = tasks.filter((task) => task.passes[0] === true).length;
  return hits / tasks.length;
}

export function passAtK(tasks: TaskTrials[], k: number): number {
  if (tasks.length === 0) return 0;
  const hits = tasks.filter((task) =>
    task.passes.slice(0, k).some(Boolean),
  ).length;
  return hits / tasks.length;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const even = sorted.length % 2 === 0;
  if (even) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? null;
}

function meanNullable(values: Array<number | null | undefined>): number | null {
  const nums = values.filter(
    (value): value is number => typeof value === "number",
  );
  if (nums.length === 0) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

export function formatPrivateAggregate(opts: {
  tasks: TaskTrials[];
  k: number;
}): string {
  const { tasks, k } = opts;
  const n = tasks.length;
  const at1 = Math.round(passAt1(tasks) * n);
  const atK = Math.round(passAtK(tasks, k) * n);
  const latencies = tasks.flatMap((task) => task.latencyMs ?? []);
  const med = median(latencies);
  const usd = tasks
    .map((task) => {
      const avg = meanNullable(task.usd ?? []);
      return `${task.taskId}=${avg === null ? "n/a" : String(avg)}`;
    })
    .join(" ");
  const tools = tasks
    .map((task) => {
      const avg = meanNullable(task.toolCalls ?? []);
      return `${task.taskId}=${avg === null ? "n/a" : String(avg)}`;
    })
    .join(" ");
  const lines = [`pass@1 ${at1}/${n}`];
  if (k > 1) lines.push(`pass@${k} ${atK}/${n}`);
  lines.push(`median latency_ms ${med === null ? "n/a" : String(med)}`);
  lines.push(`$/task ${usd}`);
  lines.push(`tools/task ${tools}`);
  return lines.join("\n");
}
