import { z } from "zod";

export const skillSummarySchema = z.object({
  name: z.string(),
  description: z.string(),
  path: z.string().optional(),
  loaded: z.boolean().optional(),
});
export type SkillSummary = z.infer<typeof skillSummarySchema>;

export const activeSkillSchema = z.object({
  name: z.string(),
  body: z.string(),
  path: z.string().optional(),
});
export type ActiveSkillDto = z.infer<typeof activeSkillSchema>;

export const sessionSkillsResponseSchema = z.object({
  catalog: z.array(skillSummarySchema),
  active: z.array(activeSkillSchema),
});
export type SessionSkillsResponse = z.infer<typeof sessionSkillsResponseSchema>;

export const workspaceSkillsResponseSchema = z.object({
  skills: z.array(skillSummarySchema),
});

export const mutateSessionSkillsRequestSchema = z.object({
  action: z.enum(["load", "unload"]),
  name: z.string().min(1),
});
export type MutateSessionSkillsRequest = z.infer<
  typeof mutateSessionSkillsRequestSchema
>;
