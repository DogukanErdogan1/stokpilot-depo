import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { assertSameOrigin, registerAuthRoutes, requireAuth } from "./auth.js";
import { AppError } from "./errors.js";
import { registerRoutes } from "./routes.js";

export async function buildApp() {
  const app = Fastify({
    logger: { redact: { paths: ["req.headers.cookie", "req.headers.authorization", "req.body.password"], censor: "[REDACTED]" } },
    trustProxy: process.env.TRUST_PROXY === "true",
  });

  const publicApiPaths = new Set(["/api/auth/session", "/api/auth/login", "/api/auth/demo-login", "/api/auth/logout"]);
  app.addHook("preHandler", async (request, reply) => {
    const path = request.routeOptions.url ?? request.url.split("?")[0] ?? "";
    if (path.startsWith("/api/")) {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) assertSameOrigin(request);
      if (!publicApiPaths.has(path)) {
        await requireAuth(request, reply);
        if (reply.sent) return reply;
      }
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (process.env.PUBLIC_ORIGIN?.startsWith("https://")) reply.header("Strict-Transport-Security", "max-age=15552000");
    if (request.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }

    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE constraint failed")) {
      return reply.code(409).send({
        error: { code: "DUPLICATE_VALUE", message: "Bu kod veya SKU zaten kullanılıyor." },
      });
    }

    request.log.error(error);
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "Beklenmeyen bir sunucu hatası oluştu." },
    });
  });

  await registerAuthRoutes(app);
  await registerRoutes(app);

  const publicDirectory = resolve(process.env.PUBLIC_DIRECTORY ?? fileURLToPath(new URL("../public", import.meta.url)));
  const publicAssets: Record<string, { file: string; type: string }> = {
    "index.html": { file: "index.html", type: "text/html; charset=utf-8" },
    "app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
    "styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
    "auth.css": { file: "auth.css", type: "text/css; charset=utf-8" },
  };
  app.setNotFoundHandler(async (request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/api/")) {
      const requested = request.url.split("?")[0] ?? "/";
      const assetName = requested === "/" ? "index.html" : requested.slice(1);
      const asset = publicAssets[assetName];
      if (asset) {
        try {
          const content = await readFile(resolve(publicDirectory, asset.file));
          reply.type(asset.type);
          reply.header("Cache-Control", "no-cache");
          if (assetName === "index.html") {
            reply.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
          }
          return reply.send(content);
        } catch {
          request.log.error({ assetName }, "Static asset is missing");
        }
      }
    }
    return reply.code(404).send({ error: { code: "NOT_FOUND", message: "İstenen adres bulunamadı." } });
  });

  return app;
}
