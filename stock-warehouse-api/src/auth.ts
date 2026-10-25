import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "./db.js";
import { seedDemoWorkspace } from "./demo-data.js";
import { AppError } from "./errors.js";
import { loginSchema, parse } from "./validation.js";

const SESSION_COOKIE = "stokpilot_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_BYTES = 64;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const demoLoginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_DEMO_LOGIN_ATTEMPTS = 1000;

type PasswordHash = { salt: string; hash: string };
export type AuthenticatedUser = { id: string; email: string; fullName: string; workspaceId: string };

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthenticatedUser;
  }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function validAdminEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function hashPassword(password: string, salt = randomBytes(16).toString("hex")): Promise<PasswordHash> {
  const derived = await derivePasswordKey(password, salt, PASSWORD_BYTES);
  return { salt, hash: derived.toString("hex") };
}

function derivePasswordKey(password: string, salt: string, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, expectedHex] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = await derivePasswordKey(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sessionHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseCookie(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return undefined; }
    }
  }
  return undefined;
}

function setSessionCookie(reply: FastifyReply, value: string, maxAge: number): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  reply.header("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
}

function createSession(userId: string, reply: FastifyReply): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')").run();
  const rawToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)").run(sessionHash(rawToken), userId, expiresAt);
  setSessionCookie(reply, rawToken, SESSION_TTL_MS / 1000);
}

function isDemoLoginRateLimited(ip: string, now = Date.now()): boolean {
  const current = demoLoginAttempts.get(ip);
  if (!current || current.resetAt <= now) {
    demoLoginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return false;
  }
  if (current.count >= MAX_DEMO_LOGIN_ATTEMPTS) return true;
  current.count += 1;
  return false;
}

export async function createInitialAdmin(): Promise<void> {
  const existing = db.prepare("SELECT id FROM users LIMIT 1").get();
  if (existing) return;

  const email = process.env.ADMIN_EMAIL ? normalizeEmail(process.env.ADMIN_EMAIL) : "";
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !password) {
    throw new Error("İlk yönetici hesabı için ADMIN_EMAIL ve ADMIN_PASSWORD ortam değişkenlerini tanımlayın.");
  }
  if (!validAdminEmail(email)) throw new Error("ADMIN_EMAIL geçerli bir e-posta adresi olmalıdır.");
  if (password.length < 12) {
    throw new Error("ADMIN_PASSWORD en az 12 karakter olmalıdır.");
  }

  const passwordDigest = await hashPassword(password);
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const transaction = db.transaction(() => {
    db.prepare("INSERT INTO workspaces (id, name) VALUES (?, ?)")
      .run(workspaceId, process.env.ADMIN_NAME?.trim() || "StokPilot Yöneticisi");
    db.prepare("INSERT INTO users (id, email, full_name, password_hash, workspace_id) VALUES (?, ?, ?, ?, ?)")
      .run(userId, email, process.env.ADMIN_NAME?.trim() || "StokPilot Yöneticisi", `scrypt$${passwordDigest.salt}$${passwordDigest.hash}`, workspaceId);
  });
  transaction.immediate();
}

export async function createDemoAccount(): Promise<void> {
  const configuredEmail = process.env.DEMO_EMAIL?.trim() ?? "";
  const password = process.env.DEMO_PASSWORD ?? "";
  if (!configuredEmail && !password) return;

  const email = normalizeEmail(configuredEmail);
  if (!email || !password) {
    throw new Error("Demo hesabı için DEMO_EMAIL ve DEMO_PASSWORD birlikte tanımlanmalıdır.");
  }
  if (!validAdminEmail(email)) throw new Error("DEMO_EMAIL geçerli bir e-posta adresi olmalıdır.");
  if (password.length < 12) throw new Error("DEMO_PASSWORD en az 12 karakter olmalıdır.");
  if (email === normalizeEmail(process.env.ADMIN_EMAIL ?? "")) {
    throw new Error("Demo hesabı e-postası yönetici hesabından farklı olmalıdır.");
  }

  const existing = db.prepare("SELECT id, workspace_id AS workspaceId FROM users WHERE email = ?").get(email) as { id: string; workspaceId: string | null } | undefined;
  if (existing) return;

  const passwordDigest = await hashPassword(password);
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const name = process.env.DEMO_NAME?.trim() || "StokPilot Demo";
  const transaction = db.transaction(() => {
    db.prepare("INSERT INTO workspaces (id, name) VALUES (?, ?)").run(workspaceId, name);
    db.prepare("INSERT INTO users (id, email, full_name, password_hash, workspace_id) VALUES (?, ?, ?, ?, ?)")
      .run(userId, email, name, `scrypt$${passwordDigest.salt}$${passwordDigest.hash}`, workspaceId);
  });
  transaction.immediate();
  try {
    seedDemoWorkspace(workspaceId);
  } catch (error) {
    const rollback = db.transaction(() => {
      db.prepare("DELETE FROM users WHERE id = ?").run(userId);
      db.prepare("DELETE FROM workspaces WHERE id = ?").run(workspaceId);
    });
    rollback.immediate();
    throw error;
  }
}

export async function resetAdminPasswordFromEnvironment(): Promise<void> {
  const email = process.env.ADMIN_EMAIL ? normalizeEmail(process.env.ADMIN_EMAIL) : "";
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email || !password) throw new Error("Parola sıfırlamak için ADMIN_EMAIL ve ADMIN_PASSWORD tanımlayın.");
  if (!validAdminEmail(email)) throw new Error("ADMIN_EMAIL geçerli bir e-posta adresi olmalıdır.");
  if (password.length < 12) throw new Error("ADMIN_PASSWORD en az 12 karakter olmalıdır.");
  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: string } | undefined;
  if (!user) throw new Error("ADMIN_EMAIL ile eşleşen kullanıcı bulunamadı.");

  const digest = await hashPassword(password);
  const transaction = db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .run(`scrypt$${digest.salt}$${digest.hash}`, user.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
  });
  transaction.immediate();
}

export async function getAuthenticatedUser(request: FastifyRequest): Promise<AuthenticatedUser | null> {
  const token = parseCookie(request, SESSION_COOKIE);
  if (!token || token.length < 32) return null;
  const session = db.prepare(`
    SELECT users.id, users.email, users.full_name AS fullName, users.workspace_id AS workspaceId
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.id = ? AND sessions.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).get(sessionHash(token)) as AuthenticatedUser | undefined;
  if (!session) return null;
  return { id: session.id, email: session.email, fullName: session.fullName, workspaceId: session.workspaceId };
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = await getAuthenticatedUser(request);
  if (!user) {
    await reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Oturumunuz sona ermiş. Yeniden giriş yapın." } });
    return;
  }
  request.authUser = user;
}

function isAllowedOrigin(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const configuredHost = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).host.toLowerCase() : undefined;
    return originHost === (configuredHost ?? request.headers.host?.toLowerCase());
  } catch {
    return false;
  }
}

export function assertSameOrigin(request: FastifyRequest): void {
  if (!isAllowedOrigin(request)) throw new AppError(403, "INVALID_ORIGIN", "İstek kaynağı doğrulanamadı.");
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/auth/session", async (request) => {
    const user = await getAuthenticatedUser(request);
    if (!user) return { authenticated: false };
    return { authenticated: true, user: { email: user.email, fullName: user.fullName } };
  });

  app.post("/api/auth/login", async (request, reply) => {
    const input = parse(loginSchema, request.body);
    const now = Date.now();
    const key = request.ip;
    const attempt = loginAttempts.get(key);
    if (attempt && attempt.resetAt <= now) loginAttempts.delete(key);
    const current = loginAttempts.get(key);
    if (current && current.count >= MAX_LOGIN_ATTEMPTS) {
      return reply.code(429).send({ error: { code: "RATE_LIMITED", message: "Çok fazla giriş denemesi yapıldı. Bir süre sonra yeniden deneyin." } });
    }

    const email = normalizeEmail(input.email);
    const user = db.prepare("SELECT id, email, full_name AS fullName, password_hash AS passwordHash FROM users WHERE email = ?")
      .get(email) as { id: string; email: string; fullName: string; passwordHash: string } | undefined;
    const accepted = await verifyPassword(input.password, user?.passwordHash ?? "scrypt$invalid$00");
    if (!user || !accepted) {
      const previous = loginAttempts.get(key);
      loginAttempts.set(key, { count: (previous?.count ?? 0) + 1, resetAt: previous?.resetAt ?? now + LOGIN_WINDOW_MS });
      throw new AppError(401, "INVALID_CREDENTIALS", "E-posta veya şifre hatalı.");
    }

    loginAttempts.delete(key);
    createSession(user.id, reply);
    return { authenticated: true, user: { email: user.email, fullName: user.fullName } };
  });

  app.post("/api/auth/demo-login", async (request, reply) => {
    if (isDemoLoginRateLimited(request.ip)) {
      return reply.code(429).send({ error: { code: "RATE_LIMITED", message: "Demo girişinde çok fazla istek yapıldı. Bir süre sonra yeniden deneyin." } });
    }

    const configuredEmail = process.env.DEMO_EMAIL?.trim() ?? "";
    const email = normalizeEmail(configuredEmail);
    const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL ?? "");
    if (!email || email === adminEmail) {
      throw new AppError(503, "DEMO_UNAVAILABLE", "Demo hesabı şu anda kullanılamıyor.");
    }
    const user = db.prepare("SELECT id, email, full_name AS fullName FROM users WHERE email = ? AND workspace_id IS NOT NULL")
      .get(email) as { id: string; email: string; fullName: string } | undefined;
    if (!user) throw new AppError(503, "DEMO_UNAVAILABLE", "Demo hesabı şu anda kullanılamıyor.");

    createSession(user.id, reply);
    return { authenticated: true, user: { email: user.email, fullName: user.fullName } };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = parseCookie(request, SESSION_COOKIE);
    if (token) db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionHash(token));
    setSessionCookie(reply, "", 0);
    return reply.code(204).send();
  });
}
