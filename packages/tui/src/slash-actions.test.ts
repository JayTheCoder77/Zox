import { describe, expect, mock, test } from "bun:test";
import { executeSlash } from "./slash-actions.ts";

describe("executeSlash plugin expand", () => {
  test("sends expand content as a user message", async () => {
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
    const output: string[] = [];
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
        onOutput: (line) => output.push(line),
        onExit: () => {},
      },
    );
    expect(command).toHaveBeenCalledWith("foo", ["the parser"]);
    expect(send).toHaveBeenCalledWith("Explain the parser in one sentence.");
    expect(waitForIdle).toHaveBeenCalled();
    expect(output).toEqual([]);
  });
});
