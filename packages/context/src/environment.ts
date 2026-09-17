export function buildEnvironmentPrompt(opts: {
  model: string;
  workingDirectory: string;
  workspaceRoot: string;
  isGitRepo: boolean;
  platform: string;
  date: string;
}): string {
  return [
    `You are powered by the model named ${opts.model}. The exact model ID is ${opts.model}`,
    "Here is some useful information about the environment you are running in:",
    " ",
    ` Working directory: ${opts.workingDirectory}`,
    ` Workspace root folder: ${opts.workspaceRoot}`,
    ` Is directory a git repo: ${opts.isGitRepo ? "yes" : "no"}`,
    ` Platform: ${opts.platform}`,
    ` Today's date: ${opts.date}`,
    " ",
  ].join("\n");
}
