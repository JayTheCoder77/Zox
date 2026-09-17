import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const yaml = readFileSync(
  join(import.meta.dir, "../openapi/openapi.yaml"),
  "utf8",
);

describe("openapi stub", () => {
  test("declares OpenAPI 3.1", () => {
    expect(yaml).toContain("openapi: 3.1.0");
  });

  test("includes Phase 0 session routes", () => {
    expect(yaml).toContain("/sessions:");
    expect(yaml).toContain("/sessions/{id}:");
    expect(yaml).toContain("/sessions/{id}/messages:");
    expect(yaml).toContain("/sessions/{id}/events:");
  });

  test("includes Phase 1 path keys", () => {
    const paths = [
      "/sessions/{id}/cancel",
      "/sessions/{id}/permissions/{requestId}",
      "/models",
      "/usage",
      "/config",
      "/mcp/servers",
      "/mcp/servers/{name}",
      "/metrics",
      "/hooks",
      "/sessions/{id}/compact",
      "/sessions/{id}/commands",
      "/sessions/{id}/close",
      "/sessions/{id}/memory",
    ];
    for (const path of paths) {
      expect(yaml).toContain(`${path}:`);
    }
  });

  test("includes remainder path keys", () => {
    const paths = [
      "/sessions",
      "/memory/search",
      "/sessions/{id}/memory",
      "/sessions/{id}/hooks/test",
      "/skills",
      "/sessions/{id}/skills",
    ];
    for (const path of paths) {
      expect(yaml).toContain(`${path}:`);
    }
    expect(yaml).toMatch(/\n {2}\/sessions:\n {4}get:/);
    expect(yaml).toContain("SessionListResponse");
  });

  test("includes GET /sessions/{id}/export", () => {
    expect(yaml).toContain("/sessions/{id}/export:");
    expect(yaml).toContain("includeMemory");
  });

  test("uses Bearer auth", () => {
    expect(yaml).toContain("bearerAuth:");
    expect(yaml).toContain("Bearer");
  });
});
