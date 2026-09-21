import MODEL_WINDOWS from "./model-windows.json" with { type: "json" };

const windows = MODEL_WINDOWS as Record<string, number>;
const LOCAL_PROVIDERS = new Set(["mock"]);

/** Last-segment keys from models.dev, plus a few aliases. */
export function lookupContextWindow(modelRef: string): number | undefined {
  const parts = modelRef
    .trim()
    .toLowerCase()
    .split("/")
    .filter((part) => part.length > 0);
  if (parts.length === 0) return undefined;
  const provider = parts[0];
  if (provider && LOCAL_PROVIDERS.has(provider)) return undefined;

  const candidates = new Set<string>();
  candidates.add(parts.join("/"));
  if (parts.length > 1) {
    candidates.add(parts.slice(1).join("/"));
  }
  const last = parts[parts.length - 1];
  if (last && /[0-9]/.test(last)) {
    candidates.add(last);
  }

  for (const candidate of candidates) {
    const tokens = windows[candidate];
    if (typeof tokens === "number" && tokens > 0) {
      return tokens;
    }
  }
  return undefined;
}
