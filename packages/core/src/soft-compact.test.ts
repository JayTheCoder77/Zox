import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHookRunner } from "@zox/hooks";
import { createMockAdapter, createProviderRouter } from "@zox/providers";
import { ToolRegistry } from "@zox/tools";
import { compactSessionTurn } from "./compact.ts";
import { runTurn } from "./loop.ts";
import { runSoftPreCompact } from "./soft-compact.ts";
import type { StoredSession } from "./store.ts";

function session(messages: StoredSession["messages"] = []): StoredSession {
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
    messages,
  };
}

async function priorStateHooks(root: string) {
  const pre = join(root, "prior-state-summary.sh");
  const start = join(root, "reinject-after-compact.sh");
  const manual = join(root, "manual.sh");
  await Bun.write(
    pre,
    `#!/bin/sh\nprintf '%s\\n' '{"decision":"allow","message":"## Prior state from PreCompact auto"}'`,
  );
  await Bun.write(
    start,
    `#!/bin/sh\nprintf '%s\\n' '{"decision":"allow","message":"## Reinject from SessionStart compact"}'`,
  );
  await Bun.write(
    manual,
    `#!/bin/sh\nprintf '%s\\n' '{"decision":"allow","message":"from PreCompact manual"}'`,
  );
  await chmod(pre, 0o755);
  await chmod(start, 0o755);
  await chmod(manual, 0o755);
  return createHookRunner({
    files: [
      {
        zoxHooksVersion: 1,
        hooks: {
          PreCompact: [
            { matcher: "auto", type: "command", command: pre },
            { matcher: "manual", type: "command", command: manual },
          ],
          SessionStart: [
            { matcher: "compact", type: "command", command: start },
          ],
        },
      },
    ],
    trusted: true,
    cwd: root,
  });
}

describe("runSoftPreCompact", () => {
  test("keeps messages, merges hook prior-state, and skips compaction", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-soft-compact-"));
    const hooks = await priorStateHooks(root);
    const messages = [
      { id: "m1", role: "user" as const, content: "a" },
      { id: "m2", role: "assistant" as const, content: "b" },
      { id: "m3", role: "user" as const, content: "c" },
    ];
    const sess = session(messages);

    await runSoftPreCompact({
      session: sess,
      hooks,
      estimatedTokens: 150_000,
    });

    expect(sess.messages).toHaveLength(3);
    expect(sess.priorStateMarkdown).toContain(
      "Prior state from PreCompact auto",
    );
    expect(sess.priorStateMarkdown).toContain(
      "Reinject from SessionStart compact",
    );
    expect(sess.priorStateMarkdown).not.toContain("from PreCompact manual");
    expect(sess.compactions).toBeUndefined();
  });
});

describe("runTurn soft preCompactTokenThreshold", () => {
  test("runs hook-only prior-state once when estimate is at threshold and not hard overflow", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-soft-loop-"));
    const hooks = await priorStateHooks(root);
    const sess = session();
    const router = createProviderRouter({ adapters: [createMockAdapter()] });

    const firstEvents = [];
    for await (const event of runTurn({
      session: sess,
      userContent: "hello",
      router,
      tools: new ToolRegistry(),
      hooks,
      context: {
        estimateTokens: () => 150_000,
        windowTokens: 1_000_000,
      },
    })) {
      firstEvents.push(event);
    }

    const afterFirst = sess.messages.length;
    expect(sess.priorStateMarkdown).toContain(
      "Prior state from PreCompact auto",
    );
    expect(sess.softPreCompactPending).toBe(true);
    expect(sess.compactions).toBeUndefined();
    expect(
      firstEvents.some((event) => event.type === "context.compacted"),
    ).toBe(false);

    for await (const _ of runTurn({
      session: sess,
      userContent: "again",
      router,
      tools: new ToolRegistry(),
      hooks,
      context: {
        estimateTokens: () => 150_000,
        windowTokens: 1_000_000,
      },
    })) {
      /* drain */
    }

    expect(
      sess.priorStateMarkdown?.split("Prior state from PreCompact auto"),
    ).toHaveLength(2);
    expect(sess.messages.length).toBeGreaterThan(afterFirst);
  });

  test("skips soft path when the same estimate is hard overflow", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-soft-overflow-"));
    const hooks = await priorStateHooks(root);
    const sess = session();
    const router = createProviderRouter({ adapters: [createMockAdapter()] });

    for await (const _ of runTurn({
      session: sess,
      userContent: "hello",
      router,
      tools: new ToolRegistry(),
      hooks,
      context: {
        estimateTokens: () => 150_000,
        windowTokens: 160_000,
      },
    })) {
      /* drain */
    }

    expect(sess.priorStateMarkdown).toBeUndefined();
    expect(sess.softPreCompactPending).toBeUndefined();
  });
});

describe("compactSessionTurn", () => {
  test("clears softPreCompactPending after a successful full compact", async () => {
    const sess = session([
      { id: "m1", role: "user", content: "a" },
      { id: "m2", role: "assistant", content: "b" },
      { id: "m3", role: "user", content: "c" },
      { id: "m4", role: "user", content: "last" },
    ]);
    sess.softPreCompactPending = true;
    for await (const _ of compactSessionTurn({
      session: sess,
      summarize: async () => "SUM",
    })) {
      /* drain */
    }
    expect(sess.softPreCompactPending).toBe(false);
  });
});
