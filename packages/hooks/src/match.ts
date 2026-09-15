export function matcherHits(matcher: string, value: string): boolean {
  if (matcher === "*") return true;
  try {
    return new RegExp(matcher).test(value);
  } catch {
    return false;
  }
}
