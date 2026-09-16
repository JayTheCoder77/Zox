import { afterEach, describe, expect, mock, test } from "bun:test";

const stop = mock(() => {});

mock.module("@zox/server", () => ({
  async listen() {
    return { port: 18787, stop };
  },
}));

const createSession = mock(async () => ({ id: "sess_embed" }));
const getSession = mock(async () => ({ id: "sess_resume" }));

mock.module("@zox/sdk", () => ({
  createZoxClient() {
    return {
      sessions: {
        create: createSession,
        get: getSession,
      },
    };
  },
}));

mock.module("@zox/tui", () => ({
  async runZoxApp() {},
}));

mock.module("./repl.ts", () => ({
  async runRepl() {},
}));

const { runEmbed } = await import("./embed.ts");

describe("runEmbed", () => {
  afterEach(() => {
    stop.mockClear();
    createSession.mockClear();
    getSession.mockClear();
  });

  test("stops the embedded listen() server after TUI exit", async () => {
    const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    try {
      await runEmbed({ port: 18787 });
    } finally {
      if (stdoutTty) Object.defineProperty(process.stdout, "isTTY", stdoutTty);
      if (stdinTty) Object.defineProperty(process.stdin, "isTTY", stdinTty);
    }
    expect(stop).toHaveBeenCalled();
  });

  test("stops the embedded listen() server after REPL exit", async () => {
    await runEmbed({ port: 18787, noTui: true });
    expect(stop).toHaveBeenCalled();
    expect(createSession).toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  });

  test("passes --session to sessions.get instead of create", async () => {
    await runEmbed({ port: 18787, noTui: true, session: "sess_resume" });
    expect(getSession).toHaveBeenCalledWith("sess_resume");
    expect(createSession).not.toHaveBeenCalled();
  });
});
