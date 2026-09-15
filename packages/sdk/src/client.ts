import { createSessionResponseSchema, type ZoxEvent } from "@zox/contracts";
import { iterateSse } from "./sse.ts";

export function createZoxClient(opts: { baseUrl: string; token: string }) {
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${opts.token}`,
    "Content-Type": "application/json",
  };
  const authOnly = { Authorization: headers.Authorization };

  function createSessionHandle(sessionId: string) {
    return {
      id: sessionId,
      send(content: string) {
        return {
          async *events(): AsyncIterable<ZoxEvent> {
            const eventsResPromise = fetch(
              `${baseUrl}/sessions/${sessionId}/events`,
              { headers: authOnly },
            );
            const sendRes = await fetch(
              `${baseUrl}/sessions/${sessionId}/messages`,
              {
                method: "POST",
                headers,
                body: JSON.stringify({ content }),
              },
            );
            if (!sendRes.ok) {
              throw new Error(`send failed: ${sendRes.status}`);
            }
            const eventsRes = await eventsResPromise;
            if (!eventsRes.ok) {
              throw new Error(`events failed: ${eventsRes.status}`);
            }
            for await (const event of iterateSse(eventsRes)) {
              yield event;
              if (
                event.type === "session.status" &&
                (event.status === "idle" || event.status === "error")
              ) {
                return;
              }
            }
          },
          async respondPermission(
            requestId: string,
            decision: { approved: boolean },
          ): Promise<void> {
            const res = await fetch(
              `${baseUrl}/sessions/${sessionId}/permissions/${requestId}`,
              {
                method: "POST",
                headers,
                body: JSON.stringify({ approved: decision.approved }),
              },
            );
            if (!res.ok) {
              throw new Error(`respondPermission failed: ${res.status}`);
            }
          },
        };
      },
      async getUsage(): Promise<{
        inputTokens: number;
        outputTokens: number;
      }> {
        const res = await fetch(
          `${baseUrl}/usage?sessionId=${encodeURIComponent(sessionId)}`,
          { headers: authOnly },
        );
        if (!res.ok) {
          throw new Error(`getUsage failed: ${res.status}`);
        }
        return res.json() as Promise<{
          inputTokens: number;
          outputTokens: number;
        }>;
      },
      async command(name: string, args?: string[]): Promise<unknown> {
        const res = await fetch(`${baseUrl}/sessions/${sessionId}/commands`, {
          method: "POST",
          headers,
          body: JSON.stringify({ name, args }),
        });
        if (!res.ok) {
          throw new Error(`command failed: ${res.status}`);
        }
        return res.json();
      },
      async compact(): Promise<void> {
        const res = await fetch(`${baseUrl}/sessions/${sessionId}/compact`, {
          method: "POST",
          headers: authOnly,
        });
        if (!res.ok) {
          throw new Error(`compact failed: ${res.status}`);
        }
      },
      async close(): Promise<void> {
        const res = await fetch(`${baseUrl}/sessions/${sessionId}/close`, {
          method: "POST",
          headers: authOnly,
        });
        if (!res.ok) {
          throw new Error(`close failed: ${res.status}`);
        }
      },
    };
  }

  return {
    sessions: {
      async create(input: {
        workspaceRoot: string;
        agent?: string;
        model?: string;
      }) {
        const res = await fetch(`${baseUrl}/sessions`, {
          method: "POST",
          headers,
          body: JSON.stringify(input),
        });
        if (!res.ok) {
          throw new Error(`create session failed: ${res.status}`);
        }
        const session = createSessionResponseSchema.parse(await res.json());
        return createSessionHandle(session.id);
      },
    },
    mcp: {
      async add(input: {
        name: string;
        command: string;
        args?: string[];
        env?: Record<string, string>;
      }): Promise<{ ok: boolean; servers: unknown[] }> {
        const res = await fetch(`${baseUrl}/mcp/servers`, {
          method: "POST",
          headers,
          body: JSON.stringify(input),
        });
        if (!res.ok) {
          throw new Error(`mcp.add failed: ${res.status}`);
        }
        return res.json() as Promise<{ ok: boolean; servers: unknown[] }>;
      },
      async remove(name: string): Promise<{ ok: boolean; servers: unknown[] }> {
        const res = await fetch(
          `${baseUrl}/mcp/servers/${encodeURIComponent(name)}`,
          {
            method: "DELETE",
            headers: authOnly,
          },
        );
        if (!res.ok) {
          throw new Error(`mcp.remove failed: ${res.status}`);
        }
        return res.json() as Promise<{ ok: boolean; servers: unknown[] }>;
      },
    },
    models: {
      async list(): Promise<{ adapters: string[]; models: string[] }> {
        const res = await fetch(`${baseUrl}/models`, { headers: authOnly });
        if (!res.ok) {
          throw new Error(`models.list failed: ${res.status}`);
        }
        return res.json() as Promise<{
          adapters: string[];
          models: string[];
        }>;
      },
    },
  };
}
