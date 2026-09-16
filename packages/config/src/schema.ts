import { z } from "zod";

const mcpServerSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const providerSchema = z.object({
  apiKeyEnv: z.string().min(1).optional(),
  baseURL: z.string().min(1).optional(),
  kind: z
    .enum(["openai", "anthropic", "google", "openai-compatible"])
    .optional(),
});

export const zoxConfigSchema = z.object({
  model: z.string().optional(),
  agent: z.string().optional(),
  sandbox: z
    .object({
      mode: z.enum(["host", "worktree", "container", "remote"]).optional(),
      worktree: z
        .object({
          cleanup: z.enum(["keep", "remove"]).optional(),
        })
        .optional(),
    })
    .optional(),
  context: z
    .object({
      overflowThreshold: z.number().gt(0).lte(1).optional(),
    })
    .optional(),
  budget: z
    .object({
      preCompactTokenThreshold: z.number().int().positive().optional(),
    })
    .optional(),
  memory: z
    .object({
      autoSummarize: z.boolean().optional(),
      summarizeModel: z.string().optional(),
      startupInjectCount: z.number().int().positive().optional(),
      rollingSummary: z.boolean().optional(),
      autoInject: z.array(z.string()).optional(),
    })
    .optional(),
  tools: z
    .object({
      webfetch: z
        .object({
          maxBytes: z.number().int().positive().optional(),
          allowedHosts: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
  skills: z
    .object({
      autoLoad: z.array(z.string()).optional(),
      loadPaths: z.array(z.string()).optional(),
      catalog: z.boolean().optional(),
      catalogMaxSkills: z.number().int().positive().optional(),
      catalogMaxDescriptionChars: z.number().int().positive().optional(),
    })
    .optional(),
  mcp: z
    .object({
      servers: z.record(z.string(), mcpServerSchema).optional(),
    })
    .optional(),
  providers: z.record(z.string(), providerSchema).optional(),
  observability: z
    .object({
      recordContent: z.boolean().optional(),
      metrics: z
        .union([
          z.boolean(),
          z.object({
            public: z.boolean().optional(),
          }),
        ])
        .optional(),
    })
    .optional(),
});

export type ZoxConfig = z.infer<typeof zoxConfigSchema>;
export type McpServerConfig = z.infer<typeof mcpServerSchema>;
