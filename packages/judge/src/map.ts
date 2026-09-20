import type {
  Band,
  BandConfig,
  JudgeQuestion,
  QuestionScore,
} from "./types.ts";

export function mapNoulToBand(
  pYes: number,
  confidence: number,
  config: BandConfig,
): Band {
  if (pYes >= config.denyMinYes && confidence >= config.denyMinConfidence) {
    return "deny";
  }
  if (pYes >= config.askMinYes && confidence >= config.askMinConfidence) {
    return "ask";
  }
  return "allow";
}

const severity: Record<Band, number> = {
  allow: 0,
  ask: 1,
  deny: 2,
};

export function combineQuestionBands(scores: {
  injection: QuestionScore;
  policy_violation: QuestionScore;
}): {
  outcome: Band;
  question?: JudgeQuestion;
  pYes?: number;
  confidence?: number;
} {
  const injection = scores.injection;
  const policy = scores.policy_violation;
  const injSev = severity[injection.band];
  const polSev = severity[policy.band];
  if (injSev === 0 && polSev === 0) {
    return { outcome: "allow" };
  }
  if (injSev > polSev) {
    return pick("injection", injection);
  }
  if (polSev > injSev) {
    return pick("policy_violation", policy);
  }
  if (injection.pYes > policy.pYes) {
    return pick("injection", injection);
  }
  if (policy.pYes > injection.pYes) {
    return pick("policy_violation", policy);
  }
  return pick("injection", injection);
}

function pick(
  question: JudgeQuestion,
  score: QuestionScore,
): {
  outcome: Band;
  question: JudgeQuestion;
  pYes: number;
  confidence: number;
} {
  return {
    outcome: score.band,
    question,
    pYes: score.pYes,
    confidence: score.confidence,
  };
}
