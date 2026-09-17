import { describe, expect, mock, test } from "bun:test";
import { executeSlash } from "./commands.ts";

describe("executeSlash plugin expand", () => {
  test("sends expand content and prints nothing extra", async () => {
    const waitForIdle = mock(async () => {});
    const send = mock(() => ({
      events: async function* () {},
      waitForIdle,
      collectText: async () => "",
      onTool() {},
      async respondPermission() {},
    }));
    const command = mock(async () => ({
      type: "expand",
      content: "Explain the parser in one sentence.",
    }));
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      await executeSlash(
        { name: "foo", args: ["the parser"] },
        {
          client: {} as never,
          getSession: () =>
            ({
              command,
              send,
              close: async () => {},
            }) as never,
          setSession: () => {},
          workspaceRoot: "/tmp",
          sessionDefaults: {},
        },
      );
    } finally {
      console.log = originalLog;
    }
    expect(command).toHaveBeenCalledWith("foo", ["the parser"]);
    expect(send).toHaveBeenCalledWith("Explain the parser in one sentence.");
    expect(waitForIdle).toHaveBeenCalled();
    expect(logs).toEqual([]);
  });
});
