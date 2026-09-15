import { describe, expect, test } from "bun:test";
import { render } from "ink";
import React from "react";
import { StatusBar } from "./status-bar.tsx";

describe("StatusBar ink render", () => {
  test.skipIf(!process.stdout.isTTY)("mounts StatusBar", () => {
    const instance = render(
      <StatusBar
        model="mock/echo"
        agent="build"
        cwd="/tmp"
        inputTokens={10}
        outputTokens={5}
      />,
    );
    expect(typeof instance.waitUntilExit).toBe("function");
    instance.unmount();
  });
});
