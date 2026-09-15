import {
  createSessionRequestSchema,
  sendMessageRequestSchema,
  type ZoxEvent,
} from "@zox/contracts";
import type { MemorySessionStore } from "@zox/core";
import { runTurn } from "@zox/core";
import type { createProviderRouter } from "@zox/providers";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { bearerAuth } from "./auth.ts";
import { SessionEventBus } from "./bus.ts";

export type AppRouter = ReturnType<typeof createProviderRouter>;

export function createApp(opts: {
  token: string;
  store: MemorySessionStore;
  router: AppRouter;
}): Hono {
  const bus = new SessionEventBus();
  const app = new Hono();
  app.use("*", bearerAuth(opts.token));

  app.post("/sessions", async (c) => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json({ error: "Bad request" }, 400);
    }
    const parsed = createSessionRequestSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: "Bad request", issues: parsed.error.issues }, 400);
    }
    const session = opts.store.create(parsed.data);
    return c.json(
      {
        id: session.id,
        workspaceRoot: session.workspaceRoot,
        agent: session.agent,
        model: session.model,
        status: session.status,
      },
      201,
    );
  });

  app.get("/sessions/:id", (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json({
      id: session.id,
      workspaceRoot: session.workspaceRoot,
      agent: session.agent,
      model: session.model,
      status: session.status,
    });
  });

  app.post("/sessions/:id/messages", async (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    if (session.status !== "idle") {
      return c.json({ error: "Session not idle" }, 409);
    }
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json({ error: "Bad request" }, 400);
    }
    const parsed = sendMessageRequestSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: "Bad request", issues: parsed.error.issues }, 400);
    }
    bus.beginTurn(session.id);
    session.status = "running";
    void (async () => {
      for await (const event of runTurn({
        session,
        userContent: parsed.data.content,
        router: opts.router,
      })) {
        bus.publish(session.id, event);
      }
    })().catch((error: unknown) => {
      session.status = "error";
      bus.publish(session.id, {
        type: "error",
        sessionId: session.id,
        message: error instanceof Error ? error.message : String(error),
      });
      bus.publish(session.id, {
        type: "session.status",
        sessionId: session.id,
        status: "error",
      });
    });
    return c.json({ ok: true }, 202);
  });

  // Phase 0: close SSE after session.status idle|error so app.request tests finish.
  // Phase 1 may keep the stream open for multiple turns.
  app.get("/sessions/:id/events", (c) => {
    const session = opts.store.get(c.req.param("id"));
    if (!session) return c.json({ error: "Not found" }, 404);
    if (session.status === "idle") {
      bus.discardCompletedTurn(session.id);
    }
    let id = 0;
    return streamSSE(c, async (stream) => {
      await new Promise<void>((resolve) => {
        let pendingWrites = 0;
        let sawTerminal = false;

        const tryFinish = (unsubscribe: () => void) => {
          if (sawTerminal && pendingWrites === 0) {
            unsubscribe();
            resolve();
          }
        };

        const unsubscribe = bus.subscribe(session.id, (event: ZoxEvent) => {
          pendingWrites++;
          void stream
            .writeSSE({
              id: String(id++),
              event: event.type,
              data: JSON.stringify(event),
            })
            .finally(() => {
              pendingWrites--;
              if (
                event.type === "session.status" &&
                (event.status === "idle" || event.status === "error")
              ) {
                sawTerminal = true;
              }
              tryFinish(unsubscribe);
            });
        });

        if (bus.turnComplete(session.id)) {
          sawTerminal = true;
          queueMicrotask(() => tryFinish(unsubscribe));
        }
      });
    });
  });

  return app;
}
