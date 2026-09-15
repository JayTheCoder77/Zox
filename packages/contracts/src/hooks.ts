import { z } from "zod";

export const hookEventSchema = z.enum([
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "Stop",
  "SessionEnd",
]);

export const hookInputSchema = z.object({
  event: hookEventSchema,
  session: z.object({
    id: z.string(),
    workspaceRoot: z.string(),
  }),
  tool: z
    .object({
      name: z.string(),
      arguments: z.record(z.string(), z.unknown()),
    })
    .optional(),
  prompt: z.string().optional(),
  context: z.object({ estimatedTokens: z.number().optional() }).optional(),
  matcher: z.string().optional(),
});

export const hookOutputSchema = z.object({
  decision: z.enum(["allow", "deny", "ask"]),
  reason: z.string().optional(),
  message: z.string().optional(),
  updatedInput: z.record(z.string(), z.unknown()).optional(),
});

export type HookEvent = z.infer<typeof hookEventSchema>;
export type HookInput = z.infer<typeof hookInputSchema>;
export type HookOutput = z.infer<typeof hookOutputSchema>;
