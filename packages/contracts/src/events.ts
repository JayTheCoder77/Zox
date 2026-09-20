import { z } from "zod";

export const sessionStatusSchema = z.enum([
  "idle",
  "running",
  "compacting",
  "awaiting_permission",
  "error",
]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const sessionStatusEventSchema = z.object({
  type: z.literal("session.status"),
  sessionId: z.string(),
  status: sessionStatusSchema,
});

export const messageDeltaEventSchema = z.object({
  type: z.literal("message.delta"),
  sessionId: z.string(),
  messageId: z.string(),
  delta: z.string(),
});

export const messageCompletedEventSchema = z.object({
  type: z.literal("message.completed"),
  sessionId: z.string(),
  messageId: z.string(),
  role: z.literal("assistant"),
  content: z.string(),
});

export const toolStartedEventSchema = z.object({
  type: z.literal("tool.started"),
  sessionId: z.string(),
  toolCallId: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

export const toolCompletedEventSchema = z.object({
  type: z.literal("tool.completed"),
  sessionId: z.string(),
  toolCallId: z.string(),
  name: z.string(),
  ok: z.boolean(),
});

export const toolPermissionRequiredEventSchema = z.object({
  type: z.literal("tool.permission_required"),
  sessionId: z.string(),
  requestId: z.string(),
  toolCallId: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

export const usageTurnEventSchema = z.object({
  type: z.literal("usage.turn"),
  sessionId: z.string(),
  turnId: z.string(),
  provider: z.string(),
  model: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
  durationMs: z.number(),
  estimatedUsd: z.number().optional(),
});

export const usageSessionEventSchema = z.object({
  type: z.literal("usage.session"),
  sessionId: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
});

export const contextEstimatedEventSchema = z.object({
  type: z.literal("context.estimated"),
  sessionId: z.string(),
  estimatedTokens: z.number(),
  windowTokens: z.number(),
  windowKnown: z.boolean(),
});

export const contextOverflowEventSchema = z.object({
  type: z.literal("context.overflow"),
  sessionId: z.string(),
  estimatedTokens: z.number(),
});

export const contextCompactedEventSchema = z.object({
  type: z.literal("context.compacted"),
  sessionId: z.string(),
  fromMessageId: z.string(),
  toMessageId: z.string(),
});

export const errorEventSchema = z.object({
  type: z.literal("error"),
  sessionId: z.string().optional(),
  message: z.string(),
  code: z.string().optional(),
});

export const skillsChangedEventSchema = z.object({
  type: z.literal("skills.changed"),
  sessionId: z.string(),
  active: z.array(z.string()),
});

export const budgetExceededEventSchema = z.object({
  type: z.literal("budget.exceeded"),
  sessionId: z.string(),
  reason: z.enum(["max_turns", "max_usd"]),
});

export const judgeQuestionSchema = z.enum(["injection", "policy_violation"]);
export type JudgeQuestion = z.infer<typeof judgeQuestionSchema>;

export const promptGuardrailOutcomeSchema = z.enum([
  "allow",
  "deny",
  "ask",
  "skipped",
]);

export const promptGuardrailEventSchema = z.object({
  type: z.literal("prompt.guardrail"),
  sessionId: z.string(),
  outcome: promptGuardrailOutcomeSchema,
  question: judgeQuestionSchema.optional(),
  pYes: z.number().optional(),
  confidence: z.number().optional(),
  reason: z.string().optional(),
});

export const promptBlockedEventSchema = z.object({
  type: z.literal("prompt.blocked"),
  sessionId: z.string(),
  question: judgeQuestionSchema,
  reason: z.string(),
  pYes: z.number(),
  confidence: z.number(),
});

export const promptPermissionRequiredEventSchema = z.object({
  type: z.literal("prompt.permission_required"),
  sessionId: z.string(),
  requestId: z.string(),
  question: judgeQuestionSchema.optional(),
  reason: z.string().optional(),
});

export const zoxEventSchema = z.discriminatedUnion("type", [
  sessionStatusEventSchema,
  messageDeltaEventSchema,
  messageCompletedEventSchema,
  toolStartedEventSchema,
  toolCompletedEventSchema,
  toolPermissionRequiredEventSchema,
  usageTurnEventSchema,
  usageSessionEventSchema,
  contextEstimatedEventSchema,
  contextOverflowEventSchema,
  contextCompactedEventSchema,
  errorEventSchema,
  skillsChangedEventSchema,
  budgetExceededEventSchema,
  promptGuardrailEventSchema,
  promptBlockedEventSchema,
  promptPermissionRequiredEventSchema,
]);

export type ZoxEvent = z.infer<typeof zoxEventSchema>;
