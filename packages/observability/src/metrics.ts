export type ZoxMetrics = {
  turns: number;
  toolCalls: Map<string, number>;
  tokensIn: number;
  tokensOut: number;
};

export type CompactionKind = "manual" | "auto";

export function createMetrics(): {
  snapshot(): ZoxMetrics;
  recordTurn(): void;
  recordTool(name: string, denied: boolean): void;
  recordTokens(provider: string, input: number, output: number): void;
  observeTurnDuration(seconds: number): void;
  observeModelLatency(seconds: number): void;
  setContextEstimated(tokens: number): void;
  recordCompaction(kind: CompactionKind): void;
  setSessionCost(usd: number): void;
  observeHookDuration(event: string, seconds: number): void;
  renderPrometheus(): string;
} {
  const toolCalls = new Map<string, number>();
  const tokens = new Map<string, number>();
  const hookDurations = new Map<string, number>();
  const compactions: Record<CompactionKind, number> = {
    manual: 0,
    auto: 0,
  };
  let turns = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let turnDurationSeconds = 0;
  let modelLatencySeconds = 0;
  let contextEstimatedTokens = 0;
  let sessionCostUsd = 0;

  const bump = (map: Map<string, number>, key: string, amount: number) => {
    map.set(key, (map.get(key) ?? 0) + amount);
  };

  return {
    snapshot(): ZoxMetrics {
      return { turns, toolCalls: new Map(toolCalls), tokensIn, tokensOut };
    },
    recordTurn() {
      turns += 1;
    },
    recordTool(name: string, denied: boolean) {
      bump(toolCalls, `${name}|${denied}`, 1);
    },
    recordTokens(provider: string, input: number, output: number) {
      tokensIn += input;
      tokensOut += output;
      bump(tokens, `${provider}|input`, input);
      bump(tokens, `${provider}|output`, output);
    },
    observeTurnDuration(seconds: number) {
      turnDurationSeconds += seconds;
    },
    observeModelLatency(seconds: number) {
      modelLatencySeconds += seconds;
    },
    setContextEstimated(tokensEstimate: number) {
      contextEstimatedTokens = tokensEstimate;
    },
    recordCompaction(kind: CompactionKind) {
      compactions[kind] += 1;
    },
    setSessionCost(usd: number) {
      sessionCostUsd = usd;
    },
    observeHookDuration(event: string, seconds: number) {
      bump(hookDurations, event, seconds);
    },
    renderPrometheus(): string {
      const lines: string[] = [];
      const help = (name: string, type: string, desc: string) => {
        lines.push(`# HELP ${name} ${desc}`);
        lines.push(`# TYPE ${name} ${type}`);
      };

      help("zox_turns_total", "counter", "Total agent turns");
      lines.push(`zox_turns_total ${turns}`);

      help("zox_tool_calls_total", "counter", "Tool invocations");
      if (toolCalls.size === 0) {
        lines.push('zox_tool_calls_total{tool_name="",denied="false"} 0');
      } else {
        for (const [key, value] of toolCalls) {
          const sep = key.lastIndexOf("|");
          const name = key.slice(0, sep);
          const denied = key.slice(sep + 1);
          lines.push(
            `zox_tool_calls_total{tool_name="${escapeLabel(name)}",denied="${denied}"} ${value}`,
          );
        }
      }

      help("zox_tokens_total", "counter", "Tokens consumed");
      if (tokens.size === 0) {
        lines.push('zox_tokens_total{provider="",direction="input"} 0');
        lines.push('zox_tokens_total{provider="",direction="output"} 0');
      } else {
        for (const [key, value] of tokens) {
          const sep = key.lastIndexOf("|");
          const provider = key.slice(0, sep);
          const direction = key.slice(sep + 1);
          lines.push(
            `zox_tokens_total{provider="${escapeLabel(provider)}",direction="${direction}"} ${value}`,
          );
        }
      }

      help(
        "zox_turn_duration_seconds",
        "gauge",
        "Agent turn duration in seconds",
      );
      lines.push(`zox_turn_duration_seconds ${turnDurationSeconds}`);

      help(
        "zox_model_latency_seconds",
        "gauge",
        "Model call latency in seconds",
      );
      lines.push(`zox_model_latency_seconds ${modelLatencySeconds}`);

      help(
        "zox_context_estimated_tokens",
        "gauge",
        "Estimated tokens in the current context",
      );
      lines.push(`zox_context_estimated_tokens ${contextEstimatedTokens}`);

      help("zox_compactions_total", "counter", "Context compact operations");
      lines.push(`zox_compactions_total{kind="manual"} ${compactions.manual}`);
      lines.push(`zox_compactions_total{kind="auto"} ${compactions.auto}`);

      help("zox_session_cost_usd", "gauge", "Estimated session cost in USD");
      lines.push(`zox_session_cost_usd ${sessionCostUsd}`);

      help(
        "zox_hook_duration_seconds",
        "gauge",
        "Hook handler duration in seconds",
      );
      if (hookDurations.size === 0) {
        lines.push('zox_hook_duration_seconds{event=""} 0');
      } else {
        for (const [event, value] of hookDurations) {
          lines.push(
            `zox_hook_duration_seconds{event="${escapeLabel(event)}"} ${value}`,
          );
        }
      }

      return `${lines.join("\n")}\n`;
    },
  };
}

function escapeLabel(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll('"', '\\"');
}
