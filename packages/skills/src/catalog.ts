export type CatalogOptions = {
  catalog?: boolean;
  catalogMaxSkills?: number;
  catalogMaxDescriptionChars?: number;
};

const DEFAULT_MAX_SKILLS = 64;
const DEFAULT_MAX_DESC = 200;

export function buildSkillsCatalog(
  skills: Array<{ name: string; description: string }>,
  opts: CatalogOptions = {},
): string | undefined {
  if (opts.catalog === false) return undefined;
  if (skills.length === 0) return undefined;
  const maxSkills = opts.catalogMaxSkills ?? DEFAULT_MAX_SKILLS;
  const maxDesc = opts.catalogMaxDescriptionChars ?? DEFAULT_MAX_DESC;
  const sliced = skills.slice(0, maxSkills);
  const lines = [
    "Available skills (load with the skill tool or /skill <name>):",
  ];
  for (const skill of sliced) {
    const desc =
      skill.description.length > maxDesc
        ? skill.description.slice(0, maxDesc)
        : skill.description;
    lines.push(`- ${skill.name}: ${desc}`);
  }
  return lines.join("\n");
}
