import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemorySessionStore } from "@zox/core";
import { createMockAdapter, createProviderRouter } from "@zox/providers";
import { createApp } from "./app.ts";

const HTTP_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

type OpenApiDoc = {
  paths?: Record<string, Record<string, unknown>>;
};

function openApiPathToHono(path: string): string {
  return path.replaceAll(/\{([^}]+)\}/g, ":$1");
}

function operationsFromOpenApi(
  doc: OpenApiDoc,
): Array<{ method: string; openApiPath: string; honoPath: string }> {
  const ops: Array<{ method: string; openApiPath: string; honoPath: string }> =
    [];
  for (const [openApiPath, item] of Object.entries(doc.paths ?? {})) {
    if (!item || typeof item !== "object") continue;
    for (const key of Object.keys(item)) {
      if (!HTTP_METHODS.has(key)) continue;
      ops.push({
        method: key.toUpperCase(),
        openApiPath,
        honoPath: openApiPathToHono(openApiPath),
      });
    }
  }
  return ops;
}

describe("openapi contract", () => {
  const yaml = readFileSync(
    join(import.meta.dir, "../openapi/openapi.yaml"),
    "utf8",
  );
  const doc = Bun.YAML.parse(yaml) as OpenApiDoc;
  const operations = operationsFromOpenApi(doc);
  const app = createApp({
    token: "test-token",
    store: new MemorySessionStore(),
    router: createProviderRouter({ adapters: [createMockAdapter()] }),
    config: { sandbox: { mode: "host" } },
  });
  const routes = app.routes.map((route) => ({
    method: route.method.toUpperCase(),
    path: route.path,
  }));

  test("OpenAPI declares GET /sessions list", () => {
    expect(operations).toContainEqual({
      method: "GET",
      openApiPath: "/sessions",
      honoPath: "/sessions",
    });
  });

  test("every OpenAPI path+method is registered on createApp().routes", () => {
    expect(operations.length).toBeGreaterThan(0);
    for (const op of operations) {
      expect(routes).toContainEqual({
        method: op.method,
        path: op.honoPath,
      });
    }
  });

  test("remainder routes exist on Hono", () => {
    const remainder = [
      { method: "GET", path: "/sessions" },
      { method: "GET", path: "/memory/search" },
      { method: "POST", path: "/sessions/:id/memory" },
      { method: "POST", path: "/sessions/:id/hooks/test" },
      { method: "GET", path: "/skills" },
      { method: "GET", path: "/sessions/:id/skills" },
      { method: "POST", path: "/sessions/:id/skills" },
      { method: "GET", path: "/sessions/:id/export" },
    ];
    for (const route of remainder) {
      expect(routes).toContainEqual(route);
    }
  });
});
