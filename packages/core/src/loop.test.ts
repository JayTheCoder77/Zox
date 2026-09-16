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
      ids: {
        messageId: () => "msg_asst",
        turnId: () => "turn_1",
        toolCallId: () => "tc_1",
        requestId: () => "req_1",
      },
    })) {
      events.push(event);
    }
    expect(events.map((event) => event.type)).toEqual([
      "session.status",
      "context.estimated",
      "error",
      "message.delta",
      "usage.turn",
      "usage.session",
      "message.completed",
      "session.status",
    ]);
    expect(events[1]).toMatchObject({
      type: "context.estimated",
      windowKnown: false,
      windowTokens: 128_000,
    });
    expect(events[2]).toMatchObject({
      type: "error",
      code: "context.window_unknown",
    });
    expect(events[3]).toMatchObject({
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

  test("build offers mcp_* tools and asks before mutating MCP names", async () => {
    let seenTools: string[] | undefined;
    let n = 0;
    const router = createProviderRouter({
      adapters: [
        createMockAdapter({
          script: async function* (params) {
            seenTools = params.tools?.map((t) => t.name);
            n += 1;
            if (n === 1) {
              yield {
                type: "tool-call",
                id: "tc_mcp",
                name: "mcp_github_create_issue",
                arguments: { title: "x" },
              };
              yield { type: "usage", inputTokens: 1, outputTokens: 1 };
              yield { type: "done" };
              return;
            }
            yield { type: "text-delta", text: "asked" };
            yield { type: "usage", inputTokens: 1, outputTokens: 1 };
            yield { type: "done" };
          },
        }),
      ],
    });
    const tools = new ToolRegistry();
    tools.register({
      name: "mcp_github_create_issue",
      description: "create",
      parameters: { type: "object", properties: {} },
      async execute() {
        return { ok: true, content: "created", truncated: false };
      },
    });
    const events = [];
    for await (const e of runTurn({
      session: session(),
      userContent: "open issue",
      router,
      tools,
      permission: { wait: async () => false },
    })) {
      events.push(e);
    }
    expect(seenTools).toContain("mcp_github_create_issue");
    expect(events.some((e) => e.type === "tool.permission_required")).toBe(
      true,
    );
  });

  test("plan denies mcp_* tools without offering them to the model", async () => {
    let seenTools: string[] | undefined;
    let n = 0;
    const router = createProviderRouter({
      adapters: [
        createMockAdapter({
          script: async function* (params) {
            n += 1;
            if (n === 1) {
              seenTools = params.tools?.map((t) => t.name);
              yield {
                type: "tool-call",
                id: "tc_mcp",
                name: "mcp_github_list",
                arguments: {},
              };
              yield { type: "usage", inputTokens: 1, outputTokens: 1 };
              yield { type: "done" };
              return;
            }
            yield { type: "text-delta", text: "denied" };
            yield { type: "usage", inputTokens: 1, outputTokens: 1 };
            yield { type: "done" };
          },
        }),
      ],
    });
    const tools = new ToolRegistry();
    let executed = false;
    tools.register({
      name: "mcp_github_list",
      description: "list",
      parameters: { type: "object", properties: {} },
      async execute() {
        executed = true;
        return { ok: true, content: "listed", truncated: false };
      },
    });
    const sess = session();
    sess.agent = "plan";
    const events = [];
    for await (const e of runTurn({
      session: sess,
      userContent: "list issues",
      router,
      tools,
    })) {
      events.push(e);
    }
    expect(seenTools ?? []).not.toContain("mcp_github_list");
    expect(executed).toBe(false);
    expect(
      events.some((e) => e.type === "tool.completed" && e.ok === false),
    ).toBe(true);
  });

  test("stops with tool_loop_limit after 20 tool rounds", async () => {
    let n = 0;
    const router = createProviderRouter({
      adapters: [
        createMockAdapter({
          script: async function* () {
            n += 1;
            yield {
              type: "tool-call",
              id: `tc${n}`,
              name: "read",
              arguments: { path: "a.ts" },
            };
            yield { type: "usage", inputTokens: 1, outputTokens: 1 };
            yield { type: "done" };
          },
        }),
      ],
    });
    const root = await mkdtemp(join(tmpdir(), "zox-loop-limit-"));
    await Bun.write(join(root, "a.ts"), "x");
    const tools = new ToolRegistry();
    for (const t of createBuiltinTools()) tools.register(t);
    const sess = session();
    sess.workspaceRoot = root;
    sess.sandboxRoot = root;
    const events = [];
    for await (const e of runTurn({
      session: sess,
      userContent: "loop",
      router,
      tools,
    })) {
      events.push(e);
    }
    expect(
      events.some((e) => e.type === "error" && e.code === "tool_loop_limit"),
    ).toBe(true);
  });

  test("includes injected skill bodies in provider-facing messages", async () => {
    let providerMessages: Array<{ role: string; content: string }> = [];
    const router = createProviderRouter({
      adapters: [
        createMockAdapter({
          script: async function* (params) {
            providerMessages = params.messages.map((m) => ({
              role: m.role,
              content: "content" in m ? String(m.content) : "",
            }));
            yield { type: "text-delta", text: "ok" };
            yield { type: "usage", inputTokens: 1, outputTokens: 1 };
            yield { type: "done" };
          },
        }),
      ],
    });
    const sess = session();
    sess.activeSkills = [
      { name: "helper", body: "ALWAYS use conventional commits." },
    ];
    for await (const _e of runTurn({
      session: sess,
      userContent: "commit",
      router,
      tools: new ToolRegistry(),
    })) {
      /* drain */
    }
    expect(
      providerMessages.some(
        (m) =>
          m.role === "system" && m.content.includes("conventional commits"),
      ),
    ).toBe(true);
  });

  test("injects family system prompt from the model id", async () => {
    let providerMessages: Array<{ role: string; content: string }> = [];
    const router = createProviderRouter({
      adapters: [
        createMockAdapter({
          script: async function* (params) {
            providerMessages = params.messages.map((m) => ({
              role: m.role,
              content: "content" in m ? String(m.content) : "",
            }));
            yield { type: "text-delta", text: "ok" };
            yield { type: "usage", inputTokens: 1, outputTokens: 1 };
            yield { type: "done" };
          },
        }),
      ],
    });
    const sess = session();
    sess.model = "mock/claude-3.5-sonnet";
    for await (const _e of runTurn({
      session: sess,
      userContent: "hi",
      router,
      tools: new ToolRegistry(),
    })) {
      /* drain */
    }
    expect(providerMessages[0]).toMatchObject({ role: "system" });
    expect(providerMessages[0]?.content).toContain("Zox family: anthropic");
    expect(providerMessages.some((m) => m.content.includes("implement"))).toBe(
      true,
    );
  });

  test("injects plan overlay and AGENTS.md from the workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-loop-prompt-"));
    await Bun.write(join(root, "AGENTS.md"), "USE CONVENTIONAL COMMITS");
    await Bun.write(join(root, "EXTRA.md"), "EXTRA RULES FILE");
    let providerMessages: Array<{ role: string; content: string }> = [];
    const router = createProviderRouter({
      adapters: [
        createMockAdapter({
          script: async function* (params) {
            providerMessages = params.messages.map((m) => ({
              role: m.role,
              content: "content" in m ? String(m.content) : "",
            }));
            yield { type: "text-delta", text: "ok" };
            yield { type: "usage", inputTokens: 1, outputTokens: 1 };
            yield { type: "done" };
          },
        }),
      ],
    });
    const sess = session();
    sess.agent = "plan";
    sess.workspaceRoot = root;
    sess.sandboxRoot = join(root, ".zox/worktrees/sess_1");
    sess.model = "mock/llama-3.3-70b-versatile";
    for await (const _e of runTurn({
      session: sess,
      userContent: "plan it",
      router,
      tools: new ToolRegistry(),
      instructionFiles: ["EXTRA.md"],
    })) {
      /* drain */
    }
    const joined = providerMessages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    expect(joined).toContain("Zox family: default");
    expect(joined).toContain("todowrite");
    expect(joined).toContain("read-only");
    expect(joined).toContain("USE CONVENTIONAL COMMITS");
    expect(joined).toContain("EXTRA RULES FILE");
    expect(joined).toContain(`Workspace root folder: ${root}`);
    expect(joined).not.toContain("implement in the workspace");
  });

  test("skill tool activation keeps the body on the next provider call", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const root = await mkdtemp(join(tmpdir(), "zox-loop-skill-"));
    await mkdir(join(root, ".zox/skills/helper"), { recursive: true });
    await writeFile(
      join(root, ".zox/skills/helper/SKILL.md"),
      "---\nname: helper\ndescription: help\n---\nALWAYS conventional commits.\n",
    );
    let round = 0;
    let secondRound = "";
    const router = createProviderRouter({
      adapters: [
        createMockAdapter({
          script: async function* (params) {
            round += 1;
            if (round === 1) {
              yield {
                type: "tool-call",
                id: "tc1",
                name: "skill",
                arguments: { name: "helper" },
              };
            } else {
              secondRound = params.messages
                .map((m) => ("content" in m ? String(m.content) : ""))
                .join("\n");
              yield { type: "text-delta", text: "ok" };
            }
            yield { type: "usage", inputTokens: 1, outputTokens: 1 };
            yield { type: "done" };
          },
        }),
      ],
    });
    const tools = new ToolRegistry();
    for (const tool of createBuiltinTools()) tools.register(tool);
    const sess = session();
    sess.workspaceRoot = root;
    sess.sandboxRoot = root;
    for await (const _e of runTurn({
      session: sess,
      userContent: "use the helper skill",
      router,
      tools,
    })) {
      /* drain */
    }
    expect(sess.activeSkills?.some((s) => s.name === "helper")).toBe(true);
    expect(secondRound).toContain("ALWAYS conventional commits");
  });

  test("calls onOverflow once on hard overflow then still runs streamChat", async () => {
    let overflowCalls = 0;
    let streamChatCalls = 0;
    const router = createProviderRouter({
      adapters: [
        createMockAdapter({
          script: async function* () {
            streamChatCalls += 1;
            yield { type: "text-delta", text: "ok" };
            yield { type: "usage", inputTokens: 1, outputTokens: 1 };
            yield { type: "done" };
          },
        }),
      ],
    });
    const sess = session();
    sess.messages = [
      { id: "m1", role: "user", content: "old user" },
      { id: "m2", role: "assistant", content: "old assistant" },
    ];
    const events = [];
    for await (const event of runTurn({
      session: sess,
      userContent: "keep going",
      router,
      tools: new ToolRegistry(),
      context: {
        windowTokens: 100,
        estimateTokens: () => 90,
      },
      onOverflow: async (info) => {
        overflowCalls += 1;
        expect(info.kind).toBe("auto");
        expect(info.estimatedTokens).toBe(90);
        sess.compactions = [
          { fromMessageId: "m1", toMessageId: "m2", summary: "SUM" },
        ];
      },
    })) {
      events.push(event);
    }
    expect(overflowCalls).toBe(1);
    expect(streamChatCalls).toBe(1);
    const overflowIndex = events.findIndex(
      (event) => event.type === "context.overflow",
    );
    expect(overflowIndex).toBeGreaterThanOrEqual(0);
    expect(events[overflowIndex + 1]).toMatchObject({
      type: "session.status",
      sessionId: "sess_1",
      status: "running",
    });
    expect(
      sess.messages.some((message) => message.content === "keep going"),
    ).toBe(true);
  });

  test("does not auto-compact a follow-up turn when assembled history is under the window", async () => {
    let overflowCalls = 0;
    let streamChatCalls = 0;
    const router = createProviderRouter({
      adapters: [
        createMockAdapter({
          script: async function* () {
            streamChatCalls += 1;
            yield { type: "text-delta", text: "ok" };
            yield { type: "usage", inputTokens: 1, outputTokens: 1 };
            yield { type: "done" };
          },
        }),
      ],
    });
    const oldUser = "old user ".repeat(40);
    const oldAssistant = "old assistant ".repeat(40);
    const sess = session();
    sess.messages = [
      { id: "m1", role: "user", content: oldUser },
      { id: "m2", role: "assistant", content: oldAssistant },
    ];
    sess.compactions = [
      { fromMessageId: "m1", toMessageId: "m2", summary: "SUM" },
    ];
    const events = [];
    for await (const event of runTurn({
      session: sess,
      userContent: "keep going",
      router,
      tools: new ToolRegistry(),
      context: {
        windowTokens: 100,
        estimateTokens: (text) => (text.includes("old user") ? 1000 : 10),
      },
      onOverflow: async () => {
        overflowCalls += 1;
      },
    })) {
      events.push(event);
    }
    const rawSize = oldUser.length + oldAssistant.length + "keep going".length;
    expect(rawSize).toBeGreaterThan(85);
    expect(overflowCalls).toBe(0);
    expect(streamChatCalls).toBe(1);
    expect(events.some((event) => event.type === "context.overflow")).toBe(
      false,
    );
  });

  test("yields context.compact_failed when onOverflow throws and skips the model", async () => {
    let streamChatCalls = 0;
    const router = createProviderRouter({
      adapters: [
        createMockAdapter({
          script: async function* () {
            streamChatCalls += 1;
            yield { type: "text-delta", text: "ok" };
            yield { type: "usage", inputTokens: 1, outputTokens: 1 };
            yield { type: "done" };
          },
        }),
      ],
    });
    const sess = session();
    const events = [];
    for await (const event of runTurn({
      session: sess,
      userContent: "too much",
      router,
      tools: new ToolRegistry(),
      context: {
        windowTokens: 100,
        estimateTokens: () => 90,
      },
      onOverflow: async () => {
        throw new Error("summarizer rejected");
      },
    })) {
      events.push(event);
    }
    expect(streamChatCalls).toBe(0);
    expect(
      events.some(
        (event) =>
          event.type === "error" && event.code === "context.compact_failed",
      ),
    ).toBe(true);
    expect(sess.status === "idle" || sess.status === "error").toBe(true);
  });

  test("passes webfetch allowlist and maxBytes into tool execute context", async () => {
    let seen:
      | { allowedHosts?: string[]; webfetchMaxBytes?: number }
      | undefined;
    let n = 0;
    const router = createProviderRouter({
      adapters: [
        createMockAdapter({
          script: async function* () {
            n += 1;
            if (n === 1) {
              yield {
                type: "tool-call",
                id: "tc_wf",
                name: "read",
                arguments: { path: "a.ts" },
              };
              yield { type: "usage", inputTokens: 1, outputTokens: 1 };
              yield { type: "done" };
              return;
            }
            yield { type: "text-delta", text: "ok" };
            yield { type: "usage", inputTokens: 1, outputTokens: 1 };
            yield { type: "done" };
          },
        }),
      ],
    });
    const tools = new ToolRegistry();
    tools.register({
      name: "read",
      description: "read",
      parameters: { type: "object", properties: {} },
      async execute(_args, ctx) {
        seen = {
          allowedHosts: ctx.allowedHosts,
          webfetchMaxBytes: ctx.webfetchMaxBytes,
        };
        return { ok: true, content: "ok", truncated: false };
      },
    });
    for await (const _e of runTurn({
      session: session(),
      userContent: "fetch",
      router,
      tools,
      webfetchAllowedHosts: ["example.com"],
      webfetchMaxBytes: 4096,
    })) {
      /* drain */
    }
    expect(seen).toEqual({
      allowedHosts: ["example.com"],
      webfetchMaxBytes: 4096,
    });
  });
});
