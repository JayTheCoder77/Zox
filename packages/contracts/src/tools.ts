import { z } from "zod";

export const permissionDecisionSchema = z.enum(["allow", "deny", "ask"]);
export type PermissionDecision = z.infer<typeof permissionDecisionSchema>;

export const toolRulesSchema = z.object({
  default: permissionDecisionSchema.optional(),
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
});
export type ToolRules = z.infer<typeof toolRulesSchema>;

export const permissionRulesetSchema = z.record(z.string(), toolRulesSchema);
export type PermissionRuleset = z.infer<typeof permissionRulesetSchema>;
