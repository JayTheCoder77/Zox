export type StatusBarInput = {
  model: string;
  agent: string;
  cwd: string;
  inputTokens: number;
  outputTokens: number;
};

export function formatStatus(input: StatusBarInput): string {
  const { model, agent, cwd, inputTokens, outputTokens } = input;
  return `${model} · ${agent} · ${cwd} · ${inputTokens}/${outputTokens}`;
}

export function foldTool(name: string, ok: boolean): string {
  return `${name} ${ok ? "ok" : "denied"}`;
}
