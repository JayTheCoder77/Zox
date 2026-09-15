import { createMiddleware } from "hono/factory";

export function bearerAuth(token: string) {
  return createMiddleware(async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const expected = `Bearer ${token}`;
    if (header !== expected) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });
}
