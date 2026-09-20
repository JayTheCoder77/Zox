import { expect, test } from "bun:test";
import { run } from "./client.ts";
import { greet } from "./server.ts";

test("wires greet through client", () => {
  expect(greet("zox")).toBe("hello zox");
  expect(run("zox")).toBe("hello zox");
});
