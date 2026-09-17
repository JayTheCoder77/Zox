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
  instructions: z
    .object({
      files: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  sandbox: z
    .object({
      mode: z.enum(["host", "worktree", "container", "remote"]).optional(),
      worktree: z
        .object({
          cleanup: z.enum(["keep", "remove"]).optional(),
        })
        .optional(),
      envAllowlist: z.array(z.string()).optional(),
      network: z
        .object({
          allowHosts: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
  context: z
    .object({
      windowTokens: z.number().int().positive().optional(),
      overflowThreshold: z.number().gt(0).lte(1).optional(),
      prune: z
        .object({
          enabled: z.boolean().optional(),
          protectMinTokens: z.number().int().positive().optional(),
          minReclaim: z.number().int().positive().optional(),
          protectedTools: z.array(z.string().min(1)).optional(),
        })
        .optional(),
    })
    .optional(),
  budget: z
    .object({
      preCompactTokenThreshold: z.number().int().positive().optional(),
      maxTurns: z.number().int().nonnegative().optional(),
      maxUsdPerTask: z.number().nonnegative().optional(),
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
  // Dense embeddings are deferred; apiKeyEnv is parsed and ignored (BM25/FTS5 only).
  index: z
    .object({
      embeddings: z
        .object({
          apiKeyEnv: z.string().min(1).optional(),
        })
        .optional(),
    })
    .optional(),
  providers: z.record(z.string(), providerSchema).optional(),
  observability: z
    .object({
      enabled: z.boolean().optional(),
      serviceName: z.string().min(1).optional(),
      recordContent: z.boolean().optional(),
      otlp: z
        .object({
          endpoint: z.string().optional(),
          headers: z.record(z.string(), z.string()).optional(),
        })
        .optional(),
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
