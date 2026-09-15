#!/usr/bin/env bun
import { runEmbed } from "./embed.ts";
import { runHooksTrust } from "./hooks.ts";
import { parseArgs } from "./parse.ts";
import { runServe } from "./serve.ts";

async function main(): Promise<void> {
  const { flags, positionals } = parseArgs(process.argv.slice(2));

  if (positionals[0] === "hooks" && positionals[1] === "trust") {
    await runHooksTrust(flags.workspace);
    return;
  }

  if (positionals[0] === "serve") {
    await runServe(flags);
    return;
  }

  await runEmbed(flags);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
