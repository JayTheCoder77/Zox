import { z } from "zod";
import { sessionStatusSchema } from "./events.ts";

export const sessionExportSchema = z.object({
  version: z.literal(1),
  session: z.object({
    id: z.string(),
    agent: z.string(),
    model: z.string(),
    status: sessionStatusSchema,
    createdAt: z.number().optional(),
  }),
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.string(),
      name: z.string().optional(),
    }),
  ),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
  }),
  memory: z.array(z.string()).optional(),
});

export type SessionExport = z.infer<typeof sessionExportSchema>;
