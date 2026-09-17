import type { ZoxEvent } from "@zox/contracts";
import type { ServerWebSocket } from "bun";
import type { SessionEventBus } from "./bus.ts";

export type WsClientMessage = {
  type: "permission.response";
  requestId: string;
  approved: boolean;
};

export type SessionWsData = {
  sessionId: string;
  bus: SessionEventBus;
  respondPermission: (
    sessionId: string,
    requestId: string,
    approved: boolean,
  ) => void;
  unsubscribe?: () => void;
};

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestToken(request: Request, url: URL): string | undefined {
  const header = request.headers.get("Authorization") ?? "";
  if (header.startsWith("Bearer ")) return header.slice("Bearer ".length);
  const query = url.searchParams.get("token");
  return query ?? undefined;
}

function parseClientMessage(raw: string): WsClientMessage | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const body = parsed as {
    type?: unknown;
    requestId?: unknown;
    approved?: unknown;
  };
  if (body.type !== "permission.response") return undefined;
  if (typeof body.requestId !== "string") return undefined;
  if (typeof body.approved !== "boolean") return undefined;
  return {
    type: "permission.response",
    requestId: body.requestId,
    approved: body.approved,
  };
}

export const sessionWebSocketHandlers = {
  open(ws: ServerWebSocket<SessionWsData>) {
    ws.data.unsubscribe = ws.data.bus.subscribe(
      ws.data.sessionId,
      (event: ZoxEvent) => {
        ws.send(JSON.stringify(event));
      },
    );
  },
  message(ws: ServerWebSocket<SessionWsData>, message: string | Buffer) {
    const text =
      typeof message === "string" ? message : new TextDecoder().decode(message);
    const parsed = parseClientMessage(text);
    if (!parsed) return;
    ws.data.respondPermission(
      ws.data.sessionId,
      parsed.requestId,
      parsed.approved,
    );
  },
  close(ws: ServerWebSocket<SessionWsData>) {
    ws.data.unsubscribe?.();
  },
};

export function sessionWebSocket(opts: {
  token: string;
  getSession: (id: string) => { id: string } | undefined;
  bus: SessionEventBus;
  respondPermission: (
    sessionId: string,
    requestId: string,
    approved: boolean,
  ) => void;
}): (
  request: Request,
  server: Bun.Server<SessionWsData>,
) => Response | undefined {
  return (request, server) => {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/sessions\/([^/]+)\/ws$/);
    if (!match || request.method !== "GET") {
      return jsonError(404, "Not found");
    }
    const provided = requestToken(request, url);
    if (provided !== opts.token) {
      return jsonError(401, "Unauthorized");
    }
    const sessionId = match[1] ?? "";
    const session = opts.getSession(sessionId);
    if (!session) {
      return jsonError(404, "Not found");
    }
    const upgraded = server.upgrade(request, {
      data: {
        sessionId: session.id,
        bus: opts.bus,
        respondPermission: opts.respondPermission,
      } satisfies SessionWsData,
    });
    if (!upgraded) {
      return jsonError(400, "Upgrade failed");
    }
    return undefined;
  };
}
