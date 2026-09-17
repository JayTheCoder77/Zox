import { describe, expect, test } from "bun:test";
import { createZoxClient } from "@zox/sdk";
import { listen } from "@zox/server";
import { runExportSession } from "./export-session.ts";

describe("runExportSession", () => {
  test("prints JSON and calls session.export without memory by default", async () => {
    const token = crypto.randomUUID();
    const server = await listen({ token, port: 0, sandboxMode: "host" });
    const baseUrl = `http://127.0.0.1:${server.port}`;
    try {
      const client = createZoxClient({ baseUrl, token });
      const session = await client.sessions.create({
        workspaceRoot: process.cwd(),
      });
      const sessionId = session.id;
      await session.close();

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };
      try {
        await runExportSession({
          sessionId,
          flags: { url: baseUrl, token },
        });
      } finally {
        console.log = originalLog;
      }
      expect(logs[0]).toContain('"version":1');
      expect(logs[0]).toContain(`"id":"${sessionId}"`);
    } finally {
      server.stop();
    }
  });

  test("passes includeMemory true", async () => {
    const token = crypto.randomUUID();
    const server = await listen({ token, port: 0, sandboxMode: "host" });
    const baseUrl = `http://127.0.0.1:${server.port}`;
    try {
      const client = createZoxClient({ baseUrl, token });
      const session = await client.sessions.create({
        workspaceRoot: process.cwd(),
      });
      const sessionId = session.id;
      await session.close();

      const originalLog = console.log;
      console.log = () => {};
      try {
        await runExportSession({
          sessionId,
          flags: {
            url: baseUrl,
            token,
            includeMemory: true,
          },
        });
      } finally {
        console.log = originalLog;
      }
    } finally {
      server.stop();
    }
  });
});
