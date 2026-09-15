import { afterEach, describe, expect, mock, test } from "bun:test";

const stop = mock(() => {});

mock.module("@zox/server", () => ({
  async listen() {
    return { port: 18787, stop };
  },
}));

mock.module("@zox/sdk", () => ({
  createZoxClient() {
    return {
      sessions: {
        create: async () => ({ id: "sess_embed" }),
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
  });
});
