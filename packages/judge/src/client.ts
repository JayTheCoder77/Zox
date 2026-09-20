import { z } from "zod";
import {
  DEFAULT_API_KEY_ENV,
  DEFAULT_JEV_BASE_URL,
  DEFAULT_JEV_MODEL,
  DEFAULT_MAX_PROMPT_CHARS,
  DEFAULT_POLICY,
  DEFAULT_ROLE,
  DEFAULT_TIMEOUT_MS,
  INJECTION_QUESTION,
  mergeBandConfig,
  POLICY_VIOLATION_QUESTION,
} from "./defaults.ts";
import { combineQuestionBands, mapNoulToBand } from "./map.ts";
import type {
  CreatePromptJudgeOpts,
  JudgeScores,
  PromptJudge,
  QuestionScore,
} from "./types.ts";

const noulAnswerSchema = z.object({
  type: z.literal("noul").optional(),
  noul: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1).optional(),
});

const systemOneResponseSchema = z.object({
  answers: z.object({
    injection: noulAnswerSchema,
    policy_violation: noulAnswerSchema,
  }),
});

export function createPromptJudge(
  opts: CreatePromptJudgeOpts = {},
): PromptJudge {
  const enabled = opts.enabled ?? false;
  return {
    enabled,
    async review(input) {
      if (!enabled) {
        return { outcome: "skipped", reason: "disabled" };
      }
      const apiKey = opts.apiKey;
      if (!apiKey) {
        return { outcome: "skipped", reason: "missing_api_key" };
      }
      const promptOpts = opts.prompt ?? {};
      if (promptOpts.enabled === false) {
        return { outcome: "skipped", reason: "prompt_disabled" };
      }
      const maxChars = promptOpts.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS;
      const timeoutMs = promptOpts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const prompt =
        input.prompt.length > maxChars
          ? input.prompt.slice(0, maxChars)
          : input.prompt;
      const body = {
        model: opts.model ?? DEFAULT_JEV_MODEL,
        state: {
          role: `${DEFAULT_ROLE} Workspace: ${input.workspaceRoot}.`,
          policy: promptOpts.policy ?? DEFAULT_POLICY,
          prompt,
        },
        questions: {
          injection: {
            type: "noul",
            instructions: INJECTION_QUESTION,
          },
          policy_violation: {
            type: "noul",
            instructions: POLICY_VIOLATION_QUESTION,
          },
        },
      };
      const fetchImpl = opts.fetch ?? fetch;
      try {
        const response = await fetchImpl(opts.baseURL ?? DEFAULT_JEV_BASE_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
          return { outcome: "skipped", reason: `http_${response.status}` };
        }
        const json: unknown = await response.json();
        const parsed = systemOneResponseSchema.safeParse(json);
        if (!parsed.success) {
          return { outcome: "skipped", reason: "invalid_response" };
        }
        const injection = toScore(
          parsed.data.answers.injection,
          mergeBandConfig(promptOpts.injection),
        );
        const policy = toScore(
          parsed.data.answers.policy_violation,
          mergeBandConfig(promptOpts.policyViolation),
        );
        const scores: JudgeScores = {
          injection: { pYes: injection.pYes, confidence: injection.confidence },
          policy_violation: {
            pYes: policy.pYes,
            confidence: policy.confidence,
          },
        };
        const combined = combineQuestionBands({
          injection,
          policy_violation: policy,
        });
        return {
          outcome: combined.outcome,
          scores,
          question: combined.question,
          pYes: combined.pYes,
          confidence: combined.confidence,
          reason: combined.question ? reasonFor(combined.question) : undefined,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "judge_error";
        return { outcome: "skipped", reason: message };
      }
    },
  };
}

export { DEFAULT_API_KEY_ENV };

function toScore(
  answer: z.infer<typeof noulAnswerSchema>,
  band: ReturnType<typeof mergeBandConfig>,
): QuestionScore {
  const pYes = answer.noul;
  const confidence = answer.confidence ?? 1;
  return {
    pYes,
    confidence,
    band: mapNoulToBand(pYes, confidence, band),
  };
}

function reasonFor(question: "injection" | "policy_violation"): string {
  if (question === "injection") {
    return "Possible prompt injection";
  }
  return "Prompt violates configured policy";
}
