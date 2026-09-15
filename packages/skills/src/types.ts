export type Skill = {
  name: string;
  description: string;
  body: string;
  path: string;
};

export type SkillDiscoveryOptions = {
  workspaceRoot: string;
  loadPaths?: string[];
};
