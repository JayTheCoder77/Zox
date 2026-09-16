import { z } from "zod";
import { activeSkillSchema } from "./skills.ts";

export const writeMemoryRequestSchema = z.object({
  content: z.string().min(1),
  pinned: z.boolean().optional(),
});
export type WriteMemoryRequest = z.infer<typeof writeMemoryRequestSchema>;

export const durableMemorySchema = z.object({
  id: z.string(),
  scope: z.string(),
  content: z.string(),
  pinned: z.boolean(),
  path: z.string().nullable().optional(),
  updatedAt: z.number().optional(),
});
export type DurableMemoryDto = z.infer<typeof durableMemorySchema>;

export const memorySearchResponseSchema = z.object({
  memories: z.array(durableMemorySchema),
});
export type MemorySearchResponse = z.infer<typeof memorySearchResponseSchema>;

export const sessionMemoryResponseSchema = z.object({
  planJson: z.unknown(),
  priorStateMarkdown: z.string(),
  activeSkills: z.array(activeSkillSchema),
  injectedDurableIds: z.array(z.string()),
});
export type SessionMemoryResponse = z.infer<typeof sessionMemoryResponseSchema>;
