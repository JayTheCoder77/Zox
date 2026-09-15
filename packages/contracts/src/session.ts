import { z } from "zod";
import { sessionStatusSchema } from "./events.ts";

export const createSessionRequestSchema = z.object({
  workspaceRoot: z.string().min(1),
  agent: z.string().default("build"),
  model: z.string().default("mock/echo"),
});
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export const createSessionResponseSchema = z.object({
  id: z.string(),
  workspaceRoot: z.string(),
  agent: z.string(),
  model: z.string(),
  status: sessionStatusSchema,
});
export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>;

export const sendMessageRequestSchema = z.object({
  content: z.string().min(1),
});
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const sessionRecordSchema = createSessionResponseSchema;
export type SessionRecord = CreateSessionResponse;
