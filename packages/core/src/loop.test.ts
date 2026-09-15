import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHookRunner } from "@zox/hooks";
import { createMockAdapter, createProviderRouter } from "@zox/providers";
import { createBuiltinTools, ToolRegistry } from "@zox/tools";
import { runTurn } from "./loop.ts";
import type { StoredSession } from "./store.ts";

function session(): StoredSession {
  return {
    id: "sess_1",
    workspaceRoot: "/tmp/ws",
    sandboxRoot: "/tmp/ws",
    sandboxMode: "worktree",
    planJson: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    agent: "build",
    model: "mock/echo",
    status: "idle",
    messages: [],
  };
}

describe("runTurn", () => {
  test("yields running, deltas, usage, completed, idle", async () => {
    const router = createProviderRouter({ adapters: [createMockAdapter()] });
    const events = [];
    for await (const event of runTurn({
      session: session(),
      userContent: "ping",
      router,
      tools: new ToolRegistry(),
      ids: { messageId: () => "msg_asst", turnId: () => "turn_1" },
    })) {
      events.push(event);
    }
    expect(events.map((event) => event.type)).toEqual([
      "session.status",
      "error",
      "message.delta",
      "usage.turn",
      "usage.session",
      "message.completed",
      "session.status",
    ]);
    expect(events[1]).toMatchObject({
      type: "error",
      code: "context.window_unknown",
    });
    expect(events[2]).toMatchObject({
      type: "message.delta",
      delta: "ping",
      messageId: "msg_asst",
    });
    expect(events.at(-1)).toMatchObject({
      type: "session.status",
      status: "idle",
    });
  });

  test("executes a read tool call then completes with assistant text", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-loop-"));
    await Bun.write(join(root, "a.ts"), "hello");
    let n = 0;
    const router = createProviderRouter({
      adapters: [
        createMockAdapter({
          script: async function* () {
            n += 1;
            if (n === 1) {
              yield {
                type: "tool-call",
                id: "tc1",
                name: "read",
                arguments: { path: "a.ts" },
              };
              yield { type: "usage", inputTokens: 3, outputTokens: 1 };
              yield { type: "done" };
              return;
            }
            yield { type: "text-delta", text: "saw file" };
            yield { type: "usage", inputTokens: 4, outputTokens: 2 };
            yield { type: "done" };
          },
        }),
      ],
    });
    const tools = new ToolRegistry();
    for (const t of createBuiltinTools()) tools.register(t);
    const sess = session();
    sess.workspaceRoot = root;
    sess.sandboxRoot = root;
    const events = [];
    for await (const e of runTurn({
      session: sess,
      userContent: "read a",
      router,
      tools,
    })) {
      events.push(e);
    }
    expect(events.some((e) => e.type === "tool.started")).toBe(true);
    expect(events.some((e) => e.type === "tool.completed" && e.ok)).toBe(true);
    expect(
      events.some(
        (e) => e.type === "message.completed" && e.content === "saw file",
      ),
    ).toBe(true);
    expect(sess.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  test("ask permission can deny a write", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-loop-write-"));
    let n = 0;
    const router = createProviderRouter({
      adapters: [
        createMockAdapter({
          script: async function* () {
            n += 1;
            if (n === 1) {
              yield {
                type: "tool-call",
                id: "tcw",
                name: "write",
                arguments: { path: "out.txt", content: "nope" },
              };
              yield { type: "usage", inputTokens: 1, outputTokens: 1 };
              yield { type: "done" };
              return;
            }
            yield { type: "text-delta", text: "denied write" };
            yield { type: "usage", inputTokens: 1, outputTokens: 1 };
            yield { type: "done" };
          },
        }),
      ],
    });
    const tools = new ToolRegistry();
    for (const t of createBuiltinTools()) tools.register(t);
    const sess = session();
    sess.workspaceRoot = root;
    sess.sandboxRoot = root;
    const events = [];
    for await (const e of runTurn({
      session: sess,
      userContent: "write it",
      router,
      tools,
      permission: { wait: async () => false },
    })) {
      events.push(e);
    }
    expect(events.some((e) => e.type === "tool.permission_required")).toBe(
      true,
    );
    expect(
      events.some((e) => e.type === "tool.completed" && e.ok === false),
    ).toBe(true);
    expect(await Bun.file(join(root, "out.txt")).exists()).toBe(false);
  });

  test("todowrite success updates session.planJson", async () => {
    const plan = [
      { id: "a", content: "task one", status: "pending" as const },
      { id: "b", content: "task two", status: "in_progress" as const },
    ];
    let n = 0;
    const router = createProviderRouter({
      adapters: [
        createMockAdapter({
          script: async function* () {
            n += 1;
            if (n === 1) {
              yield {
                type: "tool-call",
                id: "tc_plan",
                name: "todowrite",
                arguments: { items: plan },
              };
              yield { type: "usage", inputTokens: 1, outputTokens: 1 };
              yield { type: "done" };
              return;
            }
            yield { type: "text-delta", text: "plan saved" };
            yield { type: "usage", inputTokens: 1, outputTokens: 1 };
            yield { type: "done" };
          },
        }),
      ],
    });
    const tools = new ToolRegistry();
    for (const t of createBuiltinTools()) tools.register(t);
    const sess = session();
    for await (const _e of runTurn({
      session: sess,
      userContent: "update plan",
      router,
      tools,
    })) {
      /* drain */
    }
    expect(sess.planJson).toEqual(plan);
  });

  test("PreToolUse deny skips tool execution", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-loop-hook-"));
    const script = join(root, "deny.sh");
    await Bun.write(script, `#!/bin/sh\nprintf '{"decision":"deny"}\\n'\n`);
    await chmod(script, 0o755);
    await Bun.write(join(root, "a.ts"), "hello");
    let n = 0;
    const router = createProviderRouter({
      adapters: [
        createMockAdapter({
          script: async function* () {
            n += 1;
            if (n === 1) {
              yield {
                type: "tool-call",
                id: "tc1",
                name: "read",
                arguments: { path: "a.ts" },
              };
              yield { type: "usage", inputTokens: 1, outputTokens: 1 };
              yield { type: "done" };
              return;
            }
            yield { type: "text-delta", text: "hook blocked" };
            yield { type: "usage", inputTokens: 1, outputTokens: 1 };
            yield { type: "done" };
          },
        }),
      ],
    });
    const tools = new ToolRegistry();
    for (const t of createBuiltinTools()) tools.register(t);
    const sess = session();
    sess.workspaceRoot = root;
    sess.sandboxRoot = root;
    const hooks = createHookRunner({
      files: [
        {
          zoxHooksVersion: 1,
          hooks: {
            PreToolUse: [{ matcher: "read", type: "command", command: script }],
          },
        },
      ],
      trusted: true,
      cwd: root,
    });
    const events = [];
    for await (const e of runTurn({
      session: sess,
      userContent: "read a",
      router,
      tools,
      hooks,
    })) {
      events.push(e);
    }
    expect(
      events.some((e) => e.type === "tool.completed" && e.ok === false),
    ).toBe(true);
    expect(
      sess.messages.some(
        (m) => m.role === "tool" && m.content === "Permission denied",
      ),
    ).toBe(true);
  });

  test("records turn tokens on observability when provided", async () => {
    const recorded: string[] = [];
    const observability = {
      startTurn() {
        recorded.push("start");
        return {
          traceId: "trace",
          end() {
            recorded.push("end");
          },
        };
      },
      recordTool() {},
      recordTokens(provider: string, input: number, output: number) {
        recorded.push(`${provider}:${input}:${output}`);
      },
    };
    const router = createProviderRouter({ adapters: [createMockAdapter()] });
    for await (const _event of runTurn({
      session: session(),
      userContent: "ping",
      router,
      tools: new ToolRegistry(),
      observability,
    })) {
    }
    expect(recorded[0]).toBe("start");
    expect(recorded).toContain("mock:1:1");
    expect(recorded.at(-1)).toBe("end");
  });
});
