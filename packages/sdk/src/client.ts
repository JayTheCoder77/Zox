import { createSessionResponseSchema, type ZoxEvent } from "@zox/contracts";
import { iterateSse } from "./sse.ts";

export function createZoxClient(opts: { baseUrl: string; token: string }) {
  const baseUrl = opts.baseUrl.replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${opts.token}`,
    "Content-Type": "application/json",
  };

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
        return {
          id: session.id,
          send(content: string) {
            return {
              async *events(): AsyncIterable<ZoxEvent> {
                const eventsResPromise = fetch(
                  `${baseUrl}/sessions/${session.id}/events`,
                  { headers: { Authorization: headers.Authorization } },
                );
                const sendRes = await fetch(
                  `${baseUrl}/sessions/${session.id}/messages`,
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
            };
          },
        };
      },
    },
  };
}
