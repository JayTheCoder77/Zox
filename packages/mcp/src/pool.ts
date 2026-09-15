import type { ToolContext, ToolResult, ZoxTool } from "@zox/tools";
import { mcpToolName } from "./names.ts";
import {
  type McpListedTool,
  type McpServerSpec,
  McpStdioClient,
} from "./stdio.ts";

type ServerEntry = {
  client: McpStdioClient;
  tools: McpListedTool[];
};

export class McpPool {
  private readonly servers = new Map<string, ServerEntry>();

  async add(name: string, spec: McpServerSpec): Promise<void> {
    if (this.servers.has(name)) {
      await this.remove(name);
    }
    const client = new McpStdioClient(spec);
    try {
      await client.initialize();
      const tools = await client.listTools();
      this.servers.set(name, { client, tools });
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  async remove(name: string): Promise<void> {
    const entry = this.servers.get(name);
    if (!entry) {
      return;
    }
    this.servers.delete(name);
    await entry.client.close();
  }

  list(): Array<{ name: string; tools: string[] }> {
    return [...this.servers.entries()].map(([name, entry]) => ({
      name,
      tools: entry.tools.map((tool) => mcpToolName(name, tool.name)),
    }));
  }

  asZoxTools(): ZoxTool[] {
    const wrapped: ZoxTool[] = [];
    for (const [server, entry] of this.servers.entries()) {
      for (const tool of entry.tools) {
        const zoxName = mcpToolName(server, tool.name);
        // Default permission is ask when the MCP tool name contains write|create|delete|update (ZoxTool has no permission field).
        wrapped.push({
          name: zoxName,
          description: tool.description,
          parameters: tool.inputSchema,
          execute: async (
            args: Record<string, unknown>,
            ctx: ToolContext,
          ): Promise<ToolResult> => {
            try {
              const called = await entry.client.callTool(tool.name, args);
              const content = called.text.slice(0, ctx.maxToolOutputChars);
              return {
                ok: called.ok,
                content,
                truncated: called.text.length > ctx.maxToolOutputChars,
              };
            } catch (error) {
              const message =
                error instanceof Error ? error.message : String(error);
              return { ok: false, content: message, truncated: false };
            }
          },
        });
      }
    }
    return wrapped;
  }
}
