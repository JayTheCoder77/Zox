export type JudgeQuestion = "injection" | "policy_violation";

export type Band = "allow" | "ask" | "deny";

export type BandConfig = {
  denyMinYes: number;
  denyMinConfidence: number;
  askMinYes: number;
  askMinConfidence: number;
};

export type QuestionScore = {
  pYes: number;
  confidence: number;
  band: Band;
};

export type JudgeScores = {
  injection: { pYes: number; confidence: number };
  policy_violation: { pYes: number; confidence: number };
};

export type PromptJudgeResult =
  | {
      outcome: "allow" | "deny" | "ask";
      scores: JudgeScores;
      question?: JudgeQuestion;
      pYes?: number;
      confidence?: number;
      reason?: string;
    }
  | { outcome: "skipped"; reason: string };

export type PromptJudge = {
  enabled: boolean;
  review(input: {
    prompt: string;
    workspaceRoot: string;
  }): Promise<PromptJudgeResult>;
};

export type JudgePromptOptions = {
  enabled?: boolean;
  policy?: string;
  maxPromptChars?: number;
  timeoutMs?: number;
  injection?: Partial<BandConfig>;
  policyViolation?: Partial<BandConfig>;
};

export type CreatePromptJudgeOpts = {
  enabled?: boolean;
  apiKey?: string;
  apiKeyEnv?: string;
  baseURL?: string;
  model?: string;
  prompt?: JudgePromptOptions;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
};
