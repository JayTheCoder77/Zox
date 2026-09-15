import { resolve } from "node:path";
import { recordTrust } from "@zox/hooks";

export async function runHooksTrust(workspace?: string): Promise<void> {
  const root = resolve(workspace ?? process.cwd());
  await recordTrust(root);
  console.log(`trusted ${root}`);
}
