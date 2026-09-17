const REDACTED = "[redacted]";

export function redactSecrets(text: string): string {
  let out = text;
  out = out.replace(/Bearer\s+\S+/gi, `Bearer ${REDACTED}`);
  out = out.replace(/("apiKey"\s*:\s*")([^"]*)(")/gi, `$1${REDACTED}$3`);
  out = out.replace(/('apiKey'\s*:\s*')([^']*)(')/gi, `$1${REDACTED}$3`);
  out = out.replace(
    /\b(OPENAI_API_KEY|ZOXX_SERVER_TOKEN)\s*=\s*\S+/g,
    `$1=${REDACTED}`,
  );
  out = out.replace(/\bsk-ant-[A-Za-z0-9_-]+/g, REDACTED);
  out = out.replace(/\bsk-[A-Za-z0-9_-]+/g, REDACTED);
  out = out.replace(/\bAIza[A-Za-z0-9_-]+/g, REDACTED);
  return out;
}
