import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { bearerAuth } from "./auth.ts";

describe("bearerAuth", () => {
  const app = new Hono();
  app.use("*", bearerAuth("secret"));
  app.get("/ping", (c) => c.json({ ok: true }));

  test("rejects missing token", async () => {
    const res = await app.request("/ping");
    expect(res.status).toBe(401);
  });

  test("accepts matching bearer token", async () => {
    const res = await app.request("/ping", {
      headers: { Authorization: "Bearer secret" },
    });
    expect(res.status).toBe(200);
  });
});
