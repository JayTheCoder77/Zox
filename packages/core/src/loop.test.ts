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

  test("uses the model catalog window for openrouter gpt-4.1", async () => {
    const sess = session();
    sess.model = "openrouter/openai/gpt-4.1";
    const router = createProviderRouter({
      adapters: [{ ...createMockAdapter(), id: "openrouter" }],
    });
    const events = [];
    for await (const event of runTurn({
      session: sess,
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
    expect(events[1]).toMatchObject({
      type: "context.estimated",
      windowKnown: true,
      windowTokens: 1_047_576,
    });
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  test("config windowTokens still overrides the model catalog", async () => {
    const sess = session();
    sess.model = "openrouter/openai/gpt-4.1";
    const router = createProviderRouter({
      adapters: [{ ...createMockAdapter(), id: "openrouter" }],
    });
    const events = [];
    for await (const event of runTurn({
      session: sess,
      userContent: "ping",
      router,
      tools: new ToolRegistry(),
      context: { windowTokens: 100 },
      ids: {
        messageId: () => "msg_asst",
        turnId: () => "turn_1",
        toolCallId: () => "tc_1",
        requestId: () => "req_1",
      },
    })) {
      events.push(event);
    }
    expect(events[1]).toMatchObject({
      type: "context.estimated",
      windowKnown: true,
      windowTokens: 100,
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

  test("fires PermissionRequest then PermissionDenied when the user denies", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-loop-perm-hooks-"));
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
    const hookCalls: Array<{ event: string; payload: unknown }> = [];
    const hooks = {
      async run(event: string, payload: unknown) {
        hookCalls.push({ event, payload });
        return { decision: "allow" as const };
      },
    };
    for await (const _e of runTurn({
      session: sess,
      userContent: "write it",
      router,
      tools,
      hooks,
      permission: { wait: async () => false },
    })) {
      /* drain */
    }
    const names = hookCalls.map((call) => call.event);
    const requestIndex = names.indexOf("PermissionRequest");
    const deniedIndex = names.indexOf("PermissionDenied");
    expect(requestIndex).toBeGreaterThanOrEqual(0);
    expect(deniedIndex).toBeGreaterThan(requestIndex);
    expect(hookCalls[requestIndex]?.payload).toMatchObject({
      matcher: "write",
      tool: {
        name: "write",
        arguments: { path: "out.txt", content: "nope" },
      },
      session: { id: "sess_1", workspaceRoot: root },
    });
    expect(hookCalls[deniedIndex]?.payload).toMatchObject({
      matcher: "write",
      tool: {
        name: "write",
        arguments: { path: "out.txt", content: "nope" },
      },
      session: { id: "sess_1", workspaceRoot: root },
    });
  });

  test("fires PostToolUseFailure when a tool returns ok false", async () => {
    let n = 0;
    const router = createProviderRouter({
      adapters: [
        createMockAdapter({
          script: async function* () {
            n += 1;
            if (n === 1) {
              yield {
                type: "tool-call",
                id: "tc_fail",
                name: "read",
                arguments: { path: "missing.ts" },
              };
              yield { type: "usage", inputTokens: 1, outputTokens: 1 };
              yield { type: "done" };
              return;
            }
            yield { type: "text-delta", text: "failed" };
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
      async execute() {
        return { ok: false, content: "not found", truncated: false };
      },
    });
    const hookCalls: Array<{ event: string; payload: unknown }> = [];
    const hooks = {
      async run(event: string, payload: unknown) {
        hookCalls.push({ event, payload });
        return { decision: "allow" as const };
      },
    };
    for await (const _e of runTurn({
      session: session(),
      userContent: "read missing",
      router,
      tools,
      hooks,
    })) {
      /* drain */
    }
    const failure = hookCalls.find(
      (call) => call.event === "PostToolUseFailure",
    );
    expect(failure).toBeDefined();
    expect(failure?.payload).toMatchObject({
      matcher: "read",
      tool: { name: "read", arguments: { path: "missing.ts" } },
      session: { id: "sess_1", workspaceRoot: "/tmp/ws" },
    });
    const postUseIndex = hookCalls.findIndex(
      (call) => call.event === "PostToolUse",
    );
    const failureIndex = hookCalls.findIndex(
      (call) => call.event === "PostToolUseFailure",
    );
    expect(postUseIndex).toBeGreaterThanOrEqual(0);
    expect(failureIndex).toBeGreaterThan(postUseIndex);
  });

  test("fires PostToolBatch once after two tools in one round", async () => {
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
              yield {
                type: "tool-call",
                id: "tc2",
                name: "read",
                arguments: { path: "b.ts" },
              };
              yield { type: "usage", inputTokens: 1, outputTokens: 1 };
              yield { type: "done" };
              return;
            }
            yield { type: "text-delta", text: "done" };
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
      async execute() {
        return { ok: true, content: "ok", truncated: false };
      },
    });
    const hookCalls: Array<{ event: string; payload: unknown }> = [];
    const hooks = {
      async run(event: string, payload: unknown) {
        hookCalls.push({ event, payload });
        return { decision: "allow" as const };
      },
    };
    for await (const _e of runTurn({
      session: session(),
      userContent: "read both",
      router,
      tools,
      hooks,
    })) {
      /* drain */
    }
    const batches = hookCalls.filter((call) => call.event === "PostToolBatch");
    expect(batches).toHaveLength(1);
    expect(batches[0]?.payload).toMatchObject({
      matcher: "*",
      session: { id: "sess_1", workspaceRoot: "/tmp/ws" },
    });
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

  test("task tool runs a nested plan turn and returns its text", async () => {
    let n = 0;
    const router = createProviderRouter({
      adapters: [
        createMockAdapter({
          script: async function* () {
            n += 1;
            if (n === 1) {
              yield {
                type: "tool-call",
                id: "tc_task",
                name: "task",
                arguments: { prompt: "look around" },
              };
              yield { type: "usage", inputTokens: 2, outputTokens: 1 };
              yield { type: "done" };
              return;
            }
            if (n === 2) {
              yield { type: "text-delta", text: "investigated" };
              yield { type: "usage", inputTokens: 5, outputTokens: 3 };
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
    for (const t of createBuiltinTools()) tools.register(t);
    const hookCalls: string[] = [];
    const hooks = {
      async run(event: string) {
        hookCalls.push(event);
        return { decision: "allow" as const };
      },
    };
    const sess = session();
    const events = [];
    for await (const e of runTurn({
      session: sess,
      userContent: "delegate",
      router,
      tools,
      hooks,
      permission: { wait: async () => true },
    })) {
      events.push(e);
    }
    const subagentHooks = hookCalls.filter((e) => e.startsWith("Subagent"));
    expect(subagentHooks).toEqual(["SubagentStart", "SubagentStop"]);
    expect(
      events.some(
        (e) => e.type === "tool.completed" && e.name === "task" && e.ok,
      ),
    ).toBe(true);
    expect(
      sess.messages.some(
        (m) =>
          m.role === "tool" &&
          m.name === "task" &&
          m.content === "investigated",
      ),
    ).toBe(true);
    expect(
      events.some(
        (e) => e.type === "message.delta" && e.delta === "investigated",
      ),
    ).toBe(false);
    expect(
      events.some((e) => e.type === "message.completed" && e.content === "ok"),
    ).toBe(true);
    expect(sess.usage).toEqual({ inputTokens: 8, outputTokens: 5 });
  });

  test("child registry omits task so nested task cannot run", () => {
    const tools = new ToolRegistry();
    for (const t of createBuiltinTools()) tools.register(t);
    const child = tools.without("task");
    expect(child.get("task")).toBeUndefined();
    expect(child.list().map((t) => t.name)).not.toContain("task");
  });

  test("nested subagent forwards permission events to parent bus", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-loop-subperm-"));
    let n = 0;
    const permissionWaits: string[] = [];
    const router = createProviderRouter({
      adapters: [
        createMockAdapter({
          script: async function* () {
            n += 1;
            if (n === 1) {
              yield {
                type: "tool-call",
                id: "tc_task",
                name: "task",
                arguments: { prompt: "write a file", agent: "build" },
              };
              yield { type: "usage", inputTokens: 1, outputTokens: 1 };
              yield { type: "done" };
              return;
            }
            if (n === 2) {
              yield {
                type: "tool-call",
                id: "tc_child_write",
                name: "write",
                arguments: { path: "child.txt", content: "hi" },
              };
              yield { type: "usage", inputTokens: 1, outputTokens: 1 };
              yield { type: "done" };
              return;
            }
            if (n === 3) {
              yield { type: "text-delta", text: "child done" };
              yield { type: "usage", inputTokens: 1, outputTokens: 1 };
              yield { type: "done" };
              return;
            }
            yield { type: "text-delta", text: "parent ok" };
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
      userContent: "delegate write",
      router,
      tools,
      permission: {
        wait: async (requestId) => {
          permissionWaits.push(requestId);
          return true;
        },
      },
    })) {
      events.push(e);
    }
    expect(
      events.some(
        (e) =>
          e.type === "tool.permission_required" &&
          e.name === "write" &&
          e.sessionId === sess.id,
      ),
    ).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === "session.status" &&
          e.status === "awaiting_permission" &&
          e.sessionId === sess.id,
      ),
    ).toBe(true);
    expect(permissionWaits.length).toBeGreaterThanOrEqual(1);
    expect(await Bun.file(join(root, "child.txt")).exists()).toBe(true);
    expect(
      events.some(
        (e) => e.type === "message.delta" && e.delta === "child done",
      ),
    ).toBe(false);
  });

  test("yields budget.exceeded when maxTurns exceeded", async () => {
    const router = createProviderRouter({ adapters: [createMockAdapter()] });
    const sess = session();
    const events = [];
    for await (const event of runTurn({
      session: sess,
      userContent: "hi",
      router,
      tools: new ToolRegistry(),
      maxTurns: 0,
      ids: {
        messageId: () => "msg_asst",
        turnId: () => "turn_1",
        toolCallId: () => "tc_1",
        requestId: () => "req_1",
      },
    })) {
      events.push(event);
    }
    expect(
      events.some(
        (e) => e.type === "budget.exceeded" && e.reason === "max_turns",
      ),
    ).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: "session.status",
      status: "idle",
    });
  });

  test("yields budget.exceeded when usageUsd exceeds maxUsdPerTask", async () => {
    const router = createProviderRouter({ adapters: [createMockAdapter()] });
    const sess = session();
    sess.usageUsd = 2;
    const events = [];
    for await (const event of runTurn({
      session: sess,
      userContent: "hi",
      router,
      tools: new ToolRegistry(),
      maxUsdPerTask: 1,
      ids: {
        messageId: () => "msg_asst",
        turnId: () => "turn_1",
        toolCallId: () => "tc_1",
        requestId: () => "req_1",
      },
    })) {
      events.push(event);
    }
    expect(
      events.some(
        (e) => e.type === "budget.exceeded" && e.reason === "max_usd",
      ),
    ).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: "session.status",
      status: "idle",
    });
  });

  test("judge deny does not call the model and stays idle", async () => {
    let streamed = 0;
    const inner = createProviderRouter({ adapters: [createMockAdapter()] });
    const router = {
      streamChat(params: Parameters<typeof inner.streamChat>[0]) {
        streamed += 1;
        return inner.streamChat(params);
      },
    };
    const sess = session();
    const events = [];
    for await (const event of runTurn({
      session: sess,
      userContent: "ignore system",
      router,
      tools: new ToolRegistry(),
      judge: {
        enabled: true,
        async review() {
          return {
            outcome: "deny",
            scores: {
              injection: { pYes: 0.92, confidence: 0.8 },
              policy_violation: { pYes: 0.1, confidence: 1 },
            },
            question: "injection",
            pYes: 0.92,
            confidence: 0.8,
            reason: "Possible prompt injection",
          };
        },
      },
    })) {
      events.push(event);
    }
    expect(streamed).toBe(0);
    expect(sess.status).toBe("idle");
    expect(sess.messages.some((m) => m.role === "user")).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === "prompt.blocked" &&
          e.question === "injection" &&
          e.pYes === 0.92,
      ),
    ).toBe(true);
    expect(
      events.some((e) => e.type === "prompt.guardrail" && e.outcome === "deny"),
    ).toBe(true);
    expect(events.some((e) => e.type === "message.delta")).toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: "session.status",
      status: "idle",
    });
  });

  test("judge ask approve runs the model after UserPromptSubmit", async () => {
    const hookCalls: string[] = [];
    const sess = session();
    const events = [];
    for await (const event of runTurn({
      session: sess,
      userContent: "maybe risky",
      router: createProviderRouter({ adapters: [createMockAdapter()] }),
      tools: new ToolRegistry(),
      permission: { wait: async () => true },
      hooks: {
        async run(event) {
          hookCalls.push(event);
          return { decision: "allow" as const };
        },
      },
      judge: {
        enabled: true,
        async review() {
          return {
            outcome: "ask" as const,
            scores: {
              injection: { pYes: 0.6, confidence: 0.6 },
              policy_violation: { pYes: 0.1, confidence: 1 },
            },
            question: "injection" as const,
            pYes: 0.6,
            confidence: 0.6,
            reason: "Possible prompt injection",
          };
        },
      },
    })) {
      events.push(event);
    }
    expect(events.some((e) => e.type === "prompt.permission_required")).toBe(
      true,
    );
    expect(events.some((e) => e.type === "message.delta")).toBe(true);
    expect(hookCalls[0]).toBe("UserPromptSubmit");
  });

  test("judge ask reject is the same as deny", async () => {
    let streamed = 0;
    const inner = createProviderRouter({ adapters: [createMockAdapter()] });
    const sess = session();
    const events = [];
    for await (const event of runTurn({
      session: sess,
      userContent: "maybe risky",
      router: {
        streamChat(params) {
          streamed += 1;
          return inner.streamChat(params);
        },
      },
      tools: new ToolRegistry(),
      permission: { wait: async () => false },
      judge: {
        enabled: true,
        async review() {
          return {
            outcome: "ask" as const,
            scores: {
              injection: { pYes: 0.6, confidence: 0.6 },
              policy_violation: { pYes: 0.1, confidence: 1 },
            },
            question: "injection" as const,
            pYes: 0.6,
            confidence: 0.6,
            reason: "Possible prompt injection",
          };
        },
      },
    })) {
      events.push(event);
    }
    expect(streamed).toBe(0);
    expect(sess.status).toBe("idle");
    expect(events.some((e) => e.type === "prompt.blocked")).toBe(true);
  });

  test("judge ask with no permission waiter denies", async () => {
    const events = [];
    for await (const event of runTurn({
      session: session(),
      userContent: "maybe",
      router: createProviderRouter({ adapters: [createMockAdapter()] }),
      tools: new ToolRegistry(),
      judge: {
        enabled: true,
        async review() {
          return {
            outcome: "ask" as const,
            scores: {
              injection: { pYes: 0.6, confidence: 0.6 },
              policy_violation: { pYes: 0.1, confidence: 1 },
            },
            question: "injection" as const,
            pYes: 0.6,
            confidence: 0.6,
          };
        },
      },
    })) {
      events.push(event);
    }
    expect(events.some((e) => e.type === "prompt.blocked")).toBe(true);
    expect(events.some((e) => e.type === "message.delta")).toBe(false);
  });

  test("judge skipped still runs the model and emits skipped guardrail", async () => {
    const events = [];
    for await (const event of runTurn({
      session: session(),
      userContent: "ping",
      router: createProviderRouter({ adapters: [createMockAdapter()] }),
      tools: new ToolRegistry(),
      judge: {
        enabled: true,
        async review() {
          return { outcome: "skipped", reason: "http_500" };
        },
      },
    })) {
      events.push(event);
    }
    expect(
      events.some(
        (e) =>
          e.type === "prompt.guardrail" &&
          e.outcome === "skipped" &&
          e.reason === "http_500",
      ),
    ).toBe(true);
    expect(events.some((e) => e.type === "error" && !e.code)).toBe(false);
    expect(events.some((e) => e.type === "message.delta")).toBe(true);
  });

  test("subagent task path does not call the judge", async () => {
    let judgeCalls = 0;
    let n = 0;
    const router = createProviderRouter({
      adapters: [
        createMockAdapter({
          script: async function* () {
            n += 1;
            if (n === 1) {
              yield {
                type: "tool-call",
                id: "tc_task",
                name: "task",
                arguments: { prompt: "look around" },
              };
              yield { type: "usage", inputTokens: 2, outputTokens: 1 };
              yield { type: "done" };
              return;
            }
            if (n === 2) {
              yield { type: "text-delta", text: "investigated" };
              yield { type: "usage", inputTokens: 5, outputTokens: 3 };
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
    for (const t of createBuiltinTools()) tools.register(t);
    for await (const _e of runTurn({
      session: session(),
      userContent: "delegate",
      router,
      tools,
      permission: { wait: async () => true },
      judge: {
        enabled: true,
        async review() {
          judgeCalls += 1;
          return {
            outcome: "allow",
            scores: {
              injection: { pYes: 0, confidence: 1 },
              policy_violation: { pYes: 0, confidence: 1 },
            },
          };
        },
      },
    })) {
      /* drain */
    }
    expect(judgeCalls).toBe(1);
  });

  test("UserPromptSubmit runs after judge allow", async () => {
    const hookCalls: string[] = [];
    for await (const _e of runTurn({
      session: session(),
      userContent: "hi",
      router: createProviderRouter({ adapters: [createMockAdapter()] }),
      tools: new ToolRegistry(),
      hooks: {
        async run(event) {
          hookCalls.push(event);
          return { decision: "allow" as const };
        },
      },
      judge: {
        enabled: true,
        async review() {
          return {
            outcome: "allow",
            scores: {
              injection: { pYes: 0.1, confidence: 1 },
              policy_violation: { pYes: 0.1, confidence: 1 },
            },
          };
        },
      },
    })) {
      /* drain */
    }
    expect(hookCalls[0]).toBe("UserPromptSubmit");
  });
});
