const FORBIDDEN_IMPORTS = ["react-devtools-core", "ws"] as const;

export function forbiddenRuntimeImports(source: string): string[] {
  return FORBIDDEN_IMPORTS.filter(
    (name) =>
      source.includes(`from"${name}"`) ||
      source.includes(`from '${name}'`) ||
      source.includes(`require("${name}")`) ||
      source.includes(`require('${name}')`),
  );
}
