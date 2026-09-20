import { describe, expect, test } from "bun:test";
import {
  formatPrivateAggregate,
  median,
  passAt1,
  passAtK,
  type TaskTrials,
} from "./eval-score.ts";

describe("pass@k", () => {
  test("pass@1 is the fraction of tasks whose first trial passed", () => {
    const tasks: TaskTrials[] = [
      { taskId: "a", passes: [true, false, true] },
      { taskId: "b", passes: [false, true, true] },
    ];
    expect(passAt1(tasks)).toBe(0.5);
  });

  test("pass@k is the fraction of tasks with at least one success in k trials", () => {
    const tasks: TaskTrials[] = [
      { taskId: "a", passes: [false, true] },
      { taskId: "b", passes: [false, false] },
    ];
    expect(passAtK(tasks, 2)).toBe(0.5);
    expect(passAtK(tasks, 1)).toBe(0);
  });

  test("empty suite is 0", () => {
    expect(passAt1([])).toBe(0);
    expect(passAtK([], 3)).toBe(0);
  });
});

describe("median", () => {
  test("returns the middle value", () => {
    expect(median([10, 30, 20])).toBe(20);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("formatPrivateAggregate", () => {
  test("prints pass@1, pass@k, median latency, cost, and tool calls", () => {
    const text = formatPrivateAggregate({
      tasks: [
        {
          taskId: "fix-add",
          passes: [true, false],
          latencyMs: [1000, 2000],
          usd: [0.1, 0.2],
          toolCalls: [4, 6],
          toolFailures: [0, 1],
        },
      ],
      k: 2,
    });
    expect(text).toContain("pass@1 1/1");
    expect(text).toContain("pass@2 1/1");
    expect(text).toContain("median latency_ms 1500");
    expect(text).toContain("$/task fix-add=0.15");
    expect(text).toContain("tools/task fix-add=5");
  });
});
