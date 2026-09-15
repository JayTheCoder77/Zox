import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleProviderMessages } from "@zox/context";
import { createHookRunner } from "@zox/hooks";
import { compactSessionTurn } from "./compact.ts";
import type { StoredSession } from "./store.ts";

function session(messages: StoredSession["messages"]): StoredSession {
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

describe("compactSessionTurn", () => {
  test("yields compacting, context.compacted, idle; runs Pre/PostCompact", async () => {
    const root = await mkdtemp(join(tmpdir(), "zox-compact-"));
    const pre = join(root, "pre.sh");
    const post = join(root, "post.sh");
    await Bun.write(pre, `#!/bin/sh\nprintf '{"decision":"allow"}\\n'`);
    await Bun.write(post, `#!/bin/sh\nprintf '{"decision":"allow"}\\n'`);
    await chmod(pre, 0o755);
    await chmod(post, 0o755);

    const messages = [
      { id: "m1", role: "user" as const, content: "a" },
      { id: "m2", role: "assistant" as const, content: "b" },
      { id: "m3", role: "user" as const, content: "c" },
      { id: "m4", role: "user" as const, content: "last" },
    ];
    const sess = session(messages);
    const hooks = createHookRunner({
      files: [
        {
          zoxHooksVersion: 1,
          hooks: {
            PreCompact: [{ matcher: "*", type: "command", command: pre }],
            PostCompact: [{ matcher: "*", type: "command", command: post }],
          },
        },
      ],
      trusted: true,
      cwd: root,
    });

    const events = [];
    for await (const event of compactSessionTurn({
      session: sess,
      summarize: async () => "SUM",
      hooks,
    })) {
      events.push(event);
    }

    expect(events.map((e) => e.type)).toEqual([
      "session.status",
      "context.compacted",
      "session.status",
    ]);
    expect(events[0]).toMatchObject({ status: "compacting" });
    expect(events[1]).toMatchObject({
      fromMessageId: "m1",
      toMessageId: "m3",
    });
    expect(sess.messages).toHaveLength(4);
    expect(
      assembleProviderMessages({
        messages: sess.messages,
        compactions: sess.compactions,
      }),
    ).toHaveLength(2);
  });
});
