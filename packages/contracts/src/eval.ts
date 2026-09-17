import { z } from "zod";

export const evalTaskSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  workspace: z.string().optional(), // default: temp copy of fixture dir
  model: z.string().default("mock/echo"),
  expect: z.object({
    stdoutIncludes: z.string().optional(),
    files: z
      .array(z.object({ path: z.string(), contains: z.string() }))
      .optional(),
  }),
});

export type EvalTask = z.infer<typeof evalTaskSchema>;

export type EvalRunSummary = {
  taskId: string;
  pass: boolean;
  turns: number;
  usd: number | null;
  traceId?: string;
};
