export { matcherHits } from "./match.ts";
export {
  createHookRunner,
  loadHooksFile,
  type RunHooksOpts,
  runHooks,
} from "./runner.ts";
export {
  defaultTrustStorePath,
  isProjectTrusted,
  recordTrust,
  type TrustOptions,
} from "./trust.ts";
export type {
  HookEntry,
  HookEvent,
  HookInput,
  HookOutput,
  HooksFile,
} from "./types.ts";
export { HOOK_EVENTS } from "./types.ts";
