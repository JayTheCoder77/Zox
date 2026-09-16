import {
  createSessionResponseSchema,
  sessionListResponseSchema,
  sessionSkillsResponseSchema,
  workspaceSkillsResponseSchema,
  type ZoxEvent,
} from "@zox/contracts";
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
        const replay: ZoxEvent[] = [];
        const toolHandlers: Array<(event: ZoxEvent) => void> = [];
        const waiters: Array<() => void> = [];
        let pump: Promise<void> | undefined;
        let done = false;
        let pumpError: unknown;

        function notify(): void {
          for (const waiter of waiters.splice(0)) waiter();
        }

        function isTerminal(event: ZoxEvent): boolean {
          return (
            event.type === "session.status" &&
            (event.status === "idle" || event.status === "error")
          );
        }

        function dispatchTool(event: ZoxEvent): void {
          if (
            event.type !== "tool.started" &&
            event.type !== "tool.permission_required"
          ) {
            return;
          }
          for (const handler of toolHandlers) {
            try {
              handler(event);
            } catch (error) {
              console.error(error);
            }
          }
        }

        async function pumpEvents(): Promise<void> {
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
            replay.push(event);
            dispatchTool(event);
            notify();
            if (isTerminal(event)) return;
          }
        }

        function ensurePump(): Promise<void> {
          pump ??= pumpEvents()
            .catch((error: unknown) => {
              pumpError = error;
              throw error;
            })
            .finally(() => {
              done = true;
              notify();
            });
          return pump;
        }

        async function* events(): AsyncIterable<ZoxEvent> {
          void ensurePump();
          let index = 0;
          while (true) {
            while (index < replay.length) {
              yield replay[index++]!;
            }
            if (pumpError) throw pumpError;
            if (done) return;
            await new Promise<void>((resolve) => waiters.push(resolve));
          }
        }

        return {
          events,
          onTool(handler: (event: ZoxEvent) => void): void {
            toolHandlers.push(handler);
          },
          async waitForIdle(): Promise<void> {
            for await (const _event of events()) {
              /* drain until idle|error */
            }
          },
          async collectText(): Promise<string> {
            let text = "";
            for await (const event of events()) {
              if (event.type === "message.delta") text += event.delta;
              else if (
                event.type === "message.completed" &&
                text.length === 0
              ) {
                text = event.content;
              }
            }
            return text;
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
      skills: {
        async list() {
          const res = await fetch(`${baseUrl}/sessions/${sessionId}/skills`, {
            headers: authOnly,
          });
          if (!res.ok) throw new Error(`skills.list failed: ${res.status}`);
          return sessionSkillsResponseSchema.parse(await res.json());
        },
        load: (name: string) => mutateSkills("load", name),
        unload: (name: string) => mutateSkills("unload", name),
        async active() {
          const listed = await this.list();
          return listed.active.map((s) => s.name);
        },
      },
    };

    async function mutateSkills(action: "load" | "unload", name: string) {
      const res = await fetch(`${baseUrl}/sessions/${sessionId}/skills`, {
        method: "POST",
        headers,
        body: JSON.stringify({ action, name }),
      });
      if (!res.ok) throw new Error(`skills.${action} failed: ${res.status}`);
      return sessionSkillsResponseSchema.parse(await res.json());
    }
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
      async get(id: string) {
        const res = await fetch(
          `${baseUrl}/sessions/${encodeURIComponent(id)}`,
          { headers: authOnly },
        );
        if (!res.ok) {
          throw new Error(`get session failed: ${res.status}`);
        }
        const session = createSessionResponseSchema.parse(await res.json());
        return createSessionHandle(session.id);
      },
      async list(workspaceRoot: string, limit = 50) {
        const params = new URLSearchParams({
          workspaceRoot,
          limit: String(limit),
        });
        const res = await fetch(`${baseUrl}/sessions?${params}`, {
          headers: authOnly,
        });
        if (!res.ok) {
          throw new Error(`list sessions failed: ${res.status}`);
        }
        return sessionListResponseSchema.parse(await res.json());
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
    skills: {
      async list(workspaceRoot: string) {
        const res = await fetch(
          `${baseUrl}/skills?workspaceRoot=${encodeURIComponent(workspaceRoot)}`,
          { headers: authOnly },
        );
        if (!res.ok) {
          throw new Error(`skills.list failed: ${res.status}`);
        }
        return workspaceSkillsResponseSchema.parse(await res.json());
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
