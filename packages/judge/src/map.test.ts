import { describe, expect, test } from "bun:test";
import { DEFAULT_BAND_CONFIG } from "./defaults.ts";
import { combineQuestionBands, mapNoulToBand } from "./map.ts";

describe("mapNoulToBand", () => {
  test("deny when P(yes) and confidence meet deny thresholds", () => {
    expect(mapNoulToBand(0.85, 0.7, DEFAULT_BAND_CONFIG)).toBe("deny");
    expect(mapNoulToBand(0.99, 0.95, DEFAULT_BAND_CONFIG)).toBe("deny");
  });

  test("ask when P(yes) and confidence meet ask but not deny", () => {
    expect(mapNoulToBand(0.55, 0.5, DEFAULT_BAND_CONFIG)).toBe("ask");
    expect(mapNoulToBand(0.84, 0.9, DEFAULT_BAND_CONFIG)).toBe("ask");
  });

  test("allow otherwise including low-confidence noise", () => {
    expect(mapNoulToBand(0.9, 0.4, DEFAULT_BAND_CONFIG)).toBe("allow");
    expect(mapNoulToBand(0.2, 0.9, DEFAULT_BAND_CONFIG)).toBe("allow");
    expect(mapNoulToBand(0.54, 0.99, DEFAULT_BAND_CONFIG)).toBe("allow");
  });
});

describe("combineQuestionBands", () => {
  test("max severity: injection deny beats policy ask", () => {
    const combined = combineQuestionBands({
      injection: { band: "deny", pYes: 0.9, confidence: 0.8 },
      policy_violation: { band: "ask", pYes: 0.6, confidence: 0.6 },
    });
    expect(combined).toMatchObject({
      outcome: "deny",
      question: "injection",
      pYes: 0.9,
      confidence: 0.8,
    });
  });

  test("both deny prefers higher P(yes)", () => {
    const combined = combineQuestionBands({
      injection: { band: "deny", pYes: 0.86, confidence: 0.8 },
      policy_violation: { band: "deny", pYes: 0.95, confidence: 0.8 },
    });
    expect(combined.question).toBe("policy_violation");
    expect(combined.pYes).toBe(0.95);
  });

  test("equal deny P(yes) prefers injection", () => {
    const combined = combineQuestionBands({
      injection: { band: "deny", pYes: 0.9, confidence: 0.8 },
      policy_violation: { band: "deny", pYes: 0.9, confidence: 0.99 },
    });
    expect(combined.question).toBe("injection");
  });

  test("both allow omits a fired question", () => {
    const combined = combineQuestionBands({
      injection: { band: "allow", pYes: 0.1, confidence: 0.9 },
      policy_violation: { band: "allow", pYes: 0.2, confidence: 0.9 },
    });
    expect(combined.outcome).toBe("allow");
    expect(combined.question).toBeUndefined();
  });
});
