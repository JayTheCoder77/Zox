#!/usr/bin/env bun

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
};

function write(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function handle(line: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return;
  }
  const msg = parsed as JsonRpcRequest;
  if (msg.method === "initialize") {
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "fake-mcp", version: "0.0.0" },
      },
    });
    return;
  }
  if (msg.method === "notifications/initialized") {
    return;
  }
  if (msg.method === "tools/list") {
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          {
            name: "create_issue",
            description: "Create a fake GitHub issue",
            inputSchema: {
              type: "object",
              properties: { title: { type: "string" } },
            },
          },
        ],
      },
    });
    return;
  }
  if (msg.method === "tools/call") {
    const params = msg.params ?? {};
    const name = typeof params.name === "string" ? params.name : "";
    const args =
      typeof params.arguments === "object" && params.arguments !== null
        ? (params.arguments as Record<string, unknown>)
        : {};
    const title = typeof args.title === "string" ? args.title : "";
    const text =
      name === "create_issue"
        ? `created issue: ${title}`
        : `unknown tool: ${name}`;
    write({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [{ type: "text", text }],
        isError: name !== "create_issue",
      },
    });
  }
}

const decoder = new TextDecoder();
let buffer = "";

for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk, { stream: true });
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line.length > 0) {
      handle(line);
    }
    newline = buffer.indexOf("\n");
  }
}
