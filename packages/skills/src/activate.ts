export type ActiveSkill = { name: string; body: string; path?: string };

export function activateSkill(
  current: ActiveSkill[],
  skill: ActiveSkill,
): ActiveSkill[] {
  const without = current.filter((entry) => entry.name !== skill.name);
  return [...without, skill];
}

export function deactivateSkill(
  current: ActiveSkill[],
  name: string,
): ActiveSkill[] {
  return current.filter((entry) => entry.name !== name);
}
