// Newline-delimited JSON-RPC over stdio instead of @modelcontextprotocol/sdk so bun test can spawn the fixture without extra transport deps.

export type McpServerSpec = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpListedTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

function mergedEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return extra ? { ...env, ...extra } : env;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class McpStdioClient {
  private readonly proc: ReturnType<typeof Bun.spawn>;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private buffer = "";
  private closed = false;

  constructor(spec: McpServerSpec) {
    this.proc = Bun.spawn([spec.command, ...(spec.args ?? [])], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: mergedEnv(spec.env),
    });
    void this.readStdout();
    void this.drainStderr();
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "zox", version: "0.0.0" },
    });
    this.notify("notifications/initialized");
  }

  async listTools(): Promise<McpListedTool[]> {
    const result = await this.request("tools/list", {});
    if (!isRecord(result) || !Array.isArray(result.tools)) {
      return [];
    }
    const tools: McpListedTool[] = [];
    for (const item of result.tools) {
      if (!isRecord(item) || typeof item.name !== "string") {
        continue;
      }
      const inputSchema = isRecord(item.inputSchema) ? item.inputSchema : {};
      tools.push({
        name: item.name,
        description:
          typeof item.description === "string" ? item.description : "",
        inputSchema,
      });
    }
    return tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; text: string }> {
    const result = await this.request("tools/call", {
      name,
      arguments: args,
    });
    const text = textFromCallResult(result);
    const isError = isRecord(result) && result.isError === true;
    return { ok: !isError, text };
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const waiting of this.pending.values()) {
      waiting.reject(new Error("MCP stdio client closed"));
    }
    this.pending.clear();
    this.proc.kill();
    await this.proc.exited;
  }

  private notify(method: string): void {
    this.write({ jsonrpc: "2.0", method });
  }

  private request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`MCP request timed out: ${method}`));
        }
      }, 10_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  private write(message: Record<string, unknown>): void {
    if (this.closed) {
      return;
    }
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private async readStdout(): Promise<void> {
    const reader = this.proc.stdout.getReader();
    const decoder = new TextDecoder();
    try {
      while (!this.closed) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        this.buffer += decoder.decode(value, { stream: true });
        let newline = this.buffer.indexOf("\n");
        while (newline !== -1) {
          const line = this.buffer.slice(0, newline).trim();
          this.buffer = this.buffer.slice(newline + 1);
          if (line.length > 0) {
            this.dispatch(line);
          }
          newline = this.buffer.indexOf("\n");
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async drainStderr(): Promise<void> {
    const reader = this.proc.stderr.getReader();
    try {
      while (!this.closed) {
        const { done } = await reader.read();
        if (done) {
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private dispatch(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(parsed) || parsed.id === undefined) {
      return;
    }
    const id = parsed.id;
    if (typeof id !== "number") {
      return;
    }
    const waiting = this.pending.get(id);
    if (!waiting) {
      return;
    }
    this.pending.delete(id);
    if (isRecord(parsed.error) && typeof parsed.error.message === "string") {
      waiting.reject(new Error(parsed.error.message));
      return;
    }
    waiting.resolve(parsed.result);
  }
}

function textFromCallResult(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return typeof result === "string" ? result : JSON.stringify(result);
  }
  const parts: string[] = [];
  for (const part of result.content) {
    if (isRecord(part) && typeof part.text === "string") {
      parts.push(part.text);
    }
  }
  return parts.join("\n");
}
