import { truncateUtf8 } from "@zox/sandbox";
import description from "./descriptions/webfetch.txt" with { type: "text" };
import { toolContent, toolDenied, toolError, type ZoxTool } from "./types.ts";

const DEFAULT_MAX_BYTES = 32_000;

export const webfetchTool: ZoxTool = {
  name: "webfetch",
  description,
  parameters: {
    type: "object",
    properties: {
      url: { type: "string" },
    },
    required: ["url"],
    additionalProperties: false,
  },
  async execute(args, ctx) {
    const raw = args.url;
    if (typeof raw !== "string" || raw.length === 0) {
      return toolError(
        "Invalid arguments for webfetch",
        ctx.maxToolOutputChars,
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return toolError("Invalid URL", ctx.maxToolOutputChars);
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return toolDenied(
        "Only http and https URLs are allowed",
        ctx.maxToolOutputChars,
      );
    }

    const hostname = parsed.hostname;
    if (isBlockedHost(hostname)) {
      return toolDenied(`Blocked address: ${hostname}`, ctx.maxToolOutputChars);
    }
    if (!hostOnAllowlist(hostname, ctx.allowedHosts)) {
      return toolDenied(
        `Host not allowed: ${hostname}`,
        ctx.maxToolOutputChars,
      );
    }

    const fetchImpl = ctx.fetch ?? globalThis.fetch;
    try {
      const response = await fetchImpl(parsed.href, {
        method: "GET",
        redirect: "manual",
      });
      const body = await response.text();
      const byteCap = ctx.webfetchMaxBytes ?? DEFAULT_MAX_BYTES;
      const byBytes = truncateUtf8(body, byteCap);
      const observed = toolContent(byBytes.text, ctx.maxToolOutputChars);
      return {
        ok: true,
        content: observed.content,
        truncated: byBytes.truncated || observed.truncated,
      };
    } catch (error) {
      return toolError(
        error instanceof Error ? error.message : "webfetch failed",
        ctx.maxToolOutputChars,
      );
    }
  },
};

function hostOnAllowlist(hostname: string, allowedHosts?: string[]): boolean {
  if (!allowedHosts || allowedHosts.length === 0) return true;
  const host = normalizeHost(hostname);
  return allowedHosts.some((entry) => {
    const allowed = normalizeHost(entry);
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}

function normalizeHost(hostname: string): string {
  return hostname.replace(/^\./, "").replace(/\.+$/, "").toLowerCase();
}

function isBlockedHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (host === "localhost" || host.endsWith(".localhost")) return true;

  const mapped = host.startsWith("::ffff:")
    ? host.slice("::ffff:".length)
    : host;
  const ipv4 = parseIpv4(mapped);
  if (ipv4 !== undefined) return isBlockedIpv4(ipv4);

  if (host.includes(":")) return isBlockedIpv6(host);
  return false;
}

function parseIpv4(host: string): number | undefined {
  const parts = host.split(".");
  if (parts.length !== 4) return undefined;
  const nums = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return Number.NaN;
    return Number(part);
  });
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return undefined;
  }
  return (
    (((nums[0] ?? 0) << 24) |
      ((nums[1] ?? 0) << 16) |
      ((nums[2] ?? 0) << 8) |
      (nums[3] ?? 0)) >>>
    0
  );
}

function isBlockedIpv4(ip: number): boolean {
  return (
    inCidr(ip, 0x00000000, 8) ||
    inCidr(ip, 0x7f000000, 8) ||
    inCidr(ip, 0x0a000000, 8) ||
    inCidr(ip, 0xac100000, 12) ||
    inCidr(ip, 0xc0a80000, 16) ||
    inCidr(ip, 0xa9fe0000, 16)
  );
}

function inCidr(ip: number, base: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) === (base & mask);
}

function isBlockedIpv6(host: string): boolean {
  const compact = host.toLowerCase();
  if (compact === "::1" || compact === "0:0:0:0:0:0:0:1") return true;
  if (compact === "::" || compact === "0:0:0:0:0:0:0:0") return true;
  const expanded = expandIpv6(compact);
  if (!expanded) return true;
  const first = Number.parseInt(expanded[0] ?? "0", 16);
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  return expanded.every((part, i) =>
    i === 7 ? part === "0001" : part === "0000",
  );
}

function expandIpv6(host: string): string[] | undefined {
  if (host.includes(".")) return undefined;
  const [left, right] = host.split("::");
  const leftParts = left && left.length > 0 ? left.split(":") : [];
  const rightParts = right && right.length > 0 ? right.split(":") : [];
  if (host.includes("::")) {
    const missing = 8 - leftParts.length - rightParts.length;
    if (missing < 0) return undefined;
    return [
      ...leftParts,
      ...Array.from({ length: missing }, () => "0"),
      ...rightParts,
    ].map((part) => part.padStart(4, "0"));
  }
  const parts = host.split(":");
  if (parts.length !== 8) return undefined;
  return parts.map((part) => part.padStart(4, "0"));
}
